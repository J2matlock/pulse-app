/**
 * The quick answers to "Does this date come due again?" (D-15): a plain
 * repeating rule, or "the date is the deadline". An identical rule that
 * already exists is reused rather than adding "Every year 2".
 */
import type { AlertThreshold, ParsedAlertRule, AlertRule } from '../../../shared/types'
import { describeInterval, toRuleInterval } from '../../../shared/ruleInterval'

/** The colors a new rule starts with */
export const DEFAULT_THRESHOLDS: AlertThreshold[] = [
  { daysBefore: 60, bgClass: '#bbf7d0', label: 'Upcoming' },
  { daysBefore: 30, bgClass: '#facc15', label: 'Due Soon' },
  { daysBefore: 14, bgClass: '#fb923c', label: 'Urgent' },
  { daysBefore: 0, bgClass: '#dc2626', label: 'Due Today' },
  { daysBefore: -1, bgClass: 'alert-pulse-dark', label: 'Overdue' },
]

export type DeadlineChoice =
  | { mode: 'none' }
  | { mode: 'every'; n: number; unit: 'months' | 'years' }
  | { mode: 'due' }
  | { mode: 'more' }

/** The rule a quick answer stands for, as interval fields */
export function plainInterval(choice: DeadlineChoice): { interval_days: number | null; interval_months: number | null } | null {
  if (choice.mode === 'due') return { interval_days: null, interval_months: null }
  if (choice.mode === 'every' && Number.isInteger(choice.n) && choice.n > 0) {
    const months = choice.unit === 'years' ? choice.n * 12 : choice.n
    return months <= 120 ? { interval_days: null, interval_months: months } : null
  }
  return null
}

/** An existing plain rule that works out the same, if there is one. */
export function findPlainRule(rules: ParsedAlertRule[], iv: { interval_days: number | null; interval_months: number | null }): ParsedAlertRule | undefined {
  const want = toRuleInterval(iv)
  return rules.find(r => {
    if ((r.kind ?? 'interval') !== 'interval' || r.rule_condition || r.business_days) return false
    const have = toRuleInterval(r)
    return have.days === want.days && have.months === want.months && have.endOfMonth === want.endOfMonth
  })
}

/** Reuse or make the rule for a quick answer; returns its id, or null for "no" / "more options". */
export async function ensurePlainRule(choice: DeadlineChoice, rules: ParsedAlertRule[],
  createRule: (rule: Omit<AlertRule, 'id' | 'created_at'>) => Promise<number | null>): Promise<number | null> {
  const iv = plainInterval(choice)
  if (!iv) return null
  const existing = findPlainRule(rules, iv)
  if (existing) return existing.id
  const base = describeInterval(toRuleInterval(iv))
  const taken = new Set(rules.map(r => r.name.toLowerCase()))
  let name = base
  for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${base} (${i})`
  return createRule({ name, description: null, is_system: 0, thresholds: JSON.stringify(DEFAULT_THRESHOLDS), ...iv, end_of_month: 0, kind: 'interval', rule_config: null, rule_condition: null, business_days: 0 })
}
