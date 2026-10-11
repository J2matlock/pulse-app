/** A deadline sort works out each record's key once, not per comparison (AUDIT-010). */
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { GridRow, ParsedAlertRule } from '../../../../src/shared/types'

const calls = vi.hoisted(() => ({ n: 0 }))
vi.mock('../../../../src/renderer/utils/deadlineCalc', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../../src/renderer/utils/deadlineCalc')>()
  return {
    ...real,
    evaluateRuleForRow: (...args: Parameters<typeof real.evaluateRuleForRow>) => { calls.n++; return real.evaluateRuleForRow(...args) },
  }
})

import { deadlineCompare } from '../../../../src/renderer/components/grid/gridSort'
import { useGridStore } from '../../../../src/renderer/stores/gridStore'

const rule = { id: 1, name: 'Yearly', description: null, thresholds: [], interval_days: 365, interval_months: null, end_of_month: 0, kind: 'interval', rule_config: null, rule_condition: null, business_days: 0, is_system: 0, created_at: '' } as unknown as ParsedAlertRule

function makeRows(n: number): GridRow[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(2025, 0, 1 + ((i * 7919) % 600))
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    return { row_id: i + 1, col_1: ymd } as unknown as GridRow
  })
}

afterEach(() => { vi.useRealTimers(); calls.n = 0 })

describe('deadline sort cost', () => {
  it('calls the deadline engine once per record, not once per comparison', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 10, 12))
    const rows = makeRows(1000)
    const cmp = deadlineCompare(1, rule)
    let comparisons = 0
    const sorted = [...rows].sort((a, b) => { comparisons++; return cmp(a, b) })
    expect(comparisons).toBeGreaterThan(5000)
    expect(calls.n).toBe(1000)
    // Still in due order
    for (let i = 1; i < sorted.length; i++) expect(cmp(sorted[i - 1]!, sorted[i]!)).toBeLessThanOrEqual(0)
  })

  it('works the keys out again when the counts and readings arrive', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 10, 12))
    const rows = makeRows(50)
    const cmp = deadlineCompare(1, rule)
    ;[...rows].sort(cmp)
    expect(calls.n).toBe(50)
    ;[...rows].sort(cmp)
    expect(calls.n).toBe(50)
    useGridStore.setState({ deadlineContext: { meter: {}, quota: {}, progress: {}, extensions: {} } })
    ;[...rows].sort(cmp)
    expect(calls.n).toBe(100)
  })

  it('works the keys out again the next day', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 10, 23, 59))
    const rows = makeRows(20)
    const cmp = deadlineCompare(1, rule)
    ;[...rows].sort(cmp)
    expect(calls.n).toBe(20)
    vi.setSystemTime(new Date(2026, 9, 11, 0, 1))
    ;[...rows].sort(cmp)
    expect(calls.n).toBe(40)
  })
})
