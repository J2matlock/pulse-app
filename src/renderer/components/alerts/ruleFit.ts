import type { ParsedAlertRule } from '../../../shared/types'
import { engineRuleFrom, referencedColumns } from '../../../shared/deadlineEngine'

/**
 * Whether a rule can work on a list with these columns: it needs no other
 * columns, or all the ones it reads are there (D-10). A rule that reads
 * another list's columns would show nothing here.
 */
export function ruleFitsList(rule: Pick<ParsedAlertRule, 'id' | 'kind' | 'rule_config' | 'rule_condition' | 'interval_days' | 'interval_months' | 'end_of_month' | 'business_days'>, columnIds: Set<number>): boolean {
  return referencedColumns(engineRuleFrom(rule)).every(id => columnIds.has(id))
}

/** Rules that fit this list first, then the ones that don't. */
export function splitRulesByFit<T extends ParsedAlertRule>(rules: T[], columnIds: Set<number>): { fits: T[]; others: T[] } {
  const fits: T[] = [], others: T[] = []
  for (const r of rules) (ruleFitsList(r, columnIds) ? fits : others).push(r)
  return { fits, others }
}
