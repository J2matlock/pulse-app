/**
 * How a deadline rule turns a stored date into a due date.
 *
 * - days:   "30 days after" (the original behavior)
 * - months: calendar months; years are 12 months. Calendar-correct: Jan 31 +
 *           1 month = Feb 28/29 (never spills into March), and an anniversary
 *           stays on the same date every year.
 * - endOfMonth: the deadline moves to the last day of the month it lands in
 *           ("due by the end of the month").
 *
 * Used by the deadline engine (shared/deadlineEngine.ts), so main and the window always agree.
 */

export interface RuleInterval {
  days: number
  months: number
  endOfMonth: boolean
}

export const NO_INTERVAL: RuleInterval = { days: 0, months: 0, endOfMonth: false }

interface RuleLike {
  interval_days?: number | null
  interval_months?: number | null
  end_of_month?: number | boolean | null
}

/** Normalize a rule (or a bare day count, as older callers pass) into an interval. */
export function toRuleInterval(rule: RuleLike | number | null | undefined): RuleInterval {
  if (rule == null) return NO_INTERVAL
  if (typeof rule === 'number') return { days: Math.max(0, rule), months: 0, endOfMonth: false }
  const months = Math.max(0, rule.interval_months ?? 0)
  return {
    // Months take precedence; a rule is one or the other
    days: months > 0 ? 0 : Math.max(0, rule.interval_days ?? 0),
    months,
    endOfMonth: !!rule.end_of_month,
  }
}

export function hasInterval(iv: RuleInterval): boolean {
  return iv.days > 0 || iv.months > 0 || iv.endOfMonth
}

/** Calendar-correct: add the interval to a local date (time is ignored). */
export function addInterval(date: Date, iv: RuleInterval): Date {
  let y = date.getFullYear()
  let m = date.getMonth()
  let d = date.getDate()
  if (iv.months > 0) {
    const total = m + iv.months
    y += Math.floor(total / 12)
    m = total % 12
    const daysInTarget = new Date(y, m + 1, 0).getDate()
    d = Math.min(d, daysInTarget)
  }
  let result = new Date(y, m, d)
  if (iv.days > 0) result = new Date(result.getFullYear(), result.getMonth(), result.getDate() + iv.days)
  if (iv.endOfMonth) result = new Date(result.getFullYear(), result.getMonth() + 1, 0)
  return result
}

/** Plain-English description, e.g. "Every 6 months, due by the end of the month". */
export function describeInterval(iv: RuleInterval): string {
  const base = iv.months > 0
    ? (iv.months % 12 === 0
      ? (iv.months === 12 ? 'Every year' : `Every ${iv.months / 12} years`)
      : (iv.months === 1 ? 'Every month' : `Every ${iv.months} months`))
    : iv.days > 0 ? `${iv.days} days after the date entered` : 'The date entered is the deadline'
  return iv.endOfMonth ? `${base}, due by the end of that month` : base
}
