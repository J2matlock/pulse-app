import React from 'react'
import { CheckCircle2 } from 'lucide-react'
import type { FocusFollowUp } from './types'
import { ymdLocalDate } from '../../../shared/dates'

export const FollowUpFocusItem = React.memo(function FollowUpFocusItem({ followUp, celebrating, onComplete, onNavigate }: {
  followUp: FocusFollowUp
  celebrating: boolean
  onComplete: () => void
  onNavigate: () => void
}): React.ReactElement {
  const dueDateStr = ymdLocalDate(followUp.followUpDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  const daysLabel = followUp.daysUntil < 0
    ? `${Math.abs(followUp.daysUntil)} day${Math.abs(followUp.daysUntil) === 1 ? '' : 's'} overdue`
    : followUp.daysUntil === 0
    ? 'Due today'
    : `Due in ${followUp.daysUntil} day${followUp.daysUntil === 1 ? '' : 's'}`
  const daysColor = followUp.daysUntil < 0 ? 'text-red-400' : followUp.daysUntil === 0 ? 'text-orange-400' : 'text-sky-400'

  return (
    <div
      className={`flex items-center gap-4 px-5 py-4 ${celebrating ? 'celebrating' : ''}`}
      style={{ minHeight: 64 }}
    >
      <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${followUp.daysUntil <= 0 ? 'bg-red-500' : 'bg-sky-400'}`} />
      <div className="flex-1 min-w-0">
        <button onClick={onNavigate} title={followUp.clientName} className="hit-44 block max-w-full font-medium text-white truncate hover:underline text-left focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-400 rounded-sm">{followUp.clientName}</button>
        <div className="text-sm text-slate-500 dark:text-slate-400 truncate">
          {followUp.content.length > 80 ? followUp.content.slice(0, 80) + '…' : followUp.content}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className={`text-sm font-medium ${daysColor}`}>{daysLabel}</span>
          <span className="text-slate-600 text-sm">·</span>
          <span className="text-sm text-slate-500">{dueDateStr}</span>
          {followUp.gridName && <><span className="text-slate-600 text-sm">·</span><span className="text-sm text-slate-500">{followUp.gridName}</span></>}
        </div>
      </div>
      <button
        onClick={onComplete}
        disabled={celebrating}
        className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg bg-sky-700 hover:bg-sky-600 text-white text-base font-medium transition-colors focus:outline-hidden focus-visible:ring-3 focus-visible:ring-sky-400 disabled:opacity-50"
        style={{ minHeight: 44 }}
      >
        <CheckCircle2 className="w-4 h-4" />
        Done ✓
      </button>
    </div>
  )
})
