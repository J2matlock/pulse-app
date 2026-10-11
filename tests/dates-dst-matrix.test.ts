/**
 * "Today", days-until and period maths on the days that trip up date code:
 * daylight-saving changes (US 2026-03-08 / 2026-11-01, NZ 2026-04-05 /
 * 2026-09-27), month ends (Jan 31, Feb 28, leap-year Feb 29 2028, Dec 31),
 * and the hours when the local date and the UTC date differ (late evening
 * west of UTC, just after midnight east of it).
 *
 * The clock is frozen at local wall times, so every assertion holds in any
 * zone. Run the whole matrix with `npm run test:tz`.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { localDateString, localDateFromToday, parseDbTimestamp } from '../src/shared/dates'
import { addDays, daysBetween } from '../src/shared/ymd'
import { addRepeats, nextRepeatDate } from '../src/shared/recurrence'
import { periodRange, daysLeft } from '../src/shared/periods'
import { evaluate, engineRuleFrom } from '../src/shared/deadlineEngine'
import { computeDaysUntil, classifyDeadline } from '../src/renderer/utils/deadlineCalc'
import { relativeTime } from '../src/renderer/utils/relativeTime'

/** Local wall-clock time on a 'YYYY-MM-DD' day */
function at(ymd: string, hour: number, minute = 0): Date {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d, hour, minute)
}

/** How SQLite's datetime('now') would have stored that moment (UTC, no zone suffix) */
function dbTimestamp(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ')
}

/** Just after midnight, the small hours a DST change happens in, midday, late evening */
const HOURS: Array<[number, number]> = [[0, 30], [1, 30], [3, 30], [12, 0], [23, 30]]

const DST_DAYS = [
  ['US spring forward', '2026-03-08'],
  ['US fall back', '2026-11-01'],
  ['NZ fall back', '2026-04-05'],
  ['NZ spring forward', '2026-09-27'],
] as const

afterEach(() => { vi.useRealTimers() })

describe(`daylight-saving days (TZ=${process.env.TZ ?? 'default'})`, () => {
  describe.each(DST_DAYS)('%s, %s', (_name, day) => {
    it.each(HOURS)('at %i:%i "today" is that day and nearby deadlines count whole days', (h, m) => {
      vi.useFakeTimers()
      vi.setSystemTime(at(day, h, m))
      expect(localDateString()).toBe(day)
      expect(localDateFromToday(1)).toBe(addDays(day, 1))
      expect(localDateFromToday(-1)).toBe(addDays(day, -1))

      expect(computeDaysUntil(day)).toBe(0)
      expect(computeDaysUntil(addDays(day, -1))).toBe(-1)
      expect(computeDaysUntil(addDays(day, 1))).toBe(1)
      expect(computeDaysUntil(addDays(day, -30), 30)).toBe(0)
      expect(computeDaysUntil(addDays(day, -7), 14)).toBe(7)
      expect(classifyDeadline(computeDaysUntil(day)!)).toBe('today')
      expect(classifyDeadline(computeDaysUntil(addDays(day, -1))!)).toBe('overdue')
      expect(classifyDeadline(computeDaysUntil(addDays(day, 7))!)).toBe('this-week')
      expect(classifyDeadline(computeDaysUntil(addDays(day, 8))!)).toBe('this-month')
    })

    it('days either side of the change are one apart, and a week spans seven', () => {
      expect(daysBetween(addDays(day, -1), day)).toBe(1)
      expect(daysBetween(day, addDays(day, 1))).toBe(1)
      expect(daysBetween(addDays(day, -3), addDays(day, 4))).toBe(7)
      expect(addRepeats(addDays(day, -1), { type: 'daily', interval: 1 })).toBe(day)
      expect(addRepeats(addDays(day, -7), { type: 'weekly', interval: 1 })).toBe(day)
      // Ticked off early, on the day, and a day late (late rolls past today: AUDIT-113)
      expect(nextRepeatDate(addDays(day, -1), { type: 'daily', interval: 1 }, addDays(day, -2))).toBe(day)
      expect(nextRepeatDate(addDays(day, -1), { type: 'daily', interval: 1 }, addDays(day, -1))).toBe(day)
      expect(nextRepeatDate(addDays(day, -1), { type: 'daily', interval: 1 }, day)).toBe(addDays(day, 1))
    })

    it('an interval rule in days or months lands on the right date', () => {
      const days = engineRuleFrom({ id: 1, kind: 'interval', interval_days: 1 })
      expect(evaluate(days, { today: day, columnDate: addDays(day, -1) })).toMatchObject({ due: day, daysUntil: 0 })
      const months = engineRuleFrom({ id: 2, kind: 'interval', interval_months: 1 })
      const res = evaluate(months, { today: addDays(day, 1), columnDate: day })
      expect(res.due!.slice(8)).toBe(day.slice(8))
      expect(res.daysUntil).toBe(daysBetween(addDays(day, 1), res.due!))
    })

    it('the week and month containing the day include it, with whole days left', () => {
      for (const [h, m] of HOURS) {
        const now = at(day, h, m)
        for (const start of ['sunday', 'monday'] as const) {
          const week = periodRange('week', now, start)
          expect(week.start <= day && day <= week.end).toBe(true)
          expect(daysBetween(week.start, week.end)).toBe(6)
          expect(daysLeft(week, now)).toBe(daysBetween(day, week.end))
        }
        const month = periodRange('month', now)
        expect(month.start).toBe(day.slice(0, 8) + '01')
        expect(daysLeft(month, now)).toBe(daysBetween(day, month.end))
      }
    })

    it('a note saved late that evening is "yesterday" the next morning, not "Xh ago"', () => {
      vi.useFakeTimers()
      vi.setSystemTime(at(addDays(day, 1), 9, 0))
      expect(relativeTime(dbTimestamp(at(day, 23, 30)))).toBe('yesterday')
      expect(localDateString(parseDbTimestamp(dbTimestamp(at(day, 23, 30))))).toBe(day)
      expect(localDateString(parseDbTimestamp(dbTimestamp(at(day, 0, 30))))).toBe(day)
    })
  })
})

describe('month ends', () => {
  it.each([
    ['2026-01-31', '2026-02-01', 'month 31 → next month'],
    ['2026-02-28', '2026-03-01', 'February, non-leap'],
    ['2028-02-29', '2028-03-01', 'February 29 in 2028'],
    ['2026-04-30', '2026-05-01', 'a 30-day month'],
    ['2026-12-31', '2027-01-01', 'year end'],
  ])('%s → %s (%s): late evening is still the last day, past midnight is the next month', (last, first) => {
    vi.useFakeTimers()
    for (const [h, m] of [[23, 30], [23, 59]] as const) {
      vi.setSystemTime(at(last, h, m))
      expect(localDateString()).toBe(last)
      const month = periodRange('month', new Date())
      expect(month.end).toBe(last)
      expect(daysLeft(month)).toBe(0)
      expect(computeDaysUntil(last)).toBe(0)
      expect(computeDaysUntil(first)).toBe(1)
    }
    for (const [h, m] of [[0, 0], [0, 30]] as const) {
      vi.setSystemTime(at(first, h, m))
      expect(localDateString()).toBe(first)
      expect(periodRange('month', new Date()).start).toBe(first)
      expect(computeDaysUntil(last)).toBe(-1)
    }
  })

  it('February has 28 days in 2026 and 29 in 2028', () => {
    expect(periodRange('month', at('2026-02-10', 12)).end).toBe('2026-02-28')
    expect(periodRange('month', at('2028-02-10', 12)).end).toBe('2028-02-29')
    expect(daysBetween('2026-02-28', '2026-03-01')).toBe(1)
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2)
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(periodRange('quarter', at('2028-02-29', 23, 30))).toMatchObject({ start: '2028-01-01', end: '2028-03-31' })
  })

  it.each([
    ['2026-01-31', 1, '2026-02-28'],
    ['2028-01-31', 1, '2028-02-29'],
    ['2026-03-31', 1, '2026-04-30'],
    ['2028-02-29', 12, '2029-02-28'],
    ['2026-08-31', 6, '2027-02-28'],
    ['2026-12-31', 2, '2027-02-28'],
  ])('%s + %i month(s) = %s, never spilling into the next month', (from, months, due) => {
    const rule = engineRuleFrom({ id: 1, kind: 'interval', interval_months: months })
    expect(evaluate(rule, { today: from, columnDate: from }).due).toBe(due)
  })

  it('a monthly task from Jan 31, ticked off a day late, comes back at the end of each month', () => {
    const rule = { type: 'monthly' as const, interval: 1 }
    expect(nextRepeatDate('2026-01-31', rule, '2026-02-01')).toBe('2026-02-28')
    expect(nextRepeatDate('2028-01-31', rule, '2028-02-01')).toBe('2028-02-29')
    expect(nextRepeatDate('2026-12-31', rule, '2027-01-01')).toBe('2027-01-31')
  })
})

describe('hours when the local date and the UTC date differ', () => {
  const DAYS = ['2026-01-15', '2026-06-30', '2026-10-11', '2026-12-31', '2028-02-29']

  it.each(DAYS)('on %s, 23:30 and 00:30 local are that day, whatever UTC says', day => {
    vi.useFakeTimers()
    for (const [h, m] of [[0, 30], [23, 30], [23, 59]] as const) {
      vi.setSystemTime(at(day, h, m))
      expect(localDateString()).toBe(day)
      expect(computeDaysUntil(day)).toBe(0)
      expect(periodRange('month', new Date()).key).toBe(day.slice(0, 7))
      // Stored as UTC, read back as the same local day
      expect(localDateString(parseDbTimestamp(dbTimestamp(new Date())))).toBe(day)
    }
  })

  it('a due date one day ahead is "in 1 day" late in the evening, not "due today"', () => {
    vi.useFakeTimers()
    vi.setSystemTime(at('2026-10-11', 23, 30))
    expect(computeDaysUntil('2026-10-12')).toBe(1)
    vi.setSystemTime(at('2026-10-12', 0, 30))
    expect(computeDaysUntil('2026-10-11')).toBe(-1)
  })
})
