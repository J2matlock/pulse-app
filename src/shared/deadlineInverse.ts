/**
 * Working a deadline backwards: given the day something should be due, the
 * date to store in the rule's own column so the engine lands on that day.
 * Used by "Deadline for a record" on the Calendar.
 *
 * Each kind proposes a first guess (the due date minus the interval, the
 * occurrence before it…), then every guess is checked by running the engine
 * forwards, so a stored date is only offered when evaluate() really gives
 * the chosen day back (business days, days off, month ends and all). Kinds
 * whose due date doesn't come from their own column (meters, quotas,
 * sequences, dates worked out from another column) can't be set this way.
 */
import { evaluate, applyOffset, dayIn, occurrenceOnOrBefore, toYmd, type CalendarConfig, type EngineRule, type RelativeConfig } from './deadlineEngine'
import { DEFAULT_WEEKEND, isDayOff, rollBackToBusinessDay, rollForwardToBusinessDay, type WorkCalendar } from './businessDays'
import { addDays, dateToYmd, ymdToDate } from './ymd'
import { unhandledCase } from './assertNever'

/** Why a due date can't be set; main turns these into words */
export type InverseProblem =
  /** Meter, quota and sequence rules: the date comes from readings, counts or steps */
  | { code: 'meter' | 'quota' | 'sequence' }
  /** Worked out from another date column; that date would have to change */
  | { code: 'anchored'; columnId: number }
  /** An anniversary rule whose date column is empty */
  | { code: 'needs_date'; columnId: number }
  /** The rule can't land on that day; `nearest` are days it can land on */
  | { code: 'day_off' | 'month_end' | 'not_on_schedule' | 'unreachable'; nearest: string[] }

export type InverseResult = { ok: true; value: string } | { ok: false; problem: InverseProblem }

export interface InverseContext {
  /** Other columns the rule reads (an anniversary's date) */
  values?: Record<number, string | null>
  holidays?: Set<string>
  weekend?: number[]
  /** What the column holds now: once it's replaced, the engine sees it as the previous date */
  current?: string | null
}

/** How far either side of the first guess to look for a stored date that works */
const SEARCH_DAYS = 45

function calendarOf(ctx: InverseContext): WorkCalendar {
  return { holidays: ctx.holidays ?? new Set(), weekend: ctx.weekend ?? DEFAULT_WEEKEND }
}

/** The day the engine says is due when `stored` is in the column; conditions and extensions left out */
function dueWith(rule: EngineRule, stored: string, ctx: InverseContext): string | null {
  const res = evaluate({ ...rule, condition: null }, {
    // Today only changes the state, never the date (calendar lead times aside, which show as `upcoming`)
    today: stored, columnDate: stored, values: ctx.values, holidays: ctx.holidays, weekend: ctx.weekend,
    previousDone: toYmd(ctx.current ?? null),
  })
  return res.due ?? res.upcoming ?? null
}

/** The first guess, then the days around it, nearest first */
function search(rule: EngineRule, due: string, guess: string, ctx: InverseContext): string | null {
  for (let k = 0; k <= SEARCH_DAYS; k++) {
    for (const c of k === 0 ? [guess] : [addDays(guess, -k), addDays(guess, k)]) {
      if (dueWith(rule, c, ctx) === due) return c
    }
  }
  return null
}

/** Calendar-correct months back: Mar 31 − 1 month = Feb 28/29 */
function monthsBack(ymd: string, months: number): string {
  const d = ymdToDate(ymd)
  const total = d.getFullYear() * 12 + d.getMonth() - months
  const y = Math.floor(total / 12)
  const m = total - y * 12
  return dateToYmd(new Date(y, m, Math.min(d.getDate(), new Date(y, m + 1, 0).getDate())))
}

const lastOfMonth = (ymd: string) => { const d = ymdToDate(ymd); return dateToYmd(new Date(d.getFullYear(), d.getMonth() + 1, 0)) }

/** The months and day a calendar rule is due on, or null when its anniversary date is missing */
function schedule(cfg: CalendarConfig, values: Record<number, string | null> | undefined): { months: number[]; day: number | 'last' } | null {
  if (cfg.fromColumnMonth) {
    const from = toYmd(values?.[cfg.fromColumnMonth] ?? null)
    if (!from) return null
    return { months: [Number(from.slice(5, 7))], day: Number(from.slice(8, 10)) }
  }
  return { months: [...new Set(cfg.months ?? [])].sort((a, b) => a - b), day: cfg.day ?? 1 }
}

/** The first date in the schedule strictly after `ymd` */
function occurrenceAfter(months: number[], day: number | 'last', ymd: string): string | null {
  const y = Number(ymd.slice(0, 4))
  for (let year = y; year <= y + 2; year++) {
    for (const m of months) { const d = dayIn(year, m, day); if (d > ymd) return d }
  }
  return null
}

function problemFor(rule: EngineRule, due: string, ctx: InverseContext, nearestOnSchedule: string[] | undefined, suggest: boolean): InverseProblem {
  const cal = calendarOf(ctx)
  if (nearestOnSchedule) return { code: 'not_on_schedule', nearest: nearestOnSchedule }
  if (rule.businessDays && isDayOff(due, cal)) {
    return { code: 'day_off', nearest: [rollBackToBusinessDay(due, cal), rollForwardToBusinessDay(due, cal)] }
  }
  if (rule.kind === 'interval' && rule.interval.endOfMonth && due !== lastOfMonth(due)) {
    return { code: 'month_end', nearest: [addDays(due.slice(0, 8) + '01', -1), lastOfMonth(due)] }
  }
  return { code: 'unreachable', nearest: suggest ? nearestReachable(rule, due, ctx) : [] }
}

/** The closest days on either side that can be chosen instead (Feb 28 and Mar 1 for a yearly rule's Feb 29) */
function nearestReachable(rule: EngineRule, due: string, ctx: InverseContext): string[] {
  const out: string[] = []
  for (const dir of [-1, 1]) {
    for (let k = 1; k <= 3; k++) {
      const d = addDays(due, dir * k)
      if (storedDateForDue(rule, d, ctx, false).ok) { out.push(d); break }
    }
  }
  return out
}

/**
 * The date to store in the rule's column so it's due on `due`, or why it
 * can't be. The value is checked: evaluate() with it gives `due` back.
 */
export function storedDateForDue(rule: EngineRule, due: string, ctx: InverseContext = {}, suggest = true): InverseResult {
  if (!toYmd(due) || toYmd(due) !== due) return { ok: false, problem: { code: 'unreachable', nearest: [] } }
  const cal = calendarOf(ctx)
  const found = (guess: string, onSchedule?: string[]): InverseResult => {
    const value = search(rule, due, guess, ctx)
    return value ? { ok: true, value } : { ok: false, problem: problemFor(rule, due, ctx, onSchedule, suggest) }
  }
  // Kinds without their settings are worked out as plain intervals by the engine
  const kind = rule.config ? rule.kind : 'interval'
  switch (kind) {
    case 'interval': {
      const iv = rule.interval
      return found(iv.months > 0 ? monthsBack(due, iv.months) : addDays(due, -iv.days))
    }
    case 'relative': {
      const cfg = rule.config as RelativeConfig
      if (cfg.anchorColumnId !== 'self') return { ok: false, problem: { code: 'anchored', columnId: cfg.anchorColumnId } }
      // Undo the offset in reverse order: working days, then days, then months
      const o = cfg.offset
      const back = o.direction === 'after' ? 'before' : 'after'
      let guess = o.businessDays ? applyOffset(due, { businessDays: o.businessDays, direction: back }, cal) : due
      if (o.days) guess = applyOffset(guess, { days: o.days, direction: back }, cal)
      if (o.months) guess = applyOffset(guess, { months: o.months, direction: back }, cal)
      return found(guess)
    }
    case 'calendar': {
      const cfg = rule.config as CalendarConfig
      const s = schedule(cfg, ctx.values)
      if (!s) return { ok: false, problem: { code: 'needs_date', columnId: cfg.fromColumnMonth! } }
      if (s.months.length === 0) return { ok: false, problem: { code: 'unreachable', nearest: [] } }
      // Done on the date before: then the next one is due
      const before = occurrenceOnOrBefore(s.months, s.day, addDays(due, -1))
      const onDay = occurrenceOnOrBefore(s.months, s.day, due) === due
      const nearest = [occurrenceOnOrBefore(s.months, s.day, due), occurrenceAfter(s.months, s.day, due)].filter((d): d is string => !!d && d !== due)
      // A business-day rule moves the scheduled date to a working day, so check the engine either way
      if (!before) return { ok: false, problem: { code: 'unreachable', nearest } }
      const res = found(before, onDay ? undefined : nearest)
      if (res.ok || onDay) return res
      return { ok: false, problem: { code: 'not_on_schedule', nearest } }
    }
    case 'meter':
    case 'quota':
    case 'sequence':
      return { ok: false, problem: { code: kind } }
    default:
      unhandledCase(kind)
      return { ok: false, problem: { code: 'unreachable', nearest: [] } }
  }
}
