/**
 * A deadline rule in a few plain words: "Every 6 months", "45 days after
 * Referral date", "Every Mar 31". Used for automatic rule names, header
 * tooltips and the Settings list.
 */
import { engineRuleFrom, ordinal, type RelativeConfig, type CalendarConfig, type MeterConfig, type QuotaConfig, type SequenceConfig } from './deadlineEngine'
import { describeInterval } from './ruleInterval'
import { unhandledCase } from './assertNever'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']


function amount(o: { days?: number; months?: number; businessDays?: number }): string {
  const parts = [
    o.months ? (o.months % 12 === 0 ? `${o.months / 12} year${o.months === 12 ? '' : 's'}` : `${o.months} month${o.months === 1 ? '' : 's'}`) : '',
    o.days ? `${o.days} day${o.days === 1 ? '' : 's'}` : '',
    o.businessDays ? `${o.businessDays} working day${o.businessDays === 1 ? '' : 's'}` : '',
  ].filter(Boolean)
  return parts.join(' and ') || '0 days'
}

export function ruleSummary(rule: Parameters<typeof engineRuleFrom>[0], columnName: (id: number) => string | undefined = () => undefined): string {
  const r = engineRuleFrom(rule)
  const col = (id: number | 'self') => id === 'self' ? 'this date' : columnName(id) ?? 'another date'
  switch (r.kind) {
    case 'relative': {
      const c = r.config as RelativeConfig
      return `${amount(c.offset)} ${c.offset.direction} ${col(c.anchorColumnId)}`
    }
    case 'calendar': {
      const c = r.config as CalendarConfig
      if (c.fromColumnMonth) return `Every year on the ${col(c.fromColumnMonth)} date`
      const months = [...new Set(c.months ?? [])].sort((a, b) => a - b)
      const day = c.day === 'last' ? 'last day' : ordinal(c.day ?? 1)
      if (months.length === 12) return `Monthly on the ${day}`
      if (months.length === 1) return c.day === 'last' ? `Every ${MONTHS[months[0]! - 1]} (last day)` : `Every ${MONTHS[months[0]! - 1]} ${c.day ?? 1}`
      return `${months.map(m => MONTHS[m - 1]).join(', ')} on the ${day}`
    }
    case 'meter': {
      const c = r.config as MeterConfig
      const every = `Every ${c.every.toLocaleString('en-US')} ${c.unit}`
      return c.timeFallback ? `${every} or ${amount(c.timeFallback)}` : every
    }
    case 'quota': {
      const c = r.config as QuotaConfig
      return c.limit !== undefined ? `${c.limit} allowed until ${col(c.endColumnId)}` : `A limited number until ${col(c.endColumnId)}`
    }
    case 'sequence': {
      const c = r.config as SequenceConfig
      const names = c.steps.map(s => s.label)
      return names.length <= 3 ? names.join(', then ') : `${names.length} steps: ${names[0]}, ${names[1]}…`
    }
    case 'interval':
      return describeInterval(r.interval)
    default:
      // engineRuleFrom() only returns known kinds; a new kind without a case fails typecheck
      unhandledCase(r.kind)
      return describeInterval(r.interval)
  }
}
