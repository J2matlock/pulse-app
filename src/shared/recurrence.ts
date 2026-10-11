/**
 * Repeating tasks and checklist items: the next due date when one is ticked
 * off. Both store the rule as JSON, {"type":"weekly","interval":2,"end_date":"2027-01-31"}.
 * Dates are local calendar dates ('YYYY-MM-DD').
 */
import { toYmd, ymdToDate, dateToYmd } from './ymd'

export type RepeatType = 'daily' | 'weekly' | 'monthly' | 'yearly'
export interface RepeatRule { type: RepeatType; interval: number; end_date?: string }

const TYPES = new Set<string>(['daily', 'weekly', 'monthly', 'yearly'])

/** The rule from its stored JSON, or null when there isn't a usable one */
export function parseRepeatRule(json: string | null | undefined): RepeatRule | null {
  if (!json) return null
  try {
    const r = JSON.parse(json) as { type?: unknown; interval?: unknown; end_date?: unknown }
    if (typeof r.type !== 'string' || !TYPES.has(r.type)) return null
    const interval = typeof r.interval === 'number' && Number.isInteger(r.interval) && r.interval > 0 ? Math.min(r.interval, 999) : 1
    const end = typeof r.end_date === 'string' ? toYmd(r.end_date) : null
    return { type: r.type as RepeatType, interval, ...(end ? { end_date: end } : {}) }
  } catch { return null }
}

/** A date moved on by `steps` repeats; the 31st lands on the last day of shorter months */
export function addRepeats(date: string, rule: RepeatRule, steps = 1): string {
  const d = ymdToDate(date)
  const n = rule.interval * steps
  if (rule.type === 'daily') return dateToYmd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n))
  if (rule.type === 'weekly') return dateToYmd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n * 7))
  const months = rule.type === 'monthly' ? n : n * 12
  const target = new Date(d.getFullYear(), d.getMonth() + months, 1)
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  return dateToYmd(new Date(target.getFullYear(), target.getMonth(), Math.min(d.getDate(), last)))
}

/**
 * The next due date after ticking one off today. With a due date, the
 * next one after it, rolled forward until it's today or later (a weekly
 * item three weeks late comes back due this week, not still overdue).
 * Without one, one repeat from today. Null when the rule's end date has
 * passed (the end date itself still counts).
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
    while (next < today && steps < 100_000) next = addRepeats(from, rule, ++steps)
  }
  if (rule.end_date && next > rule.end_date) return null
  return next
}

/** "Every week" / "Every 2 months" */
export function describeRepeat(rule: RepeatRule): string {
  const unit = rule.type === 'daily' ? 'day' : rule.type === 'weekly' ? 'week' : rule.type === 'monthly' ? 'month' : 'year'
  return rule.interval === 1 ? `Every ${unit}` : `Every ${rule.interval} ${unit}s`
}
