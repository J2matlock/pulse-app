/** A due-status filter reads each column's rule once, not per record (AUDIT-135). */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { matchFilter } from '../../../src/renderer/utils/filterMatch'
import { ANY_DEADLINE_COLUMN_ID, type Column, type GridRow, type ParsedAlertRule } from '../../../src/shared/types'

const rule = { id: 7, name: 'Yearly', description: null, thresholds: [], interval_days: 365, interval_months: null, end_of_month: 0, kind: 'interval', rule_config: null, rule_condition: null, business_days: 0, is_system: 0, created_at: '' } as unknown as ParsedAlertRule

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

describe('due-status filter cost', () => {
  it('parses each column config once across every record', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 10, 12))
    const cols = [1, 2, 3].map(id => ({ id, column_type: 'date', config: `{"alert_rule_id":7,"n":${id}}` } as Column))
    const rows = Array.from({ length: 200 }, (_, i) => ({ row_id: i + 1, col_1: null, col_2: null, col_3: '2025-01-01' } as unknown as GridRow))
    const rules = new Map([[7, rule]])
    const parse = vi.spyOn(JSON, 'parse')
    const hits = rows.filter(r => matchFilter(r, { columnId: ANY_DEADLINE_COLUMN_ID, operator: 'due_status', value: 'overdue' }, cols, undefined, rules))
    const configParses = parse.mock.calls.filter(([text]) => cols.some(c => c.config === text)).length
    expect(configParses).toBe(3)
    expect(hits).toHaveLength(200)
  })

  it('notices a column whose rule changed in place', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 10, 12))
    const col = { id: 1, column_type: 'date', config: '{"alert_rule_id":7}' } as Column
    const row = { row_id: 1, col_1: '2025-01-01' } as unknown as GridRow
    const f = { columnId: 1, operator: 'due_status' as const, value: 'overdue' }
    const rules = new Map([[7, rule]])
    expect(matchFilter(row, f, [col], undefined, rules)).toBe(true)
    col.config = '{}'
    expect(matchFilter(row, f, [col], undefined, rules)).toBe(false)
  })
})
