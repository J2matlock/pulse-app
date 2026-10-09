/**
 * builtin-templates.ts — deadline rules and role templates that ship with Pulse.
 *
 * Bump BUILTIN_TEMPLATES_VERSION whenever these change: existing installs then
 * get updated built-ins (and any templates new in that version) without
 * resurrecting built-ins the user deleted.
 */

import type { PulseFile, PulseTemplateAlertRule } from './templates'
import { localDateString } from '../shared/dates'
import { parseStarter } from '../shared/starters/schema'
import humanServices from '../shared/starters/human-services.json'

export const BUILTIN_TEMPLATES_VERSION = 5

type RuleKey = 'due' | 'monthly' | 'every60' | 'quarterly' | 'semiannual' | 'annual'

const t = (daysBefore: number, bgClass: string, label: string) => ({ daysBefore, bgClass, label })
const DUE_SOON = [t(30, '#bbf7d0', 'Coming up'), t(14, '#facc15', 'Due soon'), t(7, '#fb923c', 'Urgent'), t(0, '#dc2626', 'Due today'), t(-1, 'alert-pulse-dark', 'Overdue')]
const SHORT_CYCLE = [t(7, '#facc15', 'Due soon'), t(3, '#fb923c', 'Urgent'), t(0, '#dc2626', 'Due today'), t(-1, 'alert-pulse-dark', 'Overdue')]
const LONG_CYCLE = [t(60, '#bbf7d0', 'Coming up'), t(30, '#facc15', 'Due soon'), t(14, '#fb923c', 'Urgent'), t(0, '#dc2626', 'Due today'), t(-1, 'alert-pulse-dark', 'Overdue')]

/**
 * The rule for "every N days/months/years after the date entered" (setup's
 * "Which of these dates repeat?"). Uses the standard rule when one matches.
 */
export function ruleForInterval(n: number, unit: 'days' | 'months' | 'years'): PulseTemplateAlertRule {
  const months = unit === 'years' ? n * 12 : unit === 'months' ? n : null
  const standard = Object.values(STANDARD_RULES).find(r =>
    months !== null ? r.interval_months === months : (r.interval_days === n && !r.interval_months))
  if (standard && (months !== null || n > 0)) return standard
  const days = months !== null ? months * 30 : n
  const thresholds = days <= 31 ? SHORT_CYCLE : days <= 120 ? DUE_SOON : LONG_CYCLE
  const label = unit === 'years' ? (n === 1 ? 'year' : 'years') : unit === 'months' ? (n === 1 ? 'month' : 'months') : (n === 1 ? 'day' : 'days')
  return {
    name: `Every ${n} ${label}`,
    description: `Due ${n} ${label} after the date entered`,
    ...(months !== null ? { interval_months: months } : { interval_days: n }),
    thresholds: JSON.stringify(thresholds),
  }
}

/** Standard rules. "Every …" rules count from the date entered (e.g. the last visit). */
export const STANDARD_RULES: Record<RuleKey, PulseTemplateAlertRule> = {
  due:        { name: 'Due date',       description: 'The date entered is the deadline',             interval_days: 0,   thresholds: JSON.stringify(DUE_SOON) },
  monthly:    { name: 'Every 30 days',  description: 'Due 30 days after the date entered',           interval_days: 30,  thresholds: JSON.stringify(SHORT_CYCLE) },
  every60:    { name: 'Every 60 days',  description: 'Due 60 days after the date entered',           interval_days: 60,  thresholds: JSON.stringify(SHORT_CYCLE) },
  quarterly:  { name: 'Every 90 days',  description: 'Due 90 days after the date entered',           interval_days: 90,  thresholds: JSON.stringify(DUE_SOON) },
  semiannual: { name: 'Every 6 months', description: 'Due 6 months after the date entered',          interval_months: 6,  thresholds: JSON.stringify(LONG_CYCLE) },
  annual:     { name: 'Every year',     description: 'Due on the same date a year later',           interval_months: 12, thresholds: JSON.stringify(LONG_CYCLE) },
}

// ── Built-in role templates ──────────────────────────────────────────────────

/** Variants that shipped in version 1; the rest arrived in version 2 */
const ORIGINAL_VARIANTS = new Set(['opwdd-caseload', 'social-worker-caseload', 'iep-coordinator', 'probation-officer', 'therapist-caseload'])

/**
 * The built-in single-list templates, read from the human-services starter
 * (src/shared/starters/human-services.json) so there is one copy of them.
 * Each variant becomes a setup template named after the variant.
 */
export function builtinSetupTemplates(): Array<{ name: string; description: string; pulse: PulseFile; since: number }> {
  const res = parseStarter(humanServices)
  if (!res.ok) throw new Error(`Built-in human-services starter is invalid: ${res.error}`)
  return (res.starter.variants ?? []).map(v => {
    const list = v.lists[0]!
    const pulse: PulseFile = {
      pulse_template: '1.0',
      type: 'setup',
      name: list.name,
      ...(list.description ? { description: list.description } : {}),
      created: localDateString(),
      columns: list.columns,
      alert_rules: list.alertRules ?? [],
      checklists: list.checklists ?? [],
    }
    return { name: v.name, description: v.description, pulse, since: ORIGINAL_VARIANTS.has(v.key) ? 1 : 2 }
  })
}
