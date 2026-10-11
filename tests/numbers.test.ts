/** One way to read numbers out of cells (AUDIT-166): deadlines, reports and number history agree. */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../src/main/database', () => ({ getDb: () => { throw new Error('no database in this test') } }))

import { parseNumberCell } from '../src/shared/numbers'
import { toNumber as reportNumber } from '../src/shared/reports'
import { toNumber as historyNumber } from '../src/main/number-history'
import { evaluate, engineRuleFrom } from '../src/shared/deadlineEngine'

describe('reading numbers from cells', () => {
  it.each([
    ['500', 500], ['$500', 500], ['$1,234.50', 1234.5], ['12 000', 12000], ['-3.5', -3.5], ['.5', 0.5], ['1e3', 1000], [' 42 ', 42],
    ['', null], ['   ', null], ['$', null], ['TBD', null], ['12abc', null], ['0x10', null], ['Infinity', null], [null, null], [undefined, null],
  ])('%j is %j everywhere', (value, expected) => {
    expect(parseNumberCell(value)).toBe(expected)
    expect(reportNumber(value ?? null)).toBe(expected)
    expect(historyNumber(value)).toBe(expected)
  })

  it('a quota limit written "$12" or "1 000" still counts', () => {
    const rule = engineRuleFrom({ id: 1, kind: 'quota', rule_config: JSON.stringify({
      kind: 'quota', activityTypes: ['visit'], limitColumnId: 5, startColumnId: 3, endColumnId: 4,
    }) })
    const ctx = (limit: string) => ({ today: '2026-03-10', columnDate: null, values: { 3: '2026-03-01', 4: '2026-03-31', 5: limit }, activityCount: 2 })
    expect(evaluate(rule, ctx('$12')).detail).toMatch(/10 of 12 left/)
    expect(evaluate(rule, ctx('1 000')).detail).toMatch(/998 of 1000 left/)
  })
})
