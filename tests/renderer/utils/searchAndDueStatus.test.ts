/** Search finds what's on screen (G-25); "who's overdue?" as a filter (G-12). */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { rowMatchesSearch } from '../../../src/renderer/utils/searchMatch'
import { matchFilter } from '../../../src/renderer/utils/filterMatch'
import { ANY_DEADLINE_COLUMN_ID, type Column, type GridRow, type ParsedAlertRule } from '../../../src/shared/types'
import { visibleRows } from '../../../src/renderer/components/board/boardLanes'

const col = (id: number, column_type: string, config = '{}', extra: Partial<Column> = {}) => ({ id, name: `C${id}`, column_type, config, is_name_column: 0, ...extra } as unknown as Column)
const columns = [col(1, 'text', '{}', { is_name_column: 1 }), col(2, 'phone'), col(3, 'email'), col(4, 'address'), col(5, 'status'), col(6, 'notes')]
const row = { row_id: 1, col_1: 'Ann', col_2: '(555) 555-0113', col_3: 'ann@gmail.com', col_4: '12 Maple Ave', col_5: 'Waiting', col_6: 'Gate code 4321' } as unknown as GridRow

afterEach(() => vi.useRealTimers())

describe('search', () => {
  it('finds phone digits, email, address, status, notes and tags', () => {
    for (const q of ['555-0113', '5550113', '@gmail', 'maple ave', 'waiting', 'gate code']) expect(rowMatchesSearch(row, columns, q), q).toBe(true)
    expect(rowMatchesSearch(row, columns, 'vip', new Map([[1, ['VIP']]]))).toBe(true)
    expect(rowMatchesSearch(row, columns, 'nothing here')).toBe(false)
  })

  it('the board searches the same way', () => {
    expect(visibleRows([row], columns, { activeFilters: [], filterMode: 'and', showStarredOnly: false, searchQuery: '@gmail' })).toHaveLength(1)
  })
})

describe('due status filter', () => {
  const rule = { id: 9, name: 'Yearly', thresholds: [], interval_days: 365, interval_months: null, end_of_month: 0, kind: 'interval', rule_config: null, rule_condition: null, business_days: 0 } as unknown as ParsedAlertRule
  const rules = new Map([[9, rule]])
  const cols = [col(1, 'text'), col(2, 'date', JSON.stringify({ alert_rule_id: 9 })), col(3, 'date')]
  const r = (id: number, last: string) => ({ row_id: id, col_2: last } as unknown as GridRow)

  it('buckets deadlines like their colors, on one column or any', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 10, 12))
    const overdue = r(1, '2025-01-05'), soon = r(2, '2025-10-14'), later = r(3, '2026-03-01')
    const f = (value: string, columnId = 2) => ({ columnId, operator: 'due_status' as const, value })
    expect([overdue, soon, later].filter(x => matchFilter(x, f('overdue'), cols, undefined, rules)).map(x => x.row_id)).toEqual([1])
    expect([overdue, soon, later].filter(x => matchFilter(x, f('next7'), cols, undefined, rules)).map(x => x.row_id)).toEqual([2])
    expect([overdue, soon, later].filter(x => matchFilter(x, f('next30'), cols, undefined, rules)).map(x => x.row_id)).toEqual([2])
    expect([overdue, soon, later].filter(x => matchFilter(x, f('overdue', ANY_DEADLINE_COLUMN_ID), cols, undefined, rules)).map(x => x.row_id)).toEqual([1])
    // A column without a rule never matches
    expect(matchFilter(overdue, f('overdue', 3), cols, undefined, rules)).toBe(false)
  })
})
