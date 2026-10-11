import { describe, it, expect } from 'vitest'
import { ruleSummary } from '../src/shared/ruleSummary'

const names: Record<number, string> = { 2: 'Referral date', 3: 'Auth ends' }
const col = (id: number) => names[id]
const r = (kind: string, cfg: object) => ({ kind, rule_config: JSON.stringify({ kind, ...cfg }) })

describe('rule summaries', () => {
  it('say what each kind does in a few words', () => {
    expect(ruleSummary({ interval_months: 6 })).toBe('Every 6 months')
    expect(ruleSummary({})).toBe('The date entered is the deadline')
    expect(ruleSummary(r('relative', { anchorColumnId: 2, offset: { days: 45, direction: 'after' } }), col)).toBe('45 days after Referral date')
    expect(ruleSummary(r('calendar', { months: [3], day: 31 }))).toBe('Every Mar 31')
    expect(ruleSummary(r('calendar', { months: [1, 4, 6, 9], day: 15 }))).toBe('Jan, Apr, Jun, Sep on the 15th')
    expect(ruleSummary(r('calendar', { months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], day: 'last' }))).toBe('Monthly on the last day')
    expect(ruleSummary(r('meter', { readingColumnId: 5, lastServiceReadingColumnId: 6, every: 5000, unit: 'mi', timeFallback: { months: 6 } }))).toBe('Every 5,000 mi or 6 months')
    expect(ruleSummary(r('quota', { activityTypes: ['visit'], limit: 12, startColumnId: 2, endColumnId: 3, warnRemaining: 2, warnDaysBeforeEnd: 14 }), col)).toBe('12 allowed until Auth ends')
    expect(ruleSummary(r('sequence', { anchorColumnId: 'self', steps: [{ label: 'Plan', offset: { days: 30 } }, { label: 'Review', offset: { months: 6 } }] }))).toBe('Plan, then Review')
  })
})
