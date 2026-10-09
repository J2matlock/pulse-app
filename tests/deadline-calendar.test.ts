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
