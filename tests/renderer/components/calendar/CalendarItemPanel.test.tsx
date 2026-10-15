// @vitest-environment jsdom
/** A deadline or follow-up clicked on the Calendar: the shared deadline card in the side panel (UX D-08, Q3). */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act, within, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
const invoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })

import { CalendarItemPanel } from '../../../../src/renderer/components/calendar/CalendarItemPanel'
import type { CalendarItem } from '../../../../src/shared/calendar'
import { IPC } from '../../../../src/shared/ipc-channels'
import { setWords } from '../../vocabFixture'

const loaded = {
  row_id: 9, grid_id: 1, grid_name: 'Caseload', column_id: 3, column_name: 'Annual review', column_config: '{}',
  date_value: '2025-10-26', client_name: 'Robert', interval_days: null, interval_months: 12, end_of_month: null, rule_kind: 'interval',
  due: '2026-10-26', state: 'ok', daysUntil: 11, estimated: false, detail: '',
}
const deadlineItem: CalendarItem = { kind: 'deadline', key: 'd-9-3', date: '2026-10-26', title: 'Annual review', rowId: 9, gridId: 1, recordName: 'Robert', daysUntil: 11, columnId: 3 }
const followUp: CalendarItem = { kind: 'followup', key: 'followup-44', date: '2026-10-20', title: 'Call back about the referral', rowId: 9, gridId: 1, recordName: 'Robert', daysUntil: 5 }

function renderPanel(item: CalendarItem, onChanged = vi.fn(async () => {}), onClose = vi.fn()) {
  render(<MemoryRouter><CalendarItemPanel item={item} onClose={onClose} onChanged={onChanged} /></MemoryRouter>)
  return { onChanged, onClose }
}

beforeEach(() => {
  setWords()
  invoke.mockReset()
  invoke.mockImplementation(async (channel: string) => channel === IPC.DEADLINES_GET ? { ok: true, data: [loaded] }
    : channel === IPC.DEADLINE_MARK_DONE ? { ok: true, data: { previous: '2025-10-26', newValue: '2026-10-15', finishedFor: null, sysLogId: 5, checklistItemIds: [] } }
    : { ok: true, data: { sysLogId: 6 } })
})

describe('a deadline on the Calendar', () => {
  it('shows "Loading…", then the card: the due date in words and Done · Done on… · Extend… · Open', async () => {
    renderPanel(deadlineItem)
    expect(screen.getByText('Loading…')).toBeTruthy()
    const actions = await screen.findByTestId('deadline-card-actions')
    expect(screen.getByTestId('deadline-card-due').textContent).toBe('Due Oct 26, 2026 · 11 days')
    expect(screen.getByText('Last done Oct 26, 2025')).toBeTruthy()
    expect(within(actions).getAllByRole('button').map(b => b.getAttribute('aria-label') ?? b.textContent))
      .toEqual(['Mark Annual review done for Robert', 'Done on another day: Annual review for Robert', 'Extend…', 'Open client'])
    expect(invoke).toHaveBeenCalledWith(IPC.DEADLINES_GET, { rowIds: [9] })
  })

  it('Done goes through the engine, reloads the Calendar and closes the panel', async () => {
    const { onChanged, onClose } = renderPanel(deadlineItem)
    const actions = await screen.findByTestId('deadline-card-actions')
    await act(async () => { fireEvent.click(within(actions).getByRole('button', { name: 'Mark Annual review done for Robert' })) })
    expect(invoke).toHaveBeenCalledWith(IPC.DEADLINE_MARK_DONE, 9, 3, { kind: 'repeat' }, null, null)
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onChanged).toHaveBeenCalled()
  })

  it('offers only Open when the engine has nothing due for it', async () => {
    invoke.mockImplementation(async () => ({ ok: true, data: [] }))
    renderPanel(deadlineItem)
    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull())
    expect(screen.getByText('Due Oct 26, 2026 · 11 days')).toBeTruthy()
    expect(screen.getAllByRole('button').map(b => b.textContent)).toEqual(['', 'Robert', 'Open client'])
  })

  it('uses the list\'s words for the record', async () => {
    setWords({ record: { one: 'vehicle', many: 'vehicles', article: 'a' } })
    renderPanel(deadlineItem)
    const actions = await screen.findByTestId('deadline-card-actions')
    expect(within(actions).getByRole('button', { name: 'Open vehicle' })).toBeTruthy()
  })
})

describe('a follow-up on the Calendar', () => {
  it('shows its text, Done and Open, and Done completes it', async () => {
    const { onClose } = renderPanel(followUp)
    expect(screen.getByText('Call back about the referral')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open client' })).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Mark the follow-up for Robert done' })) })
    expect(invoke).toHaveBeenCalledWith(IPC.CASE_LOG_COMPLETE_FOLLOWUP, 44)
    expect(onClose).toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalledWith(IPC.DEADLINES_GET, expect.anything())
  })
})
