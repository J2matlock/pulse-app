import React from 'react'
import { CheckCircle2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { computeEffectiveDeadline, formatDeadlineTooltip } from '../../utils/deadlineCalc'
import { classifyDeadline, daysAwayLabel, daysOverdueLabel } from '../../../shared/deadlineTiles'
import { TIER_TEXT } from '../../utils/dueTiers'
import { resolveAlertColor } from '../../utils/alertColors'
import type { ExtendedDeadlineInfo } from './types'
import { ymdToDate, isUsedUp } from '../../../shared/deadlineEngine'
import { useVocab } from '../../hooks/useVocab'
import { shortDate } from '../../../shared/dates'
import { useDeadlineActions } from './useDeadlineActions'

export function DeadlineRow({ deadline, onMarkDone, onUndoneMarkDone, selected, onToggleSelect }: {
  deadline: ExtendedDeadlineInfo
  onMarkDone?: (rowId: number, columnId: number) => void
  onUndoneMarkDone?: () => Promise<void>
  /** Bulk selection (dashboard): checkbox shown when onToggleSelect is given */
  selected?: boolean
  onToggleSelect?: () => void
}): React.ReactElement {
  const navigate = useNavigate()
  const { t } = useVocab(deadline.gridId)
  const { daysUntil, threshold, clientName, columnName, gridName, dateValue, rowId, gridId } = deadline
  // Done, Done on…, Extend… and their dialogs, shared with the Calendar's panel (UX D-08)
  const act = useDeadlineActions(deadline, { onMarkDone, onChanged: onUndoneMarkDone })
  const { ruleKind, ruleInterval, oneOff, recurring, stepName } = act
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
  const tooltip = deadline.detail || formatDeadlineTooltip(dateValue, ruleInterval, daysUntil)

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
          aria-label={`Select ${columnName} for ${clientName}`}
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
          <span className="text-slate-600 dark:text-slate-300 text-sm truncate">{columnName}</span>
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
      {onMarkDone && (deadline.extensionId ? (
        <button
          onClick={() => void act.removeExtension()}
          title={deadline.detail}
          className="flex-shrink-0 px-2.5 py-1.5 rounded-lg text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
          style={{ minHeight: 44 }}
        >
          Remove extension
        </button>
      ) : (
        <button
          onClick={act.startExtend}
          title="Give it a new due date, with a reason"
          className="flex-shrink-0 px-2.5 py-1.5 rounded-lg text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
          style={{ minHeight: 44 }}
        >
          Extend…
        </button>
      ))}
      {onMarkDone && ruleKind === 'quota' && (
        <button
          onClick={() => navigate(`/profile/${rowId}?gridId=${gridId}`)}
          title={`Open the ${t('record')} to set new dates and how many are allowed`}
          className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-sm font-medium focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
          style={{ minHeight: 44 }}
        >
          Renew…
        </button>
      )}
      {onMarkDone && ruleKind !== 'quota' && (
        <button
          onClick={act.startDone}
          disabled={act.marking}
          title={act.doneTitle}
          aria-label={`Mark ${stepName ?? columnName} done for ${clientName}`}
          className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-green-100 hover:bg-green-200 dark:bg-green-900/30 dark:hover:bg-green-900/50 text-green-700 dark:text-green-300 text-sm font-medium transition-colors focus:outline-hidden focus-visible:ring-3 focus-visible:ring-green-500 disabled:opacity-50"
          style={{ minHeight: 44 }}
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          {stepName ? `Mark ${stepName} done` : 'Done'}
        </button>
      )}
      {/* The work happened on an earlier day (meter readings ask for the day in their dialog); words, not a chevron (UX D-04) */}
      {onMarkDone && act.canPickDay && !oneOff && (
        <button
          onClick={act.startDoneOnDay}
          disabled={act.marking}
          title="It happened on an earlier day: choose which"
          aria-label={`Done on another day: ${columnName} for ${clientName}`}
          className="flex-shrink-0 -ml-2 px-2.5 py-1.5 rounded-lg text-sm font-medium text-green-700 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-900/30 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-green-500 disabled:opacity-50"
          style={{ minHeight: 44 }}
        >
          Done on…
        </button>
      )}
      {act.dialogs}
    </div>
  )
}
