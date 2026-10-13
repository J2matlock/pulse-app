/**
 * Working a deadline backwards (Calendar: "Deadline for a record"): for each
 * rule kind, the stored date storedDateForDue() offers must make the engine
 * land on the chosen due date, across month ends, leap days, daylight-saving
 * changes, and business-day settings. Kinds that can't be worked backwards
 * say why.
 */
import { describe, it, expect } from 'vitest'
import { evaluate, type EngineRule, type CalendarConfig, type RelativeConfig } from '../src/shared/deadlineEngine'
import { storedDateForDue, type InverseContext } from '../src/shared/deadlineInverse'
import { addDays } from '../src/shared/ymd'
import type { RuleInterval } from '../src/shared/ruleInterval'

const interval = (iv: Partial<RuleInterval> = {}, extra: Partial<EngineRule> = {}): EngineRule => ({
  id: 1, kind: 'interval', interval: { days: 0, months: 0, endOfMonth: false, ...iv }, config: null, condition: null, businessDays: false, ...extra,
})
const withConfig = (kind: EngineRule['kind'], config: unknown, extra: Partial<EngineRule> = {}): EngineRule => ({ ...interval(), kind, config, ...extra })

/** The engine's due date with this value stored, the way the calendar would see it */
function dueOf(rule: EngineRule, stored: string, ctx: InverseContext = {}): string | null {
  const res = evaluate(rule, { today: '2026-10-12', columnDate: stored, values: ctx.values, holidays: ctx.holidays, weekend: ctx.weekend, previousDone: ctx.current ?? null })
  return res.due ?? res.upcoming ?? null
}

function roundTrip(rule: EngineRule, due: string, ctx: InverseContext = {}): string {
  const res = storedDateForDue(rule, due, ctx)
  if (!res.ok) throw new Error(`${due}: ${JSON.stringify(res.problem)}`)
  expect(dueOf(rule, res.value, ctx), `${due} via ${res.value}`).toBe(due)
  return res.value
}

/** Either it round-trips, or no stored date within ~2 years either side lands there (Feb 29 from a 12-month rule) */
function roundTripOrNone(rule: EngineRule, due: string, ctx: InverseContext = {}): void {
  const res = storedDateForDue(rule, due, ctx)
  if (res.ok) { expect(dueOf(rule, res.value, ctx), `${due} via ${res.value}`).toBe(due); return }
  for (let k = -800; k <= 800; k++) expect(dueOf(rule, addDays(due, k), ctx), `${due} is reachable from ${addDays(due, k)}`).not.toBe(due)
}

let seed = 7
const rand = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n }
const randomDate = () => addDays('2020-01-01', rand(365 * 12))

// Month ends, the leap day, and the daylight-saving changes in the US, Europe and Australia
const HARD_DATES = ['2024-02-29', '2028-02-29', '2025-02-28', '2026-01-31', '2026-03-31', '2026-04-30', '2026-12-31',
  '2026-03-08', '2026-03-09', '2026-03-29', '2026-03-30', '2026-10-25', '2026-10-26', '2026-11-01', '2026-11-02', '2026-04-05', '2026-10-04']

describe('interval rules', () => {
  it('store the due date minus the interval', () => {
    expect(roundTrip(interval({ days: 30 }), '2026-03-31')).toBe('2026-03-01')
    expect(roundTrip(interval({ months: 6 }), '2026-09-03')).toBe('2026-03-03')
    expect(roundTrip(interval({ months: 12 }), '2026-10-20')).toBe('2025-10-20')
    // A one-off date is its own deadline
    expect(roundTrip(interval(), '2026-10-20')).toBe('2026-10-20')
  })

  it('handle month ends and the leap day', () => {
    // Feb 29 + 12 months is Feb 28 the next year; working back from Feb 28 still lands there
    expect(dueOf(interval({ months: 12 }), roundTrip(interval({ months: 12 }), '2025-02-28'))).toBe('2025-02-28')
    // ...but nothing a year before lands on Feb 29, so it says which days can be chosen
    expect(storedDateForDue(interval({ months: 12 }), '2024-02-29')).toEqual({ ok: false, problem: { code: 'unreachable', nearest: ['2024-02-28', '2024-03-01'] } })
    expect(roundTrip(interval({ months: 1 }), '2024-02-29')).toBe('2024-01-29')
    for (const due of HARD_DATES) for (const iv of [{ days: 1 }, { days: 30 }, { days: 90 }, { months: 1 }, { months: 3 }, { months: 12 }, { months: 24 }]) roundTripOrNone(interval(iv), due)
  })

  it('round-trip thousands of random dates and intervals', () => {
    for (let i = 0; i < 3000; i++) {
      const iv = rand(2) ? { days: 1 + rand(400) } : { months: 1 + rand(36) }
      roundTripOrNone(interval(iv), randomDate())
    }
  })

  it('"due by the end of the month" can only be due on a last day', () => {
    const r = interval({ months: 1, endOfMonth: true })
    expect(dueOf(r, roundTrip(r, '2026-04-30'))).toBe('2026-04-30')
    roundTrip(interval({ days: 30, endOfMonth: true }), '2026-02-28')
    roundTrip(interval({ months: 12, endOfMonth: true }), '2024-02-29')
    roundTrip(interval({ months: 1, endOfMonth: true }), '2026-02-28')
    const res = storedDateForDue(r, '2026-04-15')
    expect(res).toEqual({ ok: false, problem: { code: 'month_end', nearest: ['2026-03-31', '2026-04-30'] } })
  })
})

describe('business days', () => {
  const holidays = new Set(['2026-11-26', '2026-12-25', '2027-01-01'])
  const ctx = { holidays }

  it('land on working days, rolling back or forward like the engine', () => {
    for (const rollForward of [false, true]) {
      const r = interval({ days: 30 }, { businessDays: true, rollForward })
      // Wed Nov 25, the day before Thanksgiving; Fri Nov 27 after it
      roundTrip(r, '2026-11-25', ctx)
      roundTrip(r, '2026-11-27', ctx)
      for (let i = 0; i < 500; i++) {
        const due = randomDate()
        const res = storedDateForDue(r, due, ctx)
        const dayOff = [0, 6].includes(new Date(`${due}T12:00`).getDay()) || holidays.has(due)
        expect(res.ok, due).toBe(!dayOff)
        if (res.ok) expect(dueOf(r, res.value, ctx)).toBe(due)
      }
    }
  })

  it('say which working days are nearest when a day off is chosen', () => {
    const r = interval({ months: 1 }, { businessDays: true })
    expect(storedDateForDue(r, '2026-12-25', ctx)).toEqual({ ok: false, problem: { code: 'day_off', nearest: ['2026-12-24', '2026-12-28'] } })
    // A Saturday, with a Monday-to-Saturday week
    expect(storedDateForDue(r, '2026-10-17', { weekend: [0] }).ok).toBe(true)
  })
})

describe('relative rules', () => {
  const rel = (offset: RelativeConfig['offset'], anchorColumnId: RelativeConfig['anchorColumnId'] = 'self', extra: Partial<EngineRule> = {}) =>
    withConfig('relative', { kind: 'relative', anchorColumnId, offset } satisfies RelativeConfig, extra)

  it('counted from their own column work back to it', () => {
    expect(roundTrip(rel({ days: 90, direction: 'after' }), '2026-12-31')).toBe('2026-10-02')
    expect(roundTrip(rel({ days: 60, direction: 'before' }), '2026-10-02')).toBe('2026-12-01')
    for (const due of HARD_DATES) {
      roundTripOrNone(rel({ months: 6, direction: 'after' }), due)
      roundTripOrNone(rel({ months: 1, days: 10, direction: 'before' }), due)
    }
  })

  it('with working days, round-trip on working days', () => {
    const holidays = new Set(['2026-11-26'])
    const r = rel({ businessDays: 10, direction: 'before' })
    const s = rel({ businessDays: 5, days: 3, direction: 'after' }, 'self', { businessDays: true })
    for (let i = 0; i < 400; i++) {
      const due = randomDate()
      if ([0, 6].includes(new Date(`${due}T12:00`).getDay()) || holidays.has(due)) continue
      roundTrip(r, due, { holidays })
      roundTrip(s, due, { holidays })
    }
  })

  it('worked out from another column cannot be set here', () => {
    expect(storedDateForDue(rel({ days: 45, direction: 'after' }, 12), '2026-11-01')).toEqual({ ok: false, problem: { code: 'anchored', columnId: 12 } })
  })
})

describe('calendar rules', () => {
  const cal = (cfg: Omit<CalendarConfig, 'kind'>, extra: Partial<EngineRule> = {}) => withConfig('calendar', { kind: 'calendar', ...cfg }, extra)

  it('store the scheduled date before, so the chosen one is next', () => {
    const quarterly = cal({ months: [1, 4, 6, 9], day: 15 })
    expect(roundTrip(quarterly, '2026-06-15')).toBe('2026-04-15')
    expect(roundTrip(quarterly, '2027-01-15')).toBe('2026-09-15')
    const monthlyLast = cal({ months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], day: 'last' })
    expect(roundTrip(monthlyLast, '2024-02-29')).toBe('2024-01-31')
    expect(roundTrip(monthlyLast, '2026-03-31')).toBe('2026-02-28')
    // With a lead time the date isn't shown yet, but it's still the one that comes next
    roundTrip(cal({ months: [3], day: 31, lead: 30 }), '2027-03-31')
  })

  it('agree with the engine when the old date is replaced (late-completion check)', () => {
    const quarterly = cal({ months: [1, 4, 7, 10], day: 15 })
    // Whatever was there before, the stored date leads to the chosen one
    for (const current of [null, '2026-01-20', '2026-05-20', '2026-07-14', '2026-12-01']) roundTrip(quarterly, '2026-10-15', { current })
  })

  it('anniversaries come from their date column', () => {
    const r = cal({ fromColumnMonth: 7 })
    expect(roundTrip(r, '2027-05-04', { values: { 7: '2019-05-04' } })).toBe('2026-05-04')
    // Born Feb 29: due Feb 28 in other years
    roundTrip(r, '2028-02-29', { values: { 7: '2016-02-29' } })
    expect(storedDateForDue(r, '2027-05-04', { values: {} })).toEqual({ ok: false, problem: { code: 'needs_date', columnId: 7 } })
  })

  it('off the schedule, name the nearest scheduled dates', () => {
    const quarterly = cal({ months: [1, 4, 6, 9], day: 15 })
    expect(storedDateForDue(quarterly, '2026-06-20')).toEqual({ ok: false, problem: { code: 'not_on_schedule', nearest: ['2026-06-15', '2026-09-15'] } })
  })

  it('with business days, the working day it moves to can be chosen; the day off itself cannot', () => {
    // Aug 15, 2026 is a Saturday: the engine shows it on Friday Aug 14
    const r = cal({ months: [2, 5, 8, 11], day: 15 }, { businessDays: true })
    roundTrip(r, '2026-08-14')
    expect(storedDateForDue(r, '2026-08-15')).toMatchObject({ ok: false, problem: { code: 'day_off' } })
  })

  it('round-trip every scheduled date over several years', () => {
    const rules = [cal({ months: [1, 4, 7, 10], day: 31 }), cal({ months: [2], day: 29 }), cal({ months: [3, 9], day: 'last' }), cal({ months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], day: 30 })]
    for (const r of rules) {
      const cfg = r.config as CalendarConfig
      for (let y = 2023; y <= 2029; y++) for (const m of cfg.months!) {
        const last = new Date(y, m, 0).getDate()
        const day = cfg.day === 'last' ? last : Math.min(cfg.day as number, last)
        roundTrip(r, `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`)
      }
    }
  })
})

describe('kinds that cannot be worked backwards', () => {
  it('say so', () => {
    const meter = withConfig('meter', { kind: 'meter', readingColumnId: 1, lastServiceReadingColumnId: 2, every: 5000, unit: 'miles' })
    const quota = withConfig('quota', { kind: 'quota', activityTypes: ['visit'], limit: 12, startColumnId: 1, endColumnId: 2, warnRemaining: 2, warnDaysBeforeEnd: 14 })
    const sequence = withConfig('sequence', { kind: 'sequence', anchorColumnId: 'self', steps: [{ label: 'Plan', offset: { days: 45 } }] })
    expect(storedDateForDue(meter, '2026-11-01')).toEqual({ ok: false, problem: { code: 'meter' } })
    expect(storedDateForDue(quota, '2026-11-01')).toEqual({ ok: false, problem: { code: 'quota' } })
    expect(storedDateForDue(sequence, '2026-11-01')).toEqual({ ok: false, problem: { code: 'sequence' } })
  })

  it('a kind whose settings are unreadable works as a plain interval, like the engine', () => {
    expect(roundTrip(withConfig('meter', null, { interval: { days: 10, months: 0, endOfMonth: false } }), '2026-11-11')).toBe('2026-11-01')
  })

  it('refuses a date that is not a real day', () => {
    expect(storedDateForDue(interval({ days: 1 }), '2026-02-30').ok).toBe(false)
    expect(storedDateForDue(interval({ days: 1 }), 'soon').ok).toBe(false)
  })
})
