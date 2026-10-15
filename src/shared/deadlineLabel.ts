/**
 * What to call a deadline (persona study R6). Usually it's its column
 * ("Annual review"). A rule whose date is worked out from another column
 * ("12 months after Decision date") lives in the column where you record that
 * it's done ("Appeal filed"), so the column's name says the opposite of what's
 * due: then the rule's name ("Appeal window") is the title, and the column is
 * where Done goes.
 */
import { parseRuleConfig, type RelativeConfig } from './deadlineEngine'

export interface DeadlineLabel {
  /** What's due */
  title: string
  /** The column Done fills in */
  doneLabel: string
}

export function deadlineLabel(
  rule: { name: string; kind?: string | null; rule_config?: string | null } | null | undefined,
  column: { name: string },
): DeadlineLabel {
  const plain = { title: column.name, doneLabel: column.name }
  if (!rule || rule.kind !== 'relative' || !rule.name.trim()) return plain
  const cfg = parseRuleConfig('relative', rule.rule_config ?? null)
  if (!cfg.ok || !cfg.config) return plain
  const anchor = (cfg.config as RelativeConfig).anchorColumnId
  return anchor === 'self' ? plain : { title: rule.name.trim(), doneLabel: column.name }
}
