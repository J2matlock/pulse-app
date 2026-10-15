import React from 'react'
import { useNavigate } from 'react-router-dom'
import { computeEffectiveDeadline, formatDeadlineTooltip } from '../../utils/deadlineCalc'
import { classifyDeadline, daysAwayLabel, daysOverdueLabel } from '../../../shared/deadlineTiles'
import { TIER_TEXT } from '../../utils/dueTiers'
import { resolveAlertColor } from '../../utils/alertColors'
import type { ExtendedDeadlineInfo } from './types'
import { ymdToDate, isUsedUp } from '../../../shared/deadlineEngine'
import { shortDate } from '../../../shared/dates'
import { deadlineTraits } from './useDeadlineActions'
import { DeadlineCardContent } from '../../components/deadlines/DeadlineCardContent'

export function DeadlineRow({ deadline, onMarkDone, onUndoneMarkDone, selected, onToggleSelect }: {
  deadline: ExtendedDeadlineInfo
  onMarkDone?: (rowId: number, columnId: number) => void
  onUndoneMarkDone?: () => Promise<void>
  /** Bulk selection (dashboard): checkbox shown when onToggleSelect is given */
  selected?: boolean
  onToggleSelect?: () => void
}): React.ReactElement {
  const navigate = useNavigate()
  const { daysUntil, threshold, clientName, columnName, gridName, dateValue, rowId, gridId } = deadline
  // What's due ("Appeal window"); Done fills in the column ("Appeal filed") (R6)
  const title = deadline.title ?? columnName
  const { ruleKind, ruleInterval, recurring } = deadlineTraits(deadline)
  const usedUp = isUsedUp({ state: deadline.state, daysUntil })
  const bucket = usedUp ? 'overdue' : classifyDeadline(daysUntil)

  // A used-up quota is late whatever its end date: its label, or "N days overdue"
  const urgencyLabel =
    usedUp ? deadline.label || daysOverdueLabel(daysUntil) :
    daysAwayLabel(daysUntil)

  // Deadlines further out than a month keep the this-month text color
  const urgencyColor = TIER_TEXT[bucket === 'future' ? 'this-month' : bucket]

  const { className: alertBgClass, style: alertBgStyle } = threshold
    ? resolveAlertColor(threshold.bgClass)
    : { className: '', style: {} }

  const storedDateFormatted = (() => {
    try {
      const d = new Date(dateValue.includes('T') ? dateValue : `${dateValue}T00:00:00`)
      return shortDate(d)
    } catch { return dateValue }
  })()

  const deadlineFormatted = (() => {
    if (deadline.due) return shortDate(ymdToDate(deadline.due))
    if (!recurring) return storedDateFormatted
    try {
      // Calendar-day math (setDate) — adding raw milliseconds drifts across DST changes
      const eff = computeEffectiveDeadline(dateValue, ruleInterval)
      if (!eff) return storedDateFormatted
      return shortDate(eff)
    } catch { return storedDateFormatted }
  })()

  // The engine's own words, for every kind: they include a working-day move and an extension
  const engineWords = deadline.detail || formatDeadlineTooltip(dateValue, ruleInterval, daysUntil)
  const tooltip = title !== columnName ? `${engineWords}\nWhen it's done, the date goes in ${columnName}.` : engineWords

  return (
    <div
      role="listitem"
      title={tooltip}
      className={`flex items-center gap-4 px-4 border-b border-slate-100 dark:border-slate-700/50 last:border-0
                  hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors ${alertBgClass}`}
      style={{ minHeight: 52, ...alertBgStyle }}
    >
      {onToggleSelect && (
        <input
          type="checkbox"
          checked={!!selected}
          onChange={onToggleSelect}
          aria-label={`Select ${title} for ${clientName}`}
          className="hit-44 w-5 h-5 flex-shrink-0 rounded border-slate-400 dark:border-slate-500 text-blue-600 focus:ring-3 focus:ring-blue-500 cursor-pointer"
        />
      )}
      <div className={`w-1 self-stretch rounded-full ${
        bucket === 'overdue' || bucket === 'today' ? 'bg-red-500' :
        bucket === 'this-week' ? 'bg-orange-400' :
        bucket === 'this-month' ? 'bg-yellow-400' : 'bg-slate-200 dark:bg-slate-600'
      }`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <button
            onClick={() => navigate(`/profile/${rowId}?gridId=${gridId}`)}
            className="hit-44 font-medium text-slate-800 dark:text-slate-100 truncate hover:underline text-left focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 rounded-sm"
          >{clientName}</button>
          <span className="text-slate-600 dark:text-slate-300 text-sm flex-shrink-0">·</span>
          <span className="text-slate-600 dark:text-slate-300 text-sm truncate">{title}</span>
        </div>
        {/* slate-600: rows can carry a tinted alert background, where slate-500 drops below 4.5:1 */}
        <div className="text-sm text-slate-600 dark:text-slate-300 truncate">
          {gridName}
          {/* Her words, not the engine's "based on" (UX D-04) */}
          {recurring ? <span className="ml-2">· last done {storedDateFormatted}</span> : null}
          {/* Which step, how many are used, how much use is left (D-08) */}
          {ruleKind !== 'interval' && deadline.label && !usedUp ? <span className="ml-2">· {deadline.label}</span> : null}
        </div>
      </div>
      <div className="flex-shrink-0 text-right">
        <div className="text-sm text-slate-600 dark:text-slate-300 tabular-nums">{deadlineFormatted}</div>
        <div className={`text-sm ${urgencyColor} tabular-nums`}>{urgencyLabel}</div>
      </div>
      {/* Done · Done on… · Extend…, the same card as the grid, the profile and the Calendar (Q3); the name is the Open link */}
      {onMarkDone && <DeadlineCardContent info={deadline} where="dashboard" layout="row" onDone={onMarkDone} onChanged={onUndoneMarkDone} />}
    </div>
  )
}
