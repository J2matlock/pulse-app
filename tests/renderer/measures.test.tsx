// @vitest-environment jsdom
/**
 * Your own numbers on notes in the window (plans/generalization/W03-activity.md §3.3):
 * composer boxes, badges on notes, editing them, and the Settings editor.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke: mockInvoke, on: () => () => {} }, writable: true, configurable: true })
vi.mock('lucide-react', async () => (await import('./lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
vi.mock('../../src/renderer/utils/rendererLogger', () => ({ rlog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('../../src/renderer/utils/snippetExpander', () => ({ detectTrigger: () => null, matchSnippets: () => [], expandVariables: (s: string) => s }))

import { IPC } from '../../src/shared/ipc-channels'
import type { MeasureDef } from '../../src/shared/measures'
import { useWorkspaceStore } from '../../src/renderer/stores/workspaceStore'
import { CaseLog } from '../../src/renderer/components/profile/CaseLog'
import { CaseLogEntry } from '../../src/renderer/components/profile/CaseLogEntry'
import { MeasuresEditor } from '../../src/renderer/components/settings/MeasuresEditor'
import { setWords, EXISTING_FEATURES } from './vocabFixture'
import type { CaseLogEntry as Entry } from '../../src/shared/types'

const DEFS: MeasureDef[] = [
  { key: 'labor', label: 'Labor', kind: 'hours', decimals: 2 },
  { key: 'parts', label: 'Parts', kind: 'currency', decimals: 2 },
  { key: 'old', label: 'Old count', kind: 'number', decimals: 0, archived: true },
]

function withMeasures(on: boolean) {
  setWords(undefined, {}, { ...EXISTING_FEATURES, measures: on })
  useWorkspaceStore.setState({ measures: DEFS })
}

const entry = (extra: Record<string, number> | null): Entry => ({
  id: 4, row_id: 10, content: 'Fixed sink', log_type: 'note', created_at: '2026-10-01 10:00:00', updated_at: '2026-10-01 10:00:00',
  is_pinned: 0, follow_up_date: null, follow_up_completed: 0, original_content: null, edited_at: null,
  voided_at: null, voided_reason: null, source_action_id: null, extra_measures: extra ? JSON.stringify(extra) : null,
})

beforeEach(() => {
  vi.clearAllMocks()
  mockInvoke.mockImplementation(async (channel: string, ...args: unknown[]) => {
    if (channel === IPC.CASE_LOG_GET || channel === IPC.SNIPPET_GET_ALL) return { ok: true, data: [] }
    if (channel === IPC.CASE_LOG_CREATE) return { ok: true, data: { ...entry(null), content: args[1] } }
    if (channel === IPC.MEASURE_SAVE) return { ok: true, data: { vocab: {}, features: {}, gridVocab: {}, measures: [...DEFS, { key: 'boxes', label: 'Boxes', kind: 'number', decimals: 0 }] } }
    return { ok: true, data: null }
  })
})

describe('composer', () => {
  it('offers a box per active number and sends what was filled in', async () => {
    withMeasures(true)
    render(<CaseLog rowId={10} />)
    const labor = await screen.findByLabelText('Labor')
    expect(screen.getByLabelText('Parts')).toBeTruthy()
    expect(screen.queryByLabelText('Old count')).toBeNull()
    fireEvent.change(labor, { target: { value: '1.5' } })
    const box = screen.getByPlaceholderText(/entry/)
    fireEvent.change(box, { target: { value: 'Fixed sink' } })
    await act(async () => { fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true }) })
    const create = mockInvoke.mock.calls.find(c => c[0] === IPC.CASE_LOG_CREATE)
    expect(create?.[5]).toMatchObject({ extra: { labor: 1.5 } })
  })

  it('shows no boxes while the feature is off', async () => {
    withMeasures(false)
    render(<CaseLog rowId={10} />)
    await waitFor(() => expect(screen.getByPlaceholderText(/entry/)).toBeTruthy())
    expect(screen.queryByLabelText('Labor')).toBeNull()
  })
})

describe('notes', () => {
  const noop = vi.fn()
  const props = { onPin: noop, onEdit: noop, onDelete: noop, onVoid: noop, onCompleteFollowUp: noop }

  it('show saved numbers as badges, archived ones included', () => {
    withMeasures(true)
    render(<CaseLogEntry entry={entry({ labor: 1.5, parts: 84.2, old: 3, gone: 9 })} {...props} />)
    expect(screen.getByText(/Labor 1\.5 h · Parts \$84\.20 · Old count 3$/)).toBeTruthy()
  })

  it('can be corrected, keeping an archived number the note already has', () => {
    withMeasures(true)
    const onSetMeasures = vi.fn()
    render(<CaseLogEntry entry={entry({ labor: 1.5, old: 3 })} {...props} onSetMeasures={onSetMeasures} />)
    fireEvent.click(screen.getByRole('button', { name: /edit/i }))
    expect((screen.getByLabelText('Old count') as HTMLInputElement).value).toBe('3')
    fireEvent.change(screen.getByLabelText('Labor'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(onSetMeasures).toHaveBeenCalledWith(4, { minutes: null, miles: null, extra: { labor: 2, parts: null, old: 3 } })
  })
})

describe('Settings editor', () => {
  it('adds a number with its kind, unit and decimals', async () => {
    withMeasures(true)
    render(<MeasuresEditor />)
    const names = screen.getAllByLabelText('Name')
    const fresh = names[names.length - 1]!
    fireEvent.change(fresh, { target: { value: 'Boxes' } })
    const units = screen.getAllByLabelText('Unit')
    fireEvent.change(units[units.length - 1]!, { target: { value: 'boxes' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Add a number/ })) })
    expect(mockInvoke).toHaveBeenCalledWith(IPC.MEASURE_SAVE, { label: 'Boxes', kind: 'number', unit: 'boxes', decimals: 0 })
    expect(useWorkspaceStore.getState().measures.map(m => m.key)).toContain('boxes')
    expect(screen.getByText('Archived (1)')).toBeTruthy()
  })
})
