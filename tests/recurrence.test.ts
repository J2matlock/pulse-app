/** Repeating tasks and checklist items (audit 1.26, 1.27): the next due date. */
import { describe, it, expect, afterEach } from 'vitest'
import { parseRepeatRule, addRepeats, nextRepeatDate, describeRepeat, withAnchorDay, withoutAnchorDay } from '../src/shared/recurrence'

describe('repeat rules', () => {
  it('reads stored rules and ignores bad ones', () => {
    expect(parseRepeatRule('{"type":"weekly","interval":2}')).toEqual({ type: 'weekly', interval: 2 })
    expect(parseRepeatRule('{"type":"monthly","interval":1,"end_date":"2027-01-31"}')).toEqual({ type: 'monthly', interval: 1, end_date: '2027-01-31' })
    expect(parseRepeatRule('{"type":"monthly"}')).toEqual({ type: 'monthly', interval: 1 })
    expect(parseRepeatRule('{"type":"cycle","days":90}')).toBeNull()
    expect(parseRepeatRule('not json')).toBeNull()
    expect(parseRepeatRule(null)).toBeNull()
  })

  it('moves dates on, keeping month ends', () => {
    expect(addRepeats('2026-01-31', { type: 'monthly', interval: 1 })).toBe('2026-02-28')
    expect(addRepeats('2026-01-31', { type: 'monthly', interval: 1 }, 2)).toBe('2026-03-31')
    expect(addRepeats('2024-02-29', { type: 'yearly', interval: 1 })).toBe('2025-02-28')
    expect(addRepeats('2026-10-10', { type: 'weekly', interval: 2 })).toBe('2026-10-24')
    expect(addRepeats('2026-03-07', { type: 'daily', interval: 1 })).toBe('2026-03-08')
  })

  it('rolls a late one forward to today or later, and stops after the end date', () => {
    const weekly = { type: 'weekly' as const, interval: 1 }
    expect(nextRepeatDate('2026-10-03', weekly, '2026-10-05')).toBe('2026-10-10')
    // Late, and a repeat lands on today: it rolls on past today, not back as "due today" (AUDIT-113)
    expect(nextRepeatDate('2026-09-19', weekly, '2026-10-10')).toBe('2026-10-17')
    expect(nextRepeatDate(null, weekly, '2026-10-10')).toBe('2026-10-17')
    // The end date itself still counts (audit L-26)
    expect(nextRepeatDate('2026-11-30', { type: 'monthly', interval: 1, end_date: '2026-12-30' }, '2026-11-30')).toBe('2026-12-30')
    expect(nextRepeatDate('2026-12-31', { type: 'monthly', interval: 1, end_date: '2026-12-31' }, '2026-12-31')).toBeNull()
    expect(describeRepeat({ type: 'monthly', interval: 3 })).toBe('Every 3 months')
  })

  it("keeps a month-end repeat on its day from one tick to the next (bug sweep S2/S5)", () => {
    // Tick off Jan 31: the rule learns the 31st, so Feb 28 comes back as Mar 31, not Mar 28
    const monthly = '{"type":"monthly","interval":1}'
    const afterJan = withAnchorDay(monthly, '2026-01-31')
    expect(parseRepeatRule(afterJan)).toEqual({ type: 'monthly', interval: 1, day: 31 })
    const rule = parseRepeatRule(afterJan)!
    expect(nextRepeatDate('2026-02-28', rule, '2026-02-28')).toBe('2026-03-31')
    expect(nextRepeatDate('2026-04-30', rule, '2026-04-30')).toBe('2026-05-31')
    // A date moved by hand to the middle of the month uses its own day
    expect(nextRepeatDate('2026-03-15', rule, '2026-03-15')).toBe('2026-04-15')
    expect(withAnchorDay(afterJan, '2026-02-28')).toBe(afterJan)
    expect(parseRepeatRule(withAnchorDay(afterJan, '2026-03-15'))).toEqual({ type: 'monthly', interval: 1, day: 15 })
    // Yearly Feb 29 comes back on Feb 29 in the next leap year
    const yearly = parseRepeatRule(withAnchorDay('{"type":"yearly","interval":1}', '2028-02-29'))!
    expect(nextRepeatDate('2029-02-28', yearly, '2029-02-28')).toBe('2030-02-28')
    expect(nextRepeatDate('2031-02-28', yearly, '2031-02-28')).toBe('2032-02-29')
    // Weekly rules and rules without a due date are left alone
    expect(withAnchorDay('{"type":"weekly","interval":1}', '2026-01-31')).toBe('{"type":"weekly","interval":1}')
    expect(withAnchorDay(monthly, null)).toBe(monthly)
    expect(parseRepeatRule('{"type":"monthly","interval":1,"day":40}')).toEqual({ type: 'monthly', interval: 1 })
  })
})

describe('a due date changed by hand (AUDIT-114)', () => {
  it('drops the day of the month and keeps the rest', () => {
    expect(JSON.parse(withoutAnchorDay('{"type":"monthly","interval":1,"day":31,"end_date":"2027-12-31"}')!)).toEqual({ type: 'monthly', interval: 1, end_date: '2027-12-31' })
    const plain = '{"type":"weekly","interval":2}'
    expect(withoutAnchorDay(plain)).toBe(plain)
    expect(withoutAnchorDay(null)).toBeNull()
    expect(withoutAnchorDay('not json')).toBe('not json')
    // Without the day, Feb 28 means the 28th from now on
    expect(nextRepeatDate('2027-02-28', parseRepeatRule(withoutAnchorDay('{"type":"monthly","interval":1,"day":31}'))!, '2027-02-28')).toBe('2027-03-28')
  })
})

describe('ticking off a late repeating item (AUDIT-113)', () => {
  const originalTz = process.env.TZ
  afterEach(() => { if (originalTz === undefined) delete process.env.TZ; else process.env.TZ = originalTz })
  const daily = { type: 'daily' as const, interval: 1 }
  const weekly = { type: 'weekly' as const, interval: 1 }
  const monthly = { type: 'monthly' as const, interval: 1 }
  const cases: Array<[string, string | null, { type: 'daily' | 'weekly' | 'monthly' | 'yearly'; interval: number; end_date?: string; day?: number }, string, string | null]> = [
    // Late: the first repeat strictly after today
    ['weekly, late, a repeat lands on today', '2026-10-01', weekly, '2026-10-15', '2026-10-22'],
    ['weekly, late, no repeat on today', '2026-10-01', weekly, '2026-10-12', '2026-10-15'],
    ['daily, due yesterday', '2026-10-14', daily, '2026-10-15', '2026-10-16'],
    ['monthly, late, a repeat lands on today', '2026-08-15', monthly, '2026-10-15', '2026-11-15'],
    ['monthly on the 31st, late past a short month', '2026-01-31', { ...monthly, day: 31 }, '2026-02-28', '2026-03-31'],
    ['late across a DST change', '2026-03-01', weekly, '2026-04-05', '2026-04-12'],
    ['late, the only repeat left is today', '2026-10-08', { ...weekly, end_date: '2026-10-15' }, '2026-10-15', null],
    // On time or early: one repeat on, as before
    ['weekly, due today', '2026-10-15', weekly, '2026-10-15', '2026-10-22'],
    ['daily, due today', '2026-10-15', daily, '2026-10-15', '2026-10-16'],
    ['weekly, ticked early', '2026-10-20', weekly, '2026-10-15', '2026-10-27'],
    ['monthly, due today on the 31st', '2026-01-31', monthly, '2026-01-31', '2026-02-28'],
    ['no due date', null, weekly, '2026-10-15', '2026-10-22'],
  ]
  for (const tz of ['Pacific/Auckland', 'America/New_York', undefined]) {
    describe(`in ${tz ?? 'the default time zone'}`, () => {
      for (const [name, due, rule, today, want] of cases) {
        it(name, () => {
          if (tz) process.env.TZ = tz
          expect(nextRepeatDate(due, rule, today)).toBe(want)
        })
      }
    })
  }
})
