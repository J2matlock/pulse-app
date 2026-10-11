/**
 * Repeating tasks and checklist items: the next due date when one is ticked
 * off. Both store the rule as JSON, {"type":"weekly","interval":2,"end_date":"2027-01-31"}.
 * Dates are local calendar dates ('YYYY-MM-DD'). Monthly and yearly rules
 * may also carry `day`, the day of the month they're meant to fall on.
 */
import { toYmd, ymdToDate, dateToYmd } from './ymd'

export type RepeatType = 'daily' | 'weekly' | 'monthly' | 'yearly'
/**
 * `day` is the day of the month a monthly or yearly repeat is meant to fall
 * on. A task due on the 31st comes back on Feb 28, and without it the next
 * one would be Mar 28 and the 28th for good. It's written when the item is
 * ticked off (see withAnchorDay).
 */
export interface RepeatRule { type: RepeatType; interval: number; end_date?: string; day?: number }

const TYPES = new Set<string>(['daily', 'weekly', 'monthly', 'yearly'])

/** The rule from its stored JSON, or null when there isn't a usable one */
export function parseRepeatRule(json: string | null | undefined): RepeatRule | null {
  if (!json) return null
  try {
    const r = JSON.parse(json) as { type?: unknown; interval?: unknown; end_date?: unknown; day?: unknown }
    if (typeof r.type !== 'string' || !TYPES.has(r.type)) return null
    const interval = typeof r.interval === 'number' && Number.isInteger(r.interval) && r.interval > 0 ? Math.min(r.interval, 999) : 1
    const end = typeof r.end_date === 'string' ? toYmd(r.end_date) : null
    const day = typeof r.day === 'number' && Number.isInteger(r.day) && r.day >= 1 && r.day <= 31 ? r.day : null
    return { type: r.type as RepeatType, interval, ...(end ? { end_date: end } : {}), ...(day ? { day } : {}) }
  } catch { return null }
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

/**
 * The day of the month a monthly or yearly repeat falls on, counted from
 * `date`. The rule's `day` only counts when `date` is the last day of a
 * month shorter than it (Feb 28 standing in for the 31st). A date moved by
 * hand to the middle of a month uses its own day.
 */
export function anchorDay(date: string, rule: RepeatRule): number {
  const d = ymdToDate(date)
  const own = d.getDate()
  if (rule.day && rule.day > own && own === lastDayOfMonth(d.getFullYear(), d.getMonth())) return rule.day
  return own
}

/** A date moved on by `steps` repeats; the 31st lands on the last day of shorter months */
export function addRepeats(date: string, rule: RepeatRule, steps = 1): string {
  const d = ymdToDate(date)
  const n = rule.interval * steps
  if (rule.type === 'daily') return dateToYmd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n))
  if (rule.type === 'weekly') return dateToYmd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n * 7))
  const months = rule.type === 'monthly' ? n : n * 12
  const target = new Date(d.getFullYear(), d.getMonth() + months, 1)
  const last = lastDayOfMonth(target.getFullYear(), target.getMonth())
  return dateToYmd(new Date(target.getFullYear(), target.getMonth(), Math.min(anchorDay(date, rule), last)))
}

/**
 * The stored rule JSON with the day of the month it's meant to fall on,
 * worked out from the due date being ticked off. Saved with the next due
 * date, so a repeat that had to land on a shorter month's last day goes back
 * to the 31st (or the 29th, or the 30th) after it. Other rules, and rules
 * without a due date, come back as they were.
 */
export function withAnchorDay(json: string | null | undefined, due: string | null | undefined): string | null {
  if (!json) return json ?? null
  const rule = parseRepeatRule(json)
  const from = toYmd(due)
  if (!rule || !from || (rule.type !== 'monthly' && rule.type !== 'yearly')) return json
  const day = anchorDay(from, rule)
  if (rule.day === day) return json
  try {
    return JSON.stringify({ ...(JSON.parse(json) as Record<string, unknown>), day })
  } catch { return json }
}

/**
 * The stored rule JSON without its `day`, for when the due date is changed by
 * hand: the new date sets the pattern from then on (moving a task anchored on
 * the 31st to Feb 28 means "the 28th", AUDIT-114). Ticking it off writes a
 * fresh `day` from the new date. Anything else comes back as it was.
 */
export function withoutAnchorDay(json: string | null | undefined): string | null {
  if (!json) return json ?? null
  try {
    const parsed = JSON.parse(json) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !('day' in parsed)) return json
    const rest = { ...(parsed as Record<string, unknown>) }
    delete rest.day
    return JSON.stringify(rest)
  } catch { return json }
}

/**
 * The next due date after ticking one off today. With a due date, the
 * next one after it. An item ticked off late rolls on past today (a weekly
 * item three weeks late comes back next week, not still overdue, and not
 * straight back as "due today": AUDIT-113). One ticked off on time or early
 * just moves one repeat on. Without a due date, one repeat from today.
 * Null when the rule's end date has passed (the end date itself still counts).
 */
export function nextRepeatDate(due: string | null | undefined, rule: RepeatRule, today: string): string | null {
  const from = toYmd(due)
  let next: string
  if (!from) {
    next = addRepeats(today, rule)
  } else {
    let steps = 1
    next = addRepeats(from, rule, steps)
    // Counted from the due date each time, so month-end dates don't drift
    const late = from < today
    while ((late ? next <= today : next < today) && steps < 100_000) next = addRepeats(from, rule, ++steps)
  }
  if (rule.end_date && next > rule.end_date) return null
  return next
}

/** "Every week" / "Every 2 months" */
export function describeRepeat(rule: RepeatRule): string {
  const unit = rule.type === 'daily' ? 'day' : rule.type === 'weekly' ? 'week' : rule.type === 'monthly' ? 'month' : 'year'
  return rule.interval === 1 ? `Every ${unit}` : `Every ${rule.interval} ${unit}s`
}
