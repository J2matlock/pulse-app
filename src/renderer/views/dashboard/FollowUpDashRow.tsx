import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke, mustInvoke } from '../../utils/safeInvoke'
import { useUndoStore } from '../../stores/undoStore'
import type { FollowUpRow } from './types'
import { wordNow } from '../../utils/vocab'
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
      const res = await safeInvoke(IPC.CASE_LOG_COMPLETE_FOLLOWUP, followUp.id)
      onComplete(followUp.id)
      if (res.ok) {
        const { sysLogId } = res.data
        const sideEffects = sysLogId ? [{ type: 'void_case_log' as const, caseLogId: sysLogId }] : undefined
        useUndoStore.getState().push({
          id: crypto.randomUUID(),
          description: `Completed follow-up for ${followUp.client_name ?? wordNow('record', {}, followUp.grid_id)}`,
          timestamp: Date.now(),
          category: 'logged',
          icon: 'check',
          sideEffects,
          undo: async () => {
            await mustInvoke(IPC.CASE_LOG_UNCOMPLETE_FOLLOWUP, followUp.id)
            await onReloadFollowUps?.()
          },
          redo: async () => {
            await mustInvoke(IPC.CASE_LOG_COMPLETE_FOLLOWUP, followUp.id)
            await onReloadFollowUps?.()
          },
        })
      }
    } catch { /* ignore */ } finally {
      setCompleting(false)
    }
  }

  return (
    <div
      role="listitem"
      className="flex items-center gap-4 px-4 border-b border-slate-100 dark:border-slate-700/50 last:border-0 hover:bg-amber-50/30 dark:hover:bg-amber-900/10 transition-colors"
      style={{ minHeight: 52 }}
    >
      <div className={`w-1 self-stretch rounded-full ${barColor}`} />
      <button
        onClick={handleComplete}
        disabled={completing}
        title="Mark follow-up complete"
        aria-label="Mark follow-up complete"
        className="hit-44 w-5 h-5 rounded-full border-2 border-amber-400 dark:border-amber-500 flex items-center justify-center flex-shrink-0 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors focus:outline-hidden focus-visible:ring-3 focus-visible:ring-amber-500"
      >
        {completing && <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => navigate(`/profile/${followUp.row_id}?gridId=${followUp.grid_id}`)}
            className="hit-44 font-medium text-slate-800 dark:text-slate-100 truncate hover:underline text-left focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 rounded-sm"
          >{followUp.client_name}</button>
          <span className="text-sm bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded-sm flex-shrink-0">follow-up</span>
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
