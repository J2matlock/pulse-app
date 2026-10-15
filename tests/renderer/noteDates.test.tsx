// @vitest-environment jsdom
/** Notes dated by when they happened (audit 1.22): the composer's "When", the "(written …)" label, correcting the day. */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke: mockInvoke, on: () => () => {} }, writable: true, configurable: true })
vi.mock('lucide-react', async () => (await import('./lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
vi.mock('../../src/renderer/utils/rendererLogger', () => ({ rlog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('../../src/renderer/utils/snippetExpander', () => ({ detectTrigger: () => null, matchSnippets: () => [], expandVariables: (s: string) => s }))

import toast from 'react-hot-toast'
import { IPC } from '../../src/shared/ipc-channels'
import { localDateString, localDateFromToday } from '../../src/shared/dates'
import { CaseLog } from '../../src/renderer/components/profile/CaseLog'
import { CaseLogEntry, noteDays } from '../../src/renderer/components/profile/CaseLogEntry'
import { setWords, EXISTING_FEATURES } from './vocabFixture'
import type { CaseLogEntry as Entry } from '../../src/shared/types'

const entry = (over: Partial<Entry> = {}): Entry => ({
  id: 4, row_id: 10, content: 'Home visit', log_type: 'note', created_at: '2026-10-03 15:00:00', updated_at: '2026-10-03 15:00:00',
  occurred_at: '2026-09-30 17:00:00',
  is_pinned: 0, follow_up_date: null, follow_up_completed: 0, original_content: null, edited_at: null,
  voided_at: null, voided_reason: null, source_action_id: null, ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  setWords(undefined, {}, EXISTING_FEATURES)
  mockInvoke.mockImplementation(async (channel: string, ...args: unknown[]) => {
    if (channel === IPC.CASE_LOG_GET || channel === IPC.SNIPPET_GET_ALL) return { ok: true, data: [] }
    if (channel === IPC.CASE_LOG_CREATE) return { ok: true, data: { ...entry(), content: args[1], updated_dates: [{ column_id: 7, column_name: 'Last Visit', old_value: null, new_value: localDateFromToday(-2) }] } }
    return { ok: true, data: null }
  })
})

describe('the note composer', () => {
  it('sends the day it happened when that was not today, and says which day the dates moved to', async () => {
    render(<CaseLog rowId={10} />)
    fireEvent.click(await screen.findByRole('button', { name: /More options/ }))
    const when = await screen.findByLabelText('When') as HTMLInputElement
    expect(when.value).toBe(localDateString())
    fireEvent.change(when, { target: { value: localDateFromToday(-2) } })
    fireEvent.change(screen.getByPlaceholderText(/entry…/), { target: { value: 'Visit on Friday' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add' })) })
    const create = mockInvoke.mock.calls.find(c => c[0] === IPC.CASE_LOG_CREATE)!
    expect(create[6]).toBe(localDateFromToday(-2))
    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/^Also updated Last Visit to (?!today)/), expect.anything())
    await waitFor(() => expect((screen.getByLabelText('When') as HTMLInputElement).value).toBe(localDateString()))
  })

  it('sends no day for a note about today', async () => {
    render(<CaseLog rowId={10} />)
    fireEvent.change(await screen.findByPlaceholderText(/entry…/), { target: { value: 'Called' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add' })) })
    expect(mockInvoke.mock.calls.find(c => c[0] === IPC.CASE_LOG_CREATE)![6]).toBeNull()
  })
})

describe('voiding a note (audit 1.23)', () => {
  it('says which dates went back', async () => {
    mockInvoke.mockImplementation(async (channel: string) => {
      if (channel === IPC.CASE_LOG_GET) return { ok: true, data: [entry()] }
      if (channel === IPC.SNIPPET_GET_ALL) return { ok: true, data: [] }
      if (channel === IPC.CASE_LOG_VOID) return { ok: true, data: { reverted_dates: [{ row_id: 10, column_id: 7, column_name: 'Last Visit', old_value: '2026-09-30', new_value: '2026-09-02' }] } }
      return { ok: true, data: null }
    })
    render(<CaseLog rowId={10} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Void' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Void' })) })
    expect(mockInvoke).toHaveBeenCalledWith(IPC.CASE_LOG_VOID, 4, 'Voided')
    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/^Also set Last Visit back to Sep 2/), expect.anything())
  })
})

describe('a written-up-later note', () => {
  it('shows the day it happened and when it was written', () => {
    const e = entry()
    const days = noteDays(e)
    expect(days.backdated).toBe(true)
    render(<CaseLogEntry entry={e} onPin={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onVoid={vi.fn()} onCompleteFollowUp={vi.fn()} />)
    expect(screen.getByText(/^\(written /)).toBeTruthy()
  })

  it('a note written the day it happened has no "(written …)"', () => {
    render(<CaseLogEntry entry={entry({ occurred_at: '2026-10-03 15:00:00' })} onPin={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onVoid={vi.fn()} onCompleteFollowUp={vi.fn()} />)
    expect(screen.queryByText(/written/)).toBeNull()
  })

  it('the day can be corrected when editing', () => {
    const onSetDay = vi.fn()
    const onEdit = vi.fn()
    render(<CaseLogEntry entry={entry()} onPin={vi.fn()} onEdit={onEdit} onDelete={vi.fn()} onVoid={vi.fn()} onCompleteFollowUp={vi.fn()} onSetDay={onSetDay} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('When'), { target: { value: '2026-09-29' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSetDay).toHaveBeenCalledWith(4, '2026-09-29')
    expect(onEdit).not.toHaveBeenCalled()
  })
})
