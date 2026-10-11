/** Column sorting (audit G-11, G-43) and the "in the past" filter (G-40). */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { numberCompare, dateCompare, deadlineCompare, textCompare, keyCompare } from '../../../../src/renderer/components/grid/gridSort'
import { matchFilter, TODAY_TOKEN } from '../../../../src/renderer/utils/filterMatch'
import type { GridRow, ParsedAlertRule, Column } from '../../../../src/shared/types'

const row = (id: number, v: string | null) => ({ row_id: id, col_1: v } as unknown as GridRow)
const order = (rows: GridRow[], cmp: (a: GridRow, b: GridRow) => number) => [...rows].sort(cmp).map(r => r.row_id)

afterEach(() => vi.useRealTimers())

describe('sorting', () => {
  it('sorts numbers and money as numbers, empty last', () => {
    const rows = [row(1, '1.5'), row(2, '-5'), row(3, null), row(4, '1.25'), row(5, '-10'), row(6, '$1,200')]
    expect(order(rows, numberCompare(1))).toEqual([5, 2, 4, 1, 6, 3])
  })

  it('keeps blanks last when sorted descending too (bug sweep S3)', () => {
    // The table flips the comparator for descending; do the same here
    const descOrder = (rows: GridRow[], cmp: (a: GridRow, b: GridRow) => number) => [...rows].sort((a, b) => -cmp(a, b)).map(r => r.row_id)
    const desc = () => true
    expect(descOrder([row(1, '5'), row(2, null), row(3, '50')], numberCompare(1, desc))).toEqual([3, 1, 2])
    expect(descOrder([row(1, '2026-01-01'), row(2, null), row(3, '2026-05-01')], dateCompare(1, desc))).toEqual([3, 1, 2])
    expect(descOrder([row(1, 'Ana'), row(2, ''), row(3, 'Zoe'), row(4, null)], textCompare(r => r.col_1 as string | null, desc))).toEqual([3, 1, 2, 4])
    expect(descOrder([row(1, '1'), row(2, null), row(3, '3')], keyCompare(r => r.col_1 == null ? null : Number(r.col_1), desc))).toEqual([3, 1, 2])
  })

  it('an emptied cell ("") sorts with the blanks, after every name', () => {
    expect(order([row(1, ''), row(2, 'Ben'), row(3, null), row(4, 'Ana')], textCompare(r => r.col_1 as string | null))).toEqual([4, 2, 1, 3])
  })

  it('a deadline column sorted descending still ends with nothing due, then done', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 10, 12))
    const rule = { id: 1, name: 'Yearly', description: null, thresholds: [], interval_days: 365, interval_months: null, end_of_month: 0, kind: 'interval', rule_config: null, rule_condition: null, business_days: 0, is_system: 0, created_at: '' } as unknown as ParsedAlertRule
    const rows = [row(1, '2025-10-20'), row(2, null), row(3, '2025-12-25')]
    const cmp = deadlineCompare(1, rule, () => true)
    const sorted = [...rows].sort((a, b) => -cmp(a, b)).map(r => r.row_id)
    expect(sorted[sorted.length - 1]).toBe(2)
    expect(sorted.slice(0, 2)).toEqual([3, 1])
  })

  it('sorts dates by their ISO value', () => {
    expect(order([row(1, '2026-10-06'), row(2, '2025-12-31'), row(3, null)], dateCompare(1))).toEqual([2, 1, 3])
  })

  it('sorts a deadline column by when it is due: overdue first, never-done included, done last', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 10, 12))
    const rule = { id: 1, name: 'Yearly', description: null, thresholds: [], interval_days: 365, interval_months: null, end_of_month: 0, kind: 'interval', rule_config: null, rule_condition: null, business_days: 0, is_system: 0, created_at: '' } as unknown as ParsedAlertRule
    // Due Oct 2026 (soon), due Jan 2026 (overdue), due Dec 2026
    const rows = [row(1, '2025-10-20'), row(2, '2025-01-05'), row(3, '2025-12-25')]
    expect(order(rows, deadlineCompare(1, rule))).toEqual([2, 1, 3])
  })
})

describe('"in the past" filter', () => {
  it('checks against the day it is checked, not the day it was saved', () => {
    const cols = [{ id: 1, column_type: 'date' } as Column]
    const f = { columnId: 1, operator: 'before' as const, value: TODAY_TOKEN }
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 10, 12))
    expect(matchFilter(row(1, '2026-10-09'), f, cols)).toBe(true)
    expect(matchFilter(row(1, '2026-10-11'), f, cols)).toBe(false)
    vi.setSystemTime(new Date(2026, 9, 12, 12))
    expect(matchFilter(row(1, '2026-10-11'), f, cols)).toBe(true)
  })
})
