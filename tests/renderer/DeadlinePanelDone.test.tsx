// @vitest-environment jsdom
/** Done and Extend on the record page (R-04, D-22, R-23, D-36). */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('lucide-react', async () => (await import('./lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
// What main's engine says is due for the record (DEADLINES_GET), per test
let served: Array<Record<string, unknown>> = []
const invoke = vi.fn(async (channel: string) => channel === 'row:get'
  ? { ok: true, data: { row_id: 9, col_3: '2026-10-10' } }
  : channel === 'deadlines:mark-done' ? { ok: true, data: { previous: '2025-09-25', newValue: '2026-10-10', finishedFor: null, sysLogId: 5, checklistItemIds: [] } }
  : channel === 'deadlines:get' ? { ok: true, data: served }
  : { ok: true, data: { meter: {}, quota: {}, progress: {}, extensions: {} } })
const listeners = new Map<string, Set<(arg: unknown) => void>>()
const on = vi.fn((channel: string, fn: (arg: unknown) => void) => {
  const set = listeners.get(channel) ?? new Set(); set.add(fn); listeners.set(channel, set)
  return () => { set.delete(fn) }
})
const push = (channel: string, arg: unknown) => { for (const fn of listeners.get(channel) ?? []) fn(arg) }
Object.defineProperty(window, 'api', { value: { invoke, on }, writable: true, configurable: true })

import { DeadlinePanel } from '../../src/renderer/components/profile/DeadlinePanel'
import { useGridStore } from '../../src/renderer/stores/gridStore'
import type { Column, GridRow, ParsedAlertRule } from '../../src/shared/types'

const col = (id: number, name: string, type: string, config = '{}', extra: Partial<Column> = {}) => ({ id, grid_id: 1, name, column_type: type, width: 150, position: id, is_visible: 1, is_required: 0, is_identifier: 0, is_name_column: 0, default_value: null, description: null, config, conditional_format: '[]', created_at: '', ...extra }) as Column
const columns = [col(1, 'Name', 'text', '{}', { is_name_column: 1 }), col(3, 'Annual review', 'date', '{"alert_rule_id":7}')]
const yearly = { id: 7, name: 'Every year', description: null, is_system: 0, thresholds: [], interval_days: null, interval_months: 12, created_at: '', kind: 'interval' } as ParsedAlertRule
const row = { row_id: 9, col_1: 'Robert', col_3: '2025-09-25' } as unknown as GridRow
const item = (over: Record<string, unknown> = {}) => ({
  row_id: 9, grid_id: 1, grid_name: 'Caseload', column_id: 3, column_name: 'Annual review', column_config: '{"alert_rule_id":7}',
  date_value: '2025-09-25', client_name: 'Robert', interval_days: null, interval_months: 12, end_of_month: null, rule_kind: 'interval',
  due: '2026-09-25', state: 'overdue', daysUntil: -15, estimated: false, detail: '', ...over,
})
const renderPanel = (r: GridRow, cols: Column[], rules: ParsedAlertRule[]) =>
  render(<MemoryRouter><DeadlinePanel row={r} columns={cols} alertRules={rules} onDateSave={async () => {}} /></MemoryRouter>)

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(new Date(2026, 9, 10, 12))
  invoke.mockClear()
  served = [item()]
  useGridStore.setState({ activeGridId: 1, rows: [row], deadlineContext: { meter: {}, quota: {}, progress: {}, extensions: {} } } as never)
})
afterEach(() => vi.useRealTimers())

describe('deadline cards on the record page', () => {
  it('label the stored date as when it was last done, and offer Done', async () => {
    renderPanel(row, columns, [yearly])
    expect(screen.getByText('Last done Sep 25, 2025')).toBeTruthy()
    const done = await screen.findByRole('button', { name: 'Mark Annual review done for Robert' })
    await act(async () => { fireEvent.click(done) })
    expect(invoke).toHaveBeenCalledWith('deadlines:mark-done', 9, 3, { kind: 'repeat' }, null, null)
    expect(invoke).toHaveBeenCalledWith('row:get', 1, 9)
  })

  it('show the current due date in Extend and refuse an earlier one', async () => {
    renderPanel(row, columns, [yearly])
    fireEvent.click(await screen.findByRole('button', { name: 'Extend…' }))
    expect(screen.getByText('Due now: Sep 25, 2026')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('New due date'), { target: { value: '2026-09-01' } })
    expect(screen.getByRole('alert').textContent).toMatch(/after Sep 25, 2026/)
  })

  it('ask Renewed or Finished on a date that does not repeat (Decision E1)', async () => {
    const due = { ...yearly, id: 8, name: 'Due date', interval_months: null } as ParsedAlertRule
    const cols = [columns[0]!, col(3, 'License expires', 'date', '{"alert_rule_id":8}')]
    served = [item({ column_name: 'License expires', interval_months: null, due: '2025-09-25' })]
    renderPanel(row, cols, [due])
    fireEvent.click(await screen.findByRole('button', { name: 'Mark License expires done for Robert' }))
    // The same question as on the dashboard and the Calendar, naming the record
    expect(screen.getByText('Done: License expires: Robert')).toBeTruthy()
    fireEvent.click(screen.getByLabelText(/Finished/))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Mark done' })) })
    expect(invoke).toHaveBeenCalledWith('deadlines:mark-done', 9, 3, { kind: 'finished' }, null, null)
  })

  it('say Done on a one-off date marked Finished, as the list does (R4)', () => {
    const due = { ...yearly, id: 8, name: 'Due date', interval_months: null } as ParsedAlertRule
    const cols = [columns[0]!, col(3, 'License expires', 'date', '{"alert_rule_id":8}')]
    useGridStore.setState({ deadlineContext: { meter: {}, quota: {}, progress: {}, extensions: {}, finished: { '9:3': ['2025-09-25'] } } } as never)
    served = [item({ column_name: 'License expires', interval_months: null, state: 'done' })]
    renderPanel(row, cols, [due])
    expect(screen.getByText('Done')).toBeTruthy()
    expect(screen.getByText(/Finished/)).toBeTruthy()
  })

  it('give the next due date moved off a day off, like the list (R4)', () => {
    const workdays = { ...yearly, business_days: 1 } as ParsedAlertRule
    // A year after Sep 26, 2025 is a Saturday: due the Friday before
    const sat = { ...row, col_3: '2025-09-26' } as unknown as GridRow
    renderPanel(sat, columns, [workdays])
    expect(screen.getByText(/Next due Sep 25, 2026/)).toBeTruthy()
  })

  it('reload the counts when a note is written for this record, if a rule counts notes (R4)', () => {
    const quota = { ...yearly, id: 9, name: 'Sessions', kind: 'quota', interval_months: null,
      rule_config: JSON.stringify({ kind: 'quota', activityTypes: ['session'], startColumnId: 4, endColumnId: 5, limit: 12, warnRemaining: 2, warnDaysBeforeEnd: 14 }) } as ParsedAlertRule
    const cols = [columns[0]!, col(3, 'Sessions left', 'deadline', '{"alert_rule_id":9}'), col(4, 'Start', 'date'), col(5, 'End', 'date')]
    const r = { ...row, col_4: '2026-01-01', col_5: '2026-12-31' } as unknown as GridRow
    served = []
    renderPanel(r, cols, [quota])
    const contextLoads = () => invoke.mock.calls.filter(c => c[0] === 'deadlines:grid-context').length
    push('case-log:changed', 8)
    expect(contextLoads()).toBe(0)
    push('case-log:changed', 9)
    expect(contextLoads()).toBe(1)
  })
})
