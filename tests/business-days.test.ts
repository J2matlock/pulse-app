import { describe, it, expect } from 'vitest'
import { addBusinessDays, isDayOff, rollBackToBusinessDay, usFederalHolidays, daysInRange, type WorkCalendar } from '../src/shared/businessDays'
import { evaluate, engineRuleFrom, referencedColumns, type EngineRule } from '../src/shared/deadlineEngine'

const cal = (holidays: string[] = [], weekend = [0, 6]): WorkCalendar => ({ holidays: new Set(holidays), weekend })

describe('business days', () => {
  it('skips weekends and holidays, forwards and back', () => {
    expect(isDayOff('2026-10-03', cal())).toBe(true) // Saturday
    expect(addBusinessDays('2026-10-02', 1, cal())).toBe('2026-10-05') // Fri → Mon
    expect(addBusinessDays('2026-10-02', 1, cal(['2026-10-05']))).toBe('2026-10-06')
    expect(addBusinessDays('2026-10-05', -1, cal())).toBe('2026-10-02')
    expect(addBusinessDays('2026-10-01', 10, cal())).toBe('2026-10-15')
  })

  it('rolls a day off back to the working day before', () => {
    expect(rollBackToBusinessDay('2026-10-04', cal())).toBe('2026-10-02')
    expect(rollBackToBusinessDay('2026-12-25', cal(['2026-12-25']))).toBe('2026-12-24')
    expect(rollBackToBusinessDay('2026-10-01', cal())).toBe('2026-10-01')
  })

  it("doesn't loop forever when every day is off", () => {
    expect(addBusinessDays('2026-10-01', 3, cal([], [0, 1, 2, 3, 4, 5, 6]))).toBe('2026-10-04')
  })

  it('works out US federal holidays with observed dates', () => {
    const h = Object.fromEntries(usFederalHolidays(2026).map(x => [x.name, x.date]))
    expect(h).toMatchObject({
      "New Year's Day": '2026-01-01', 'Martin Luther King Jr. Day': '2026-01-19', "Washington's Birthday": '2026-02-16',
      'Memorial Day': '2026-05-25', Juneteenth: '2026-06-19', 'Independence Day': '2026-07-03', 'Labor Day': '2026-09-07',
      'Columbus Day': '2026-10-12', 'Veterans Day': '2026-11-11', 'Thanksgiving Day': '2026-11-26', 'Christmas Day': '2026-12-25',
    })
    expect(usFederalHolidays(2027).find(x => x.name === "New Year's Day")!.date).toBe('2027-01-01')
    expect(usFederalHolidays(2022).find(x => x.name === "New Year's Day")!.date).toBe('2021-12-31')
  })

  it('lists the days in a break', () => {
    expect(daysInRange('2026-12-21', '2026-12-24')).toEqual(['2026-12-21', '2026-12-22', '2026-12-23', '2026-12-24'])
  })
})

const relative = (config: object, extra: Partial<EngineRule> = {}): EngineRule =>
  ({ ...engineRuleFrom({ id: 1, kind: 'relative', rule_config: JSON.stringify({ kind: 'relative', ...config }) }), ...extra })

describe('relative rules', () => {
  const after90 = relative({ anchorColumnId: 7, offset: { days: 90, direction: 'after' } })

  it('are due a set time after or before another date', () => {
    expect(evaluate(after90, { today: '2026-10-02', columnDate: null, values: { 7: '2026-09-01' } })).toMatchObject({ due: '2026-11-30', state: 'ok' })
    const before60 = relative({ anchorColumnId: 7, offset: { days: 60, direction: 'before' } })
    expect(evaluate(before60, { today: '2026-10-02', columnDate: null, values: { 7: '2026-12-31' } }).due).toBe('2026-11-01')
    const monthBack = relative({ anchorColumnId: 7, offset: { months: 1, direction: 'before' } })
    expect(evaluate(monthBack, { today: '2026-10-02', columnDate: null, values: { 7: '2026-03-31' } }).due).toBe('2026-02-28')
  })

  it('count working days when asked', () => {
    const tenSchoolDays = relative({ anchorColumnId: 7, offset: { businessDays: 10, direction: 'before' } })
    const res = evaluate(tenSchoolDays, { today: '2026-10-02', columnDate: null, values: { 7: '2026-10-16' }, holidays: new Set(['2026-10-12']) })
    expect(res.due).toBe('2026-10-01')
  })

  it('are done when their own date is filled in for this cycle', () => {
    const done = evaluate(after90, { today: '2026-10-02', columnDate: '2026-09-20', values: { 7: '2026-09-01' } })
    expect(done).toMatchObject({ state: 'done', daysUntil: null })
    // a done date from before this cycle doesn't count
    expect(evaluate(after90, { today: '2026-10-02', columnDate: '2026-08-01', values: { 7: '2026-09-01' } }).state).toBe('ok')
  })

  it('have nothing due without the other date', () => {
    expect(evaluate(after90, { today: '2026-10-02', columnDate: null, values: { 7: null } }).state).toBe('none')
    expect(referencedColumns(after90)).toEqual([7])
  })

  it('can sit on their own column', () => {
    const self = relative({ anchorColumnId: 'self', offset: { days: 30, direction: 'after' } })
    expect(evaluate(self, { today: '2026-10-02', columnDate: '2026-10-01' }).due).toBe('2026-10-31')
  })
})

describe('moving off days off', () => {
  it('rolls any rule\'s due date back to the working day before', () => {
    const rule = engineRuleFrom({ id: 1, interval_days: 3, business_days: 1 })
    const res = evaluate(rule, { today: '2026-09-01', columnDate: '2026-10-01' }) // due Sun Oct 4
    expect(res.due).toBe('2026-10-02')
    expect(res.detail).toMatch(/working day before Oct 4, 2026/)
  })

  it('falls back to an interval rule when settings are unreadable', () => {
    expect(engineRuleFrom({ id: 1, kind: 'relative', rule_config: '{"kind":"relative"}' }).kind).toBe('interval')
    expect(engineRuleFrom({ id: 1, kind: 'nonsense' }).kind).toBe('interval')
  })
})
