/**
 * Date helpers that must give the same answers in every time zone. Pure (no
 * database). Run it under several zones as well as the default, e.g.
 *   TZ=Pacific/Auckland, America/New_York, Europe/London, Australia/Lord_Howe, UTC
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { toYmd, ymdToDate, dateToYmd, daysBetween } from '../src/shared/ymd'
import { localDateString, localDateFromToday } from '../src/shared/dates'
import { addRepeats } from '../src/shared/recurrence'
import { minutesBetween, addMinutes } from '../src/shared/appointments'
import { sequenceStepDue, evaluate, engineRuleFrom, type SequenceConfig } from '../src/shared/deadlineEngine'
import { relativeTime } from '../src/renderer/utils/relativeTime'

const CAL = { holidays: new Set<string>(), weekend: [0, 6] }

/** Every calendar date from `from` through `to` */
function everyDay(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = ymdToDate(from); dateToYmd(d) <= to; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) out.push(dateToYmd(d))
  return out
}
const DAYS_2024_2027 = everyDay('2024-01-01', '2027-12-31')

describe('calendar dates in this time zone (' + (process.env.TZ ?? 'default') + ')', () => {
  it('round-trip and count every day of 2024–2027 one apart', () => {
    expect(DAYS_2024_2027.length).toBe(366 + 365 + 365 + 365)
    for (let i = 0; i < DAYS_2024_2027.length; i++) {
      const d = DAYS_2024_2027[i]!
      expect(toYmd(d)).toBe(d)
      expect(dateToYmd(ymdToDate(d))).toBe(d)
      expect(localDateString(new Date(d + 'T00:00:00'))).toBe(d)
      if (i > 0) expect(daysBetween(DAYS_2024_2027[i - 1]!, d)).toBe(1)
    }
  })

  it.each([
    ['0026-10-11', null], ['1899-12-31', null], ['3000-01-01', null],
    ['1900-01-01', '1900-01-01'], ['2999-12-31', '2999-12-31'], ['2026-02-30', null], ['2028-02-29', '2028-02-29'],
  ])('reads %s as %s: half-typed or out-of-range years are not dates (AUDIT-112)', (value, expected) => {
    expect(toYmd(value)).toBe(expected)
  })

  it('keeps a two-digit year instead of mapping it to the 1900s (AUDIT-112)', () => {
    expect(ymdToDate('0026-03-01').getFullYear()).toBe(26)
  })

  it('shows no deadline for a half-typed year rather than one in 1927 (AUDIT-112)', () => {
    const rule = engineRuleFrom({ id: 1, kind: 'interval', interval_months: 12 })
    expect(evaluate(rule, { today: '2026-10-11', columnDate: '0026-03-01' }).due).toBeNull()
  })
})

describe('monthly repeats from month-end dates', () => {
  it.each([
    ['2026-01-31', ['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30']],
    ['2026-01-30', ['2026-02-28', '2026-03-30', '2026-04-30', '2026-05-30', '2026-06-30']],
    ['2026-01-29', ['2026-02-28', '2026-03-29', '2026-04-29', '2026-05-29', '2026-06-29']],
    ['2026-01-28', ['2026-02-28', '2026-03-28', '2026-04-28', '2026-05-28', '2026-06-28']],
    ['2028-01-31', ['2028-02-29', '2028-03-31', '2028-04-30', '2028-05-31', '2028-06-30']],
  ])('tasks from %s', (from, expected) => {
    const rule = { type: 'monthly' as const, interval: 1 }
    expect([1, 2, 3, 4, 5].map(n => addRepeats(from, rule, n))).toEqual(expected)
  })
})

describe('sequence "repeat after the last step" (AUDIT-004)', () => {
  const seq = (offset: SequenceConfig['steps'][number]['offset'], repeatLast: SequenceConfig['repeatLast']): SequenceConfig =>
    ({ kind: 'sequence', anchorColumnId: 'self', steps: [{ label: 'Review', offset }], repeatLast })
  const fiveDue = (cfg: SequenceConfig, anchor: string) => [0, 1, 2, 3, 4].map(i => sequenceStepDue(cfg, anchor, i, CAL)?.due)

  it.each([
    ['2026-01-31', ['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30']],
    ['2026-01-30', ['2026-02-28', '2026-03-30', '2026-04-30', '2026-05-30', '2026-06-30']],
    ['2026-01-29', ['2026-02-28', '2026-03-29', '2026-04-29', '2026-05-29', '2026-06-29']],
    ['2026-01-28', ['2026-02-28', '2026-03-28', '2026-04-28', '2026-05-28', '2026-06-28']],
  ])('monthly from an anchor of %s keeps its day of the month', (anchor, expected) => {
    expect(fiveDue(seq({ months: 1 }, { months: 1 }), anchor)).toEqual(expected)
  })

  it('six months then yearly from Aug 31 comes back to Feb 29 in leap years', () => {
    expect(fiveDue(seq({ months: 6 }, { months: 12 }), '2027-08-31'))
      .toEqual(['2028-02-29', '2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29'])
  })

  it('yearly from Feb 29 is Feb 28 in other years and Feb 29 again in a leap year', () => {
    expect(fiveDue(seq({ months: 12 }, { months: 12 }), '2028-02-29'))
      .toEqual(['2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29', '2033-02-28'])
  })

  it('a last step counted in days repeats from its own date', () => {
    expect(fiveDue(seq({ days: 45 }, { months: 12 }), '2026-01-10'))
      .toEqual(['2026-02-24', '2027-02-24', '2028-02-24', '2029-02-24', '2030-02-24'])
  })

  it('a repeat in days is added after the months', () => {
    expect(fiveDue(seq({ months: 1 }, { days: 30 }), '2026-01-31'))
      .toEqual(['2026-02-28', '2026-03-30', '2026-04-29', '2026-05-29', '2026-06-28'])
  })
})

describe('appointment wall times across daylight saving (AUDIT-111)', () => {
  it.each([
    ['2026-09-27T23:00', '2026-09-28T01:00', 120],
    ['2026-04-05T23:00', '2026-04-06T01:00', 120],
    ['2026-03-08T01:00', '2026-03-08T03:00', 120],
    ['2026-03-28T23:30', '2026-03-29T00:30', 60],
    ['2026-03-01T00:00', '2026-06-01T00:00', 92 * 1440],
    ['2026-10-31T22:00', '2026-11-01T02:00', 240],
  ])('%s to %s is %i minutes', (a, b, expected) => {
    expect(minutesBetween(a, b)).toBe(expected)
    expect(addMinutes(a, expected)).toBe(b)
  })
})

describe('relative times count calendar days (AUDIT-119)', () => {
  afterEach(() => { vi.useRealTimers() })
  it.each([
    [new Date(2026, 9, 11, 8, 0), new Date(2026, 9, 9, 9, 0), '2d ago'],
    [new Date(2026, 9, 11, 8, 0), new Date(2026, 9, 10, 23, 0), 'yesterday'],
    [new Date(2026, 9, 11, 8, 0), new Date(2026, 9, 10, 7, 0), 'yesterday'],
    [new Date(2026, 9, 11, 20, 0), new Date(2026, 9, 11, 8, 0), '12h ago'],
    [new Date(2026, 9, 11, 8, 0), new Date(2026, 9, 11, 7, 30), '30m ago'],
    [new Date(2026, 9, 11, 8, 0), new Date(2026, 9, 1, 8, 0), '1w ago'],
  ])('now %s, then %s: %s', (now, then, expected) => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    expect(relativeTime(then.getTime())).toBe(expected)
  })
})

describe('days from today across daylight saving (AUDIT-118)', () => {
  afterEach(() => { vi.useRealTimers() })
  it('adds calendar days, not 24-hour blocks, late in the evening', () => {
    vi.useFakeTimers()
    for (const day of DAYS_2024_2027.filter((_, i) => i % 3 === 0)) {
      const [y, m, d] = day.split('-').map(Number) as [number, number, number]
      vi.setSystemTime(new Date(y, m - 1, d, 23, 30))
      expect(daysBetween(day, localDateFromToday(1))).toBe(1)
      expect(daysBetween(day, localDateFromToday(30))).toBe(30)
    }
  })
})
