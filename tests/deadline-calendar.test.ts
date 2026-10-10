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
    expect(evaluate(quarterly, { today: '2026-05-01', columnDate: '2026-04-10' }).due).toBe('2026-04-15')
    expect(evaluate(quarterly, { today: '2026-05-01', columnDate: '2026-04-10' }).state).toBe('overdue')
    expect(evaluate(quarterly, { today: '2026-05-01', columnDate: '2026-04-15' }).due).toBe('2026-06-15')
  })

  it('handle the last day and short months', () => {
    const lastDay = calendar({ months: [2], day: 'last' })
    expect(evaluate(lastDay, { today: '2027-01-01', columnDate: null }).due).toBe('2027-02-28')
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

describe('deadline columns', () => {
  it('have no box to type in but still take the done date, and can have a rule', () => {
    expect(isNotTypedColumnType('deadline')).toBe(true)
    expect(isReadOnlyColumnType('deadline')).toBe(false)
    expect(takesDeadlineRule('deadline')).toBe(true)
    expect(takesDeadlineRule('text')).toBe(false)
  })
})
