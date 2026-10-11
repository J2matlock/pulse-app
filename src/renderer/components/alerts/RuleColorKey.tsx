import React from 'react'
import type { AlertThreshold, ParsedAlertRule } from '../../../shared/types'
import { resolveAlertColor } from '../../utils/alertColors'

/** "From 14 days before", "On the day", "Once it's late" */
export function bandWhen(daysBefore: number): string {
  if (daysBefore > 0) return `From ${daysBefore} day${daysBefore === 1 ? '' : 's'} before`
  if (daysBefore === 0) return 'On the day'
  return daysBefore === -1 ? 'Once it\'s late' : `${-daysBefore} days late`
}

/** One rule's colors, from far away to late, with their own labels (G-09, D-29). */
export function RuleColorKey({ rule, compact = false }: { rule: Pick<ParsedAlertRule, 'name' | 'thresholds'>; compact?: boolean }): React.ReactElement {
  const bands = [...rule.thresholds].sort((a, b) => b.daysBefore - a.daysBefore)
  return (
    <div>
      {!compact && <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{rule.name}</p>}
      <ul className="flex flex-wrap gap-x-3 gap-y-1" aria-label={`Colors for ${rule.name}`}>
        {bands.map((t: AlertThreshold, i) => {
          const { className, style } = resolveAlertColor(t.bgClass)
          return (
            <li key={i} className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300">
              <span className={`inline-block w-4 h-4 rounded-sm border border-slate-300 dark:border-slate-600 ${className}`} style={style} aria-hidden="true" />
              <span>{t.label || 'Color'} <span className="text-slate-500 dark:text-slate-400">({bandWhen(t.daysBefore).toLowerCase()})</span></span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
