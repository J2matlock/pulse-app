import React from 'react'
import { Check } from 'lucide-react'
import { PrimaryButton, SecondaryButton } from '../../components/ui/Button'
import { Tooltip } from '../../components/shared/Tooltip'
import type { FocusItem } from './types'
import { useVocab } from '../../hooks/useVocab'
import { isOneOffDeadline } from '../dashboard/completeDeadline'

/**
 * One deadline in Focus mode, with the same choices as the dashboard row:
 * Done, Done on…, Extend…, and Not now to put it aside (UX D-07).
 */
export const ClientFocusItem = React.memo(function ClientFocusItem({ item, celebrating, onComplete, onDoneOnDay, onExtend, onNotNow, onNavigate }: {
  item: FocusItem
  celebrating: boolean
  onComplete: () => void
  onDoneOnDay?: () => void
  onExtend?: () => void
  onNotNow?: () => void
  onNavigate: () => void
}): React.ReactElement {
  const { t } = useVocab(item.gridId)
  const urgencyDot = item.urgency === 'overdue'
    ? 'bg-red-500'
    : item.urgency === 'today'
    ? 'bg-orange-400'
    : 'bg-yellow-400'

  const daysLabel = item.usedUpLabel ? item.usedUpLabel
    : item.daysUntil < 0
    ? `${Math.abs(item.daysUntil)} day${Math.abs(item.daysUntil) === 1 ? '' : 's'} overdue`
    : item.daysUntil === 0
    ? 'Due today'
    : `${item.daysUntil} day${item.daysUntil === 1 ? '' : 's'} away`

  const daysColor = item.urgency === 'overdue'
    ? 'text-red-700 dark:text-red-400'
    : item.urgency === 'today'
    ? 'text-orange-700 dark:text-orange-400'
    : 'text-yellow-700 dark:text-yellow-400'

  // Quotas are renewed on the record; meters ask the day in their own dialog; one-offs ask Renewed or Finished
  const canPickDay = item.ruleKind !== 'quota' && item.ruleKind !== 'meter' && !isOneOffDeadline(item)
  const doneTip = item.ruleKind === 'quota' ? `Open the ${t('record')} to set new dates and how many are allowed`
    : item.ruleKind === 'meter' ? 'Mark done: asks for the current reading' : null
  const done = (
    <PrimaryButton
      size="compact"
      icon={<Check className="w-4 h-4" />}
      onClick={onComplete}
      disabled={celebrating}
      aria-label={item.ruleKind === 'quota' ? `Renew ${item.columnName} for ${item.clientName}` : `Mark ${item.columnName} done for ${item.clientName}`}
      className="flex-shrink-0"
    >
      {item.ruleKind === 'quota' ? 'Renew…' : 'Done'}
    </PrimaryButton>
  )

  return (
    <div
      className={`flex items-center gap-3 px-5 py-4 flex-wrap ${celebrating ? 'celebrating' : ''}`}
      style={{ minHeight: 64 }}
    >
      <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${urgencyDot}`} aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <button onClick={onNavigate} title={item.clientName} className="hit-44 block max-w-full font-medium text-slate-900 dark:text-white truncate hover:underline text-left focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-400 rounded-sm">{item.clientName}</button>
        <div className="text-sm text-slate-600 dark:text-slate-400 truncate">
          {item.label}
          {item.subLabel && <span className="ml-2">· {item.subLabel}</span>}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className={`text-sm font-medium ${daysColor}`}>{daysLabel}</span>
          <span className="text-slate-500 text-sm">·</span>
          <span className="text-sm text-slate-600 dark:text-slate-400">{item.dueDateStr}</span>
        </div>
      </div>
      {onNotNow && (
        <Tooltip content="Put it aside until you open Focus mode again">
          <SecondaryButton size="compact" onClick={onNotNow} disabled={celebrating} className="flex-shrink-0"
            aria-label={`Not now: ${item.columnName} for ${item.clientName}`}>
            Not now
          </SecondaryButton>
        </Tooltip>
      )}
      {onExtend && item.ruleKind !== 'quota' && (
        <Tooltip content="Give it a new due date, with a reason">
          <SecondaryButton size="compact" onClick={onExtend} disabled={celebrating} className="flex-shrink-0"
            aria-label={`Extend ${item.columnName} for ${item.clientName}`}>
            Extend…
          </SecondaryButton>
        </Tooltip>
      )}
      {onDoneOnDay && canPickDay && (
        // A link, not a second green button: green is for "on track" (Q8)
        <Tooltip content="It happened on an earlier day: choose which">
          <button type="button" onClick={onDoneOnDay} disabled={celebrating}
            className="flex-shrink-0 inline-flex min-h-11 items-center px-2 rounded-lg text-base font-medium text-accent underline-offset-2 hover:underline focus:outline-hidden focus-visible:ring-3 focus-visible:ring-accent disabled:opacity-50"
            aria-label={`Done on another day: ${item.columnName} for ${item.clientName}`}>
            Done on…
          </button>
        </Tooltip>
      )}
      {doneTip ? <Tooltip content={doneTip}>{done}</Tooltip> : done}
    </div>
  )
})
