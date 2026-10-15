import React, { useState } from 'react'
import { CalendarClock } from 'lucide-react'
import { Tooltip } from '../../components/shared/Tooltip'
import { useNavigate } from 'react-router-dom'
import type { FollowUpRow } from './types'
import { completeFollowUp } from './completeFollowUp'
import { classifyDeadline, daysAwayLabel } from '../../../shared/deadlineTiles'
import { TIER_TEXT, TIER_BAR } from '../../utils/dueTiers'
import { shortDate } from '../../../shared/dates'

export function FollowUpDashRow({ followUp, daysUntil, onComplete, onReloadFollowUps }: {
  followUp: FollowUpRow
  daysUntil: number
  onComplete: (id: number) => void
  onReloadFollowUps?: () => Promise<void>
}): React.ReactElement {
  const navigate = useNavigate()
  const [completing, setCompleting] = useState(false)

  // Follow-ups further out than a month keep the this-month color
  const tier = classifyDeadline(daysUntil)
  const near = tier === 'future' ? 'this-month' : tier
  const urgencyLabel = daysAwayLabel(daysUntil)
  const urgencyColor = TIER_TEXT[near]
  const barColor = TIER_BAR[near]

  const dateFormatted = shortDate(new Date(followUp.follow_up_date + 'T00:00:00'))

  async function handleComplete() {
    setCompleting(true)
    try {
      // The row goes even when main refused, as before; a reload brings it back
      await completeFollowUp(followUp, onReloadFollowUps)
      onComplete(followUp.id)
    } catch { /* ignore */ } finally {
      setCompleting(false)
    }
  }

  return (
    <div
      role="listitem"
      className="flex items-center gap-4 px-4 border-b border-slate-100 dark:border-slate-700/50 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors"
      style={{ minHeight: 52 }}
    >
      <div className={`w-1 self-stretch rounded-full ${barColor}`} />
      <Tooltip content="Mark follow-up complete">
        <button
          onClick={handleComplete}
          disabled={completing}
          aria-label="Mark follow-up complete"
          className="hit-44 w-5 h-5 rounded-full border-2 border-slate-400 dark:border-slate-500 flex items-center justify-center flex-shrink-0 hover:border-accent hover:bg-accent-soft focus-visible:border-accent transition-colors focus:outline-hidden focus-visible:ring-3 focus-visible:ring-accent"
        >
          {completing && <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />}
        </button>
      </Tooltip>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate(`/profile/${followUp.row_id}?gridId=${followUp.grid_id}`)}
            className="hit-44 font-medium text-slate-800 dark:text-slate-100 truncate hover:underline text-left focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 rounded-sm"
          >{followUp.client_name}</button>
          <span className="inline-flex items-center gap-1 text-sm bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 px-2 rounded-full flex-shrink-0"><CalendarClock className="w-3.5 h-3.5" aria-hidden="true" />follow-up</span>
        </div>
        <div className="text-sm text-slate-500 dark:text-slate-400 truncate">
          {followUp.grid_name} · {followUp.content.slice(0, 80)}{followUp.content.length > 80 ? '…' : ''}
        </div>
      </div>
      <div className="flex-shrink-0 text-right">
        <div className="text-sm text-slate-500 dark:text-slate-400 tabular-nums">{dateFormatted}</div>
        <div className={`text-sm ${urgencyColor} tabular-nums`}>{urgencyLabel}</div>
      </div>
    </div>
  )
}
