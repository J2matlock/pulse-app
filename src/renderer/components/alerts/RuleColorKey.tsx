import React from 'react'
import type { AlertThreshold, ParsedAlertRule } from '../../../shared/types'
import { resolveAlertColor } from '../../utils/alertColors'
import { alertShapeForBand } from '../grid/gridConstants'

/** "From 14 days before", "On the day", "Once it's late" */
export function bandWhen(daysBefore: number): string {
  if (daysBefore > 0) return `From ${daysBefore} day${daysBefore === 1 ? '' : 's'} before`
  if (daysBefore === 0) return 'On the day'
  return daysBefore === -1 ? 'Once it\'s late' : `${-daysBefore} days late`
}

/** A day count that falls in this band, so the band's own shape can be drawn (B-04) */
function sampleDaysFor(band: AlertThreshold): number {
  if (band.daysBefore > 0) return band.daysBefore
  return band.daysBefore === 0 ? 0 : -1
}

/**
 * One rule's colors, from far away to late, with their own labels (G-09, D-29).
 * With `shapes`, each color also shows the shape its cells carry in the list (B-04).
 */
export function RuleColorKey({ rule, compact = false, shapes = false }: { rule: Pick<ParsedAlertRule, 'name' | 'thresholds'>; compact?: boolean; shapes?: boolean }): React.ReactElement {
  const bands = [...rule.thresholds].sort((a, b) => b.daysBefore - a.daysBefore)
  return (
    <div>
      {!compact && <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{rule.name}</p>}
      <ul className={`flex ${shapes ? 'flex-col gap-y-1.5' : 'flex-wrap gap-x-3 gap-y-1'}`} aria-label={`Colors for ${rule.name}`}>
        {bands.map((t: AlertThreshold, i) => {
          const { className, style } = resolveAlertColor(t.bgClass)
          return (
            <li key={i} className={`flex items-center gap-1.5 ${shapes ? 'text-base' : 'text-sm'} text-slate-600 dark:text-slate-300`}>
              <span className={`inline-block w-4 h-4 rounded-sm border border-slate-300 dark:border-slate-600 ${className}`} style={style} aria-hidden="true" />
              {shapes && (
                <span className="inline-flex w-5 justify-center text-slate-700 dark:text-slate-200" aria-hidden="true">
                  {alertShapeForBand(sampleDaysFor(t), t, rule.thresholds)}
                </span>
              )}
              <span>{t.label || 'Color'} <span className="text-slate-500 dark:text-slate-400">({bandWhen(t.daysBefore).toLowerCase()})</span></span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
