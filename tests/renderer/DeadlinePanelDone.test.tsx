// @vitest-environment jsdom
/** Done and Extend on the record page (R-04, D-22, R-23, D-36). */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'

vi.mock('lucide-react', async () => (await import('./lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
const invoke = vi.fn(async (channel: string) => channel === 'row:get'
  ? { ok: true, data: { row_id: 9, col_3: '2026-10-10' } }
  : channel === 'deadlines:mark-done' ? { ok: true, data: { previous: '2025-09-25', newValue: '2026-10-10', finishedFor: null, sysLogId: 5, checklistItemIds: [] } }
  : { ok: true, data: { meter: {}, quota: {}, progress: {}, extensions: {} } })
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })

import { DeadlinePanel } from '../../src/renderer/components/profile/DeadlinePanel'
import { useGridStore } from '../../src/renderer/stores/gridStore'
import type { Column, GridRow, ParsedAlertRule } from '../../src/shared/types'

const col = (id: number, name: string, type: string, config = '{}', extra: Partial<Column> = {}) => ({ id, grid_id: 1, name, column_type: type, width: 150, position: id, is_visible: 1, is_required: 0, is_identifier: 0, is_name_column: 0, default_value: null, description: null, config, conditional_format: '[]', created_at: '', ...extra }) as Column
const columns = [col(1, 'Name', 'text', '{}', { is_name_column: 1 }), col(3, 'Annual review', 'date', '{"alert_rule_id":7}')]
const yearly = { id: 7, name: 'Every year', description: null, is_system: 0, thresholds: [], interval_days: null, interval_months: 12, created_at: '', kind: 'interval' } as ParsedAlertRule
const row = { row_id: 9, col_1: 'Robert', col_3: '2025-09-25' } as unknown as GridRow

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(new Date(2026, 9, 10, 12))
  invoke.mockClear()
  useGridStore.setState({ activeGridId: 1, rows: [row], deadlineContext: { meter: {}, quota: {}, progress: {}, extensions: {} } } as never)
})
afterEach(() => vi.useRealTimers())

describe('deadline cards on the record page', () => {
  it('label the stored date as when it was last done, and offer Done', async () => {
    render(<DeadlinePanel row={row} columns={columns} alertRules={[yearly]} onDateSave={async () => {}} />)
    expect(screen.getByText('Last done Sep 25, 2025')).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Done' })) })
    expect(invoke).toHaveBeenCalledWith('deadlines:mark-done', 9, 3, { kind: 'repeat' }, null)
    expect(invoke).toHaveBeenCalledWith('row:get', 1, 9)
  })

  it('show the current due date in Extend and refuse an earlier one', () => {
    render(<DeadlinePanel row={row} columns={columns} alertRules={[yearly]} onDateSave={async () => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Extend…' }))
    expect(screen.getByText('Due now: Sep 25, 2026')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('New due date'), { target: { value: '2026-09-01' } })
    expect(screen.getByRole('alert').textContent).toMatch(/after Sep 25, 2026/)
  })

  it('ask Renewed or Finished on a date that does not repeat (Decision E1)', async () => {
    const due = { ...yearly, id: 8, name: 'Due date', interval_months: null } as ParsedAlertRule
    const cols = [columns[0]!, col(3, 'License expires', 'date', '{"alert_rule_id":8}')]
    render(<DeadlinePanel row={row} columns={cols} alertRules={[due]} onDateSave={async () => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.getByText('Done: License expires')).toBeTruthy()
    fireEvent.click(screen.getByLabelText(/Finished/))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Mark done' })) })
    expect(invoke).toHaveBeenCalledWith('deadlines:mark-done', 9, 3, { kind: 'finished' }, null)
  })
})
