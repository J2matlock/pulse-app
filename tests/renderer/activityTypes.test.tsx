// @vitest-environment jsdom
/**
 * People's own note types in the window (plans/generalization/W03-activity.md §2.6):
 * the shared store, the composer chips, note entries and the Settings editor.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke: mockInvoke, on: () => () => {} }, writable: true, configurable: true })
vi.mock('lucide-react', async () => (await import('./lucideMock')).lucideMock)
const toastError = vi.fn()
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: (...a: unknown[]) => toastError(...a), success: vi.fn() }) }))
vi.mock('../../src/renderer/utils/rendererLogger', () => ({ rlog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('../../src/renderer/utils/snippetExpander', () => ({ detectTrigger: () => null, matchSnippets: () => [], expandVariables: (s: string) => s }))

import { IPC } from '../../src/shared/ipc-channels'
import { DEFAULT_ACTIVITY_TYPES, type ActivityType } from '../../src/shared/activityTypes'
import { useActivityTypeStore } from '../../src/renderer/stores/activityTypeStore'
import { CaseLog } from '../../src/renderer/components/profile/CaseLog'
import { CaseLogEntry } from '../../src/renderer/components/profile/CaseLogEntry'
import { ActivityTypesEditor } from '../../src/renderer/components/settings/ActivityTypesEditor'
import { setWords } from './vocabFixture'
import type { CaseLogEntry as Entry } from '../../src/shared/types'

const type = (id: number, key: string, label: string, extra: Partial<ActivityType> = {}): ActivityType =>
  ({ id, key, label, icon: null, color: 'blue', position: id, is_archived: 0, ...extra })

const THERAPY: ActivityType[] = [
  type(1, 'session', 'Session', { icon: '🗣️' }), type(2, 'phone', 'Phone'), type(3, 'no_show', 'No-show'),
  type(4, 'cancel', 'Cancellation'), type(5, 'email', 'Email'), type(6, 'group', 'Group'),
  type(7, 'intake', 'Intake'), type(8, 'old_kind', 'Old kind', { is_archived: 1 }),
]

let served: ActivityType[] = THERAPY
let lastType: string | null = null

beforeEach(() => {
  vi.clearAllMocks()
  setWords()
  served = THERAPY
  lastType = null
  useActivityTypeStore.setState({ types: [...DEFAULT_ACTIVITY_TYPES], isLoaded: false })
  mockInvoke.mockImplementation(async (channel: string, ...args: unknown[]) => {
    if (channel === IPC.ACTIVITY_TYPE_GET_ALL) return { ok: true, data: served }
    if (channel === IPC.SETTINGS_GET && args[0] === 'note_type_last') return { ok: true, data: lastType }
    if (channel === IPC.CASE_LOG_GET) return { ok: true, data: [] }
    if (channel === IPC.SNIPPET_GET_ALL) return { ok: true, data: [] }
    if (channel === IPC.CASE_LOG_CREATE) return { ok: true, data: { id: 5, row_id: 10, content: args[1], log_type: args[2], created_at: '', updated_at: '' } }
    return { ok: true, data: null }
  })
})

const entry = (log_type: string): Entry => ({
  id: 1, row_id: 10, content: 'Talked', log_type, created_at: '2026-10-01 10:00:00', updated_at: '2026-10-01 10:00:00',
  is_pinned: 0, follow_up_date: null, follow_up_completed: 0, original_content: null, edited_at: null,
  voided_at: null, voided_reason: null, source_action_id: null,
})

describe('note type store', () => {
  it('stands in with the five built-ins, then loads the real list', async () => {
    expect(useActivityTypeStore.getState().types.map(t => t.key)).toEqual(['note', 'phone', 'meeting', 'email', 'visit'])
    await useActivityTypeStore.getState().load()
    expect(useActivityTypeStore.getState().types.map(t => t.key)).toContain('no_show')
  })

  it('ignores answers that aren\'t a list of types', async () => {
    served = [{ id: 1, content: 'a note, not a type' } as unknown as ActivityType]
    await useActivityTypeStore.getState().load()
    expect(useActivityTypeStore.getState().isLoaded).toBe(false)
    expect(useActivityTypeStore.getState().types).toHaveLength(5)
  })
})

describe('composer', () => {
  it('shows the first six types as chips and the rest under More…', async () => {
    render(<CaseLog rowId={10} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /Session/ })).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Group' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Intake' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Old kind' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'More…' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Intake' }))
    // the chosen one now shows as a chip and is remembered
    expect(screen.getByRole('button', { name: 'Intake', pressed: true })).toBeTruthy()
    expect(mockInvoke).toHaveBeenCalledWith(IPC.SETTINGS_UPDATE, 'note_type_last', 'intake')
  })

  it('starts with the type used last time and saves the note with its key', async () => {
    lastType = 'no_show'
    render(<CaseLog rowId={10} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'No-show', pressed: true })).toBeTruthy())
    const box = screen.getByPlaceholderText(/Add a no-show entry/)
    fireEvent.change(box, { target: { value: 'Did not come' } })
    await act(async () => { fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true }) })
    const create = mockInvoke.mock.calls.find(c => c[0] === IPC.CASE_LOG_CREATE)
    expect(create?.[3]).toBe('no_show')
  })

  it('falls back to the first type when the remembered one was archived', async () => {
    lastType = 'old_kind'
    render(<CaseLog rowId={10} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /Session/, pressed: true })).toBeTruthy())
  })
})

describe('note entries', () => {
  it('show the type\'s current label, marking archived ones', async () => {
    await useActivityTypeStore.getState().load()
    const noop = vi.fn()
    const props = { onPin: noop, onEdit: noop, onDelete: noop, onVoid: noop, onCompleteFollowUp: noop }
    const { rerender } = render(<CaseLogEntry entry={entry('session')} {...props} />)
    expect(screen.getByText('Session')).toBeTruthy()
    rerender(<CaseLogEntry entry={entry('old_kind')} {...props} />)
    expect(screen.getByText('Old kind (archived)')).toBeTruthy()
  })
})

describe('Settings editor', () => {
  it('adds, renames and archives types, and shows why a used type can\'t be deleted', async () => {
    await useActivityTypeStore.getState().load()
    mockInvoke.mockImplementation(async (channel: string, ...args: unknown[]) => {
      if (channel === IPC.ACTIVITY_TYPE_GET_ALL) return { ok: true, data: served }
      if (channel === IPC.ACTIVITY_TYPE_DELETE) return { ok: false, error: 'This type is used by 3 notes. Archive it instead.' }
      return { ok: true, data: args[0] ?? null }
    })
    render(<ActivityTypesEditor />)

    fireEvent.change(screen.getByLabelText('New kind'), { target: { value: 'Home check' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Add a kind/ })) })
    expect(mockInvoke).toHaveBeenCalledWith(IPC.ACTIVITY_TYPE_SAVE, expect.objectContaining({ label: 'Home check' }))

    const name = screen.getByLabelText('Name of Phone')
    fireEvent.change(name, { target: { value: 'Call' } })
    await act(async () => { fireEvent.blur(name) })
    expect(mockInvoke).toHaveBeenCalledWith(IPC.ACTIVITY_TYPE_SAVE, expect.objectContaining({ id: 2, label: 'Call' }))

    const phoneRow = name.closest('li')!
    await act(async () => { fireEvent.click(phoneRow.querySelector('button[title^="Hide"]')!) })
    expect(mockInvoke).toHaveBeenCalledWith(IPC.ACTIVITY_TYPE_ARCHIVE, 2, true)

    await act(async () => { fireEvent.click(phoneRow.querySelector('button[title^="Only types"]')!) })
    expect(toastError).toHaveBeenCalledWith('This type is used by 3 notes. Archive it instead.')

    expect(screen.getByText('Archived (1)')).toBeTruthy()
  })
})
