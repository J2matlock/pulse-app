import { describe, it, expect } from 'vitest'
import { evaluate, engineRuleFrom, referencedColumns, parseRuleConfig } from '../src/shared/deadlineEngine'
import { isNotTypedColumnType, isReadOnlyColumnType, takesDeadlineRule } from '../src/shared/types'

const calendar = (config: object) => engineRuleFrom({ id: 1, kind: 'calendar', rule_config: JSON.stringify({ kind: 'calendar', ...config }) })
const quarterly = calendar({ months: [1, 4, 6, 9], day: 15 })

describe('calendar rules', () => {
  it('are due on the next fixed date from today when never done', () => {
    expect(evaluate(quarterly, { today: '2026-10-02', columnDate: null })).toMatchObject({ due: '2027-01-15', state: 'ok' })
    expect(evaluate(quarterly, { today: '2026-09-15', columnDate: null })).toMatchObject({ due: '2026-09-15', state: 'due' })
  })

  it('move to the next date after the last time they were done, and go late when missed', () => {
    expect(evaluate(quarterly, { today: '2026-05-01', columnDate: '2026-04-15' }).due).toBe('2026-06-15')
    expect(evaluate(quarterly, { today: '2026-05-01', columnDate: '2026-01-15' })).toMatchObject({ due: '2026-04-15', state: 'overdue' })
  })

  it('count a date done a little before it as done, with no lead time set (D-04)', () => {
    // Paid Apr 10 for "by Apr 15": the next is June, not Apr 15 again
    expect(evaluate(quarterly, { today: '2026-05-01', columnDate: '2026-04-10' })).toMatchObject({ due: '2026-06-15', state: 'ok' })
    // Up to half the gap between dates (28 days here), not more
    expect(evaluate(quarterly, { today: '2026-05-01', columnDate: '2026-03-10' })).toMatchObject({ due: '2026-04-15', state: 'overdue' })
    // A lead time of 0 still means no grace
    expect(evaluate(calendar({ months: [1, 4, 6, 9], day: 15, lead: 0 }), { today: '2026-04-15', columnDate: '2026-04-10' }).due).toBe('2026-04-15')
  })

  it('count a late completion for the date still owed, not the next one (D-14)', () => {
    const quarterlyLead = calendar({ months: [1, 4, 6, 9], day: 15, lead: 60 })
    // April paid late on May 20 (last done in January): June is still due
    expect(evaluate(quarterlyLead, { today: '2026-05-21', columnDate: '2026-05-20', previousDone: '2026-01-14' }).due).toBe('2026-06-15')
    expect(evaluate(quarterly, { today: '2026-05-21', columnDate: '2026-05-20', previousDone: null }).due).toBe('2026-06-15')
    // April was already paid (Apr 14), so May 20 is an early June payment
    expect(evaluate(quarterlyLead, { today: '2026-07-20', columnDate: '2026-05-20', previousDone: '2026-04-14' }).due).toBe('2026-09-15')
    // Monthly with a 14-day lead: March's item done Mar 20 doesn't hide Apr 1
    const monthly = calendar({ months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], day: 1, lead: 14 })
    expect(evaluate(monthly, { today: '2026-03-21', columnDate: '2026-03-20', previousDone: '2026-02-01' }).due).toBe('2026-04-01')
  })

  it('handle the last day and short months', () => {
    const lastDay = calendar({ months: [2], day: 'last' })
    expect(evaluate(lastDay, { today: '2027-01-01', columnDate: null }).due).toBe('2027-02-28')
    // No brackets inside brackets: "(last day of Feb)", not "(Feb (last day))"
    expect(evaluate(lastDay, { today: '2027-01-01', columnDate: null }).detail).toBe('Due Feb 28, 2027 (last day of Feb)')
    const the31st = calendar({ months: [4, 6], day: 31 })
    expect(evaluate(the31st, { today: '2026-04-01', columnDate: null }).due).toBe('2026-04-30')
  })

  it('repeat on the anniversary of another date', () => {
    const anniversary = calendar({ fromColumnMonth: 9 })
    expect(referencedColumns(anniversary)).toEqual([9])
    expect(evaluate(anniversary, { today: '2026-10-02', columnDate: null, values: { 9: '2019-11-20' } }).due).toBe('2026-11-20')
    expect(evaluate(anniversary, { today: '2026-10-02', columnDate: '2026-11-20', values: { 9: '2019-11-20' } }).due).toBe('2027-11-20')
    expect(evaluate(anniversary, { today: '2026-10-02', columnDate: null, values: { 9: null } }).state).toBe('none')
  })

  it('count a date as done when it was done early, within the lead time', () => {
    const spring = calendar({ months: [4], day: 30, lead: 45 })
    // Done Apr 22 for "by Apr 30": next is next year, not overdue
    expect(evaluate(spring, { today: '2026-10-09', columnDate: '2026-04-22' }).due).toBeNull()
    expect(evaluate(spring, { today: '2027-04-01', columnDate: '2026-04-22' }).due).toBe('2027-04-30')
    // Done long before it was showing doesn't count
    expect(evaluate(spring, { today: '2026-05-01', columnDate: '2026-01-10' }).due).toBe('2026-04-30')
    // Never more than half the gap: quarterly with a 60-day lead gets at most 28 days of grace
    const quarterlyLead = calendar({ months: [1, 4, 6, 9], day: 15, lead: 60 })
    expect(evaluate(quarterlyLead, { today: '2026-05-01', columnDate: '2026-03-20' }).due).toBe('2026-06-15')
    expect(evaluate(quarterlyLead, { today: '2026-05-01', columnDate: '2026-03-10' }).due).toBe('2026-04-15')
  })

  it('stay hidden until the lead time', () => {
    const leaded = calendar({ months: [3], day: 31, lead: 30 })
    expect(evaluate(leaded, { today: '2026-10-02', columnDate: null }).due).toBeNull()
    expect(evaluate(leaded, { today: '2027-03-10', columnDate: null }).due).toBe('2027-03-31')
  })

  it('need months and a day, or a date to repeat', () => {
    expect(parseRuleConfig('calendar', { kind: 'calendar', months: [3] }).ok).toBe(false)
    expect(parseRuleConfig('calendar', { kind: 'calendar', fromColumnMonth: 3 }).ok).toBe(true)
  })
})

describe('days off (D-18)', () => {
  it('can move a due date on a day off to the next working day', () => {
    const rule = (bd: number) => engineRuleFrom({ id: 1, interval_days: 7, business_days: bd })
    // Jan 3, 2026 + 7 = Sat Jan 10
    expect(evaluate(rule(1), { today: '2026-01-05', columnDate: '2026-01-03' }).due).toBe('2026-01-09')
    expect(evaluate(rule(2), { today: '2026-01-05', columnDate: '2026-01-03' })).toMatchObject({ due: '2026-01-12', detail: expect.stringMatching(/working day after/) })
    expect(evaluate(rule(0), { today: '2026-01-05', columnDate: '2026-01-03' }).due).toBe('2026-01-10')
  })
  it('can count working days after the date in this column', () => {
    const r = engineRuleFrom({ id: 1, kind: 'relative', rule_config: JSON.stringify({ kind: 'relative', anchorColumnId: 'self', offset: { businessDays: 10, direction: 'after' } }) })
    // Fri Jan 2, 2026 + 10 working days = Fri Jan 16
    expect(evaluate(r, { today: '2026-01-05', columnDate: '2026-01-02' }).due).toBe('2026-01-16')
  })
})

describe('relative "before" rules (D-24)', () => {
  const report = engineRuleFrom({ id: 1, kind: 'relative', rule_config: JSON.stringify({ kind: 'relative', anchorColumnId: 9, offset: { days: 10, direction: 'before' } }) })
  // Hearing Nov 30: report due Nov 20; done counts from one offset ahead of that (Nov 10)
  it('count as done from one offset ahead of the due date', () => {
    expect(evaluate(report, { today: '2026-11-01', columnDate: '2026-11-10', values: { 9: '2026-11-30' } }).state).toBe('done')
    expect(evaluate(report, { today: '2026-11-01', columnDate: '2026-11-09', values: { 9: '2026-11-30' } })).toMatchObject({ due: '2026-11-20', state: 'ok' })
  })
})

describe('deadline columns', () => {
  it('have no box to type in but still take the done date, and can have a rule', () => {
    expect(isNotTypedColumnType('deadline')).toBe(true)
    expect(isReadOnlyColumnType('deadline')).toBe(false)
    expect(takesDeadlineRule('deadline')).toBe(true)
    expect(takesDeadlineRule('text')).toBe(false)
  })
})
