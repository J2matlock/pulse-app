// @vitest-environment jsdom
/** Rule editor v2 (W05 §6): pick how it's worked out, choose columns, see a live preview, save. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'

vi.mock('lucide-react', async () => (await import('./lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
const invoke = vi.fn(async (channel: string) => channel === 'alert-rule:create' ? { ok: true, data: 11 } : { ok: true, data: [] })
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })

import { AlertRuleEditor } from '../../src/renderer/components/alerts/AlertRuleEditor'
import { useGridStore } from '../../src/renderer/stores/gridStore'
import { useAlertStore } from '../../src/renderer/stores/alertStore'
import { IPC } from '../../src/shared/ipc-channels'
import type { Column, GridRow } from '../../src/shared/types'
import { setWords } from './vocabFixture'

const col = (id: number, name: string, type: string, extra: Partial<Column> = {}) => ({ id, grid_id: 1, name, column_type: type, width: 150, position: id, is_visible: 1, is_required: 0, is_identifier: 0, is_name_column: 0, default_value: null, description: null, config: '{}', conditional_format: '[]', created_at: '', ...extra }) as Column
const columns = [col(1, 'Name', 'text', { is_name_column: 1 }), col(2, 'Referral', 'date'), col(3, 'Plan written', 'date'),
  col(4, 'Status', 'status', { config: JSON.stringify({ options: [{ label: 'Active', color: 'green' }, { label: 'Closed', color: 'gray' }] }) })]
const rows = [
  { row_id: 8, col_1: 'Sam Doe', col_2: null, col_3: null, col_4: 'Active' },
  { row_id: 9, col_1: 'Pat Lee', col_2: '2026-01-10', col_3: null, col_4: 'Active' },
] as unknown as GridRow[]

beforeEach(() => {
  setWords()
  vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(new Date(2026, 2, 1, 12))
  useGridStore.setState({ activeGridId: 1, columns, rows, grids: [], deadlineContext: null } as never)
})
afterEach(() => vi.useRealTimers())

describe('the rule editor', () => {
  it('builds a "from another date" rule with a live preview and saves it', async () => {
    const onClose = vi.fn()
    render(<AlertRuleEditor columnId={3} onClose={onClose} />)
    fireEvent.change(screen.getByLabelText('Rule name'), { target: { value: 'Plan due' } })
    fireEvent.click(screen.getByRole('radio', { name: /From another date/ }))
    expect(screen.getByTestId('rule-preview').textContent).toBe('Choose the date this deadline is worked out from.')
    // The rule's own column isn't offered as the date to work from
    const anchor = screen.getByLabelText('Worked out from') as HTMLSelectElement
    expect([...anchor.options].map(o => o.text)).toEqual(['Choose the date…', 'This column (the one the rule is on)', 'Referral'])
    fireEvent.change(anchor, { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('Offset amount'), { target: { value: '45' } })
    // Pat has a referral date, so the preview picks Pat
    expect(screen.getByTestId('rule-preview').textContent).toMatch(/^For Pat Lee: .*Feb 24, 2026/)

    fireEvent.click(screen.getByLabelText('Only when…'))
    fireEvent.change(screen.getByLabelText('Only when column'), { target: { value: '4' } })
    fireEvent.change(screen.getByLabelText('Only when value'), { target: { value: 'Active' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create Rule' })) })
    const call = invoke.mock.calls.find(c => c[0] === IPC.ALERT_RULE_CREATE)!
    expect(call[1]).toMatchObject({
      name: 'Plan due', kind: 'relative', business_days: 0, interval_days: null,
      rule_config: JSON.stringify({ kind: 'relative', anchorColumnId: 2, offset: { days: 45, direction: 'after' } }),
      rule_condition: JSON.stringify({ columnId: 4, op: 'is', values: ['Active'], whenFalse: 'pause' }),
    })
    expect(onClose).toHaveBeenCalledWith(11)
  })

  it('flags a setting that points at a deleted column in red (D-25)', () => {
    const rule = {
      id: 5, name: 'Plan due', description: null, thresholds: [], interval_days: null, interval_months: null, end_of_month: 0,
      kind: 'relative', business_days: 0, is_system: 0, created_at: '',
      rule_config: JSON.stringify({ kind: 'relative', anchorColumnId: 99, offset: { days: 45, direction: 'after' } }),
      rule_condition: null,
    } as never
    render(<AlertRuleEditor rule={rule} columnId={3} onClose={vi.fn()} />)
    const anchor = screen.getByLabelText('Worked out from') as HTMLSelectElement
    expect(anchor.getAttribute('aria-invalid')).toBe('true')
    expect(anchor.value).toBe('99')
    expect(screen.getByRole('alert').textContent).toMatch(/is gone/)
  })

  it('will not save settings that are missing something', async () => {
    render(<AlertRuleEditor columnId={3} onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Rule name'), { target: { value: 'Quarterly' } })
    fireEvent.click(screen.getByRole('radio', { name: /On fixed dates/ }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create Rule' })) })
    expect(screen.getAllByText('Choose at least one month.').length).toBeGreaterThan(0)
    expect(invoke.mock.calls.some(c => c[0] === IPC.ALERT_RULE_CREATE && (c[1] as { name: string }).name === 'Quarterly')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Mar' }))
    expect(screen.getByTestId('rule-preview').textContent).toMatch(/^For .*Mar 15, 2026/)
  })

  it('edits a rule against the list that uses it, not the open one (D-09)', async () => {
    const jobs = [col(21, 'Job', 'text', { grid_id: 2, is_name_column: 1 }), col(22, 'Estimate sent on', 'date', { grid_id: 2 }), col(23, 'Follow-up', 'date', { grid_id: 2 }),
      col(24, 'Archived', 'checkbox', { grid_id: 2, is_visible: 0 })]
    useAlertStore.setState({ usage: [{ rule_id: 5, column_id: 23, column_name: 'Follow-up', grid_id: 2, grid_name: 'Jobs', hidden: false }] })
    invoke.mockImplementation(async (channel: string) => channel === 'grid:get-full'
      ? { ok: true, data: { columns: jobs.slice(0, 3), hiddenColumns: jobs.slice(3), rows: [{ row_id: 30, col_21: 'Roof', col_22: '2026-02-01' }] } }
      : { ok: true, data: [] })
    const rule = { id: 5, name: 'Estimate follow-up', description: null, is_system: 0, thresholds: [], interval_days: null, created_at: '',
      kind: 'relative', rule_config: JSON.stringify({ kind: 'relative', anchorColumnId: 22, offset: { days: 7, direction: 'after' } }),
      rule_condition: JSON.stringify({ columnId: 24, op: 'is_not', values: ['true', '1'], whenFalse: 'hide' }) } as never
    render(<AlertRuleEditor rule={rule} onClose={vi.fn()} />)
    await act(async () => { await Promise.resolve() })
    expect(invoke).toHaveBeenCalledWith('grid:get-full', 2, false)
    const anchor = screen.getByLabelText('Worked out from') as HTMLSelectElement
    expect(anchor.value).toBe('22')
    expect([...anchor.options].map(o => o.text)).toEqual(['Choose the date…', 'This column (the one the rule is on)', 'Estimate sent on'])
    expect(screen.queryByText(/column this used is gone/)).toBeNull()
    // Hidden columns can be chosen, marked as hidden; a checkbox reads "is not checked"
    const cond = screen.getByLabelText('Only when column') as HTMLSelectElement
    expect([...cond.options].map(o => o.text)).toContain('Archived (hidden)')
    expect((screen.getByLabelText('Only when test') as HTMLSelectElement).value).toBe('unchecked')
    expect(screen.getByTestId('rule-preview').textContent).toMatch(/^For Roof: .*Feb 8, 2026/)
  })

  it('flags a column the rule needs that no longer exists (D-25)', async () => {
    useAlertStore.setState({ usage: [{ rule_id: 6, column_id: 3, column_name: 'Plan written', grid_id: 1, grid_name: 'Clients', hidden: false }] })
    const rule = { id: 6, name: 'Plan due', description: null, is_system: 0, thresholds: [], interval_days: null, created_at: '',
      kind: 'relative', rule_config: JSON.stringify({ kind: 'relative', anchorColumnId: 99, offset: { days: 7, direction: 'after' } }) } as never
    render(<AlertRuleEditor rule={rule} onClose={vi.fn()} />)
    expect(screen.getByRole('alert').textContent).toMatch(/column this used is gone/)
    expect((screen.getByLabelText('Worked out from') as HTMLSelectElement).getAttribute('aria-invalid')).toBe('true')
  })

  it('names a new rule after what it does when no name is typed (D-17)', async () => {
    invoke.mockImplementation(async (channel: string) => channel === 'alert-rule:create' ? { ok: true, data: 12 } : { ok: true, data: [] })
    render(<AlertRuleEditor columnId={3} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('radio', { name: /From another date/ }))
    fireEvent.change(screen.getByLabelText('Worked out from'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('Offset amount'), { target: { value: '45' } })
    expect((screen.getByLabelText('Rule name') as HTMLInputElement).placeholder).toBe('45 days after Referral')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create Rule' })) })
    const call = invoke.mock.calls.filter(c => c[0] === IPC.ALERT_RULE_CREATE).at(-1)!
    expect((call[1] as { name: string }).name).toBe('45 days after Referral')
  })

  it('saves "working days" and "the next working day" (D-18)', async () => {
    invoke.mockImplementation(async (channel: string) => channel === 'alert-rule:create' ? { ok: true, data: 13 } : { ok: true, data: [] })
    render(<AlertRuleEditor columnId={3} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Custom…' }))
    fireEvent.change(screen.getByLabelText('How many'), { target: { value: '10' } })
    fireEvent.change(screen.getByLabelText('Unit'), { target: { value: 'workingDays' } })
    fireEvent.click(screen.getByLabelText('Move it to the next working day'))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create Rule' })) })
    const call = invoke.mock.calls.filter(c => c[0] === IPC.ALERT_RULE_CREATE).at(-1)!
    expect(call[1]).toMatchObject({ kind: 'relative', business_days: 2, interval_days: null,
      rule_config: JSON.stringify({ kind: 'relative', anchorColumnId: 'self', offset: { businessDays: 10, direction: 'after' } }) })
  })

  it('says which columns share a rule, and can make a copy for this column (Decision F1)', async () => {
    invoke.mockImplementation(async (channel: string) => channel === 'alert-rule:create' ? { ok: true, data: 21 } : { ok: true, data: [] })
    useAlertStore.setState({ usage: [
      { rule_id: 9, column_id: 3, column_name: 'Plan written', grid_id: 1, grid_name: 'Clients', hidden: false },
      { rule_id: 9, column_id: 40, column_name: 'Lease renewal', grid_id: 2, grid_name: 'Housing', hidden: false },
    ] })
    const rule = { id: 9, name: 'Every year', description: null, is_system: 0, thresholds: [{ daysBefore: 0, bgClass: '#dc2626', label: 'Due' }], interval_days: null, interval_months: 12, created_at: '', kind: 'interval' } as never
    const onClose = vi.fn()
    render(<AlertRuleEditor rule={rule} columnId={3} onClose={onClose} />)
    expect(screen.getByTestId('rule-used-by').textContent).toBe('Used by: Clients → Plan written, Housing → Lease renewal')
    expect(screen.getByLabelText('Change it for all 2 columns that use it')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Make a copy just for "Plan written"'))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save Changes' })) })
    const call = invoke.mock.calls.filter(c => c[0] === IPC.ALERT_RULE_CREATE).at(-1)!
    expect((call[1] as { name: string; interval_months: number }).name).toBe('Every year (Plan written)')
    expect(invoke.mock.calls.some(c => c[0] === IPC.ALERT_RULE_UPDATE)).toBe(false)
    expect(onClose).toHaveBeenCalledWith(21)
  })
})
