import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ChecklistDueItem } from '../../../shared/types'
import { tickChecklistItem } from '../../utils/checklistTick'
import { classifyDeadline, daysAwayLabel } from '../../../shared/deadlineTiles'
import { TIER_TEXT, TIER_BAR } from '../../utils/dueTiers'

export function ChecklistDueRow({
  item,
  daysUntil,
  onComplete,
  onRestore,
}: {
  item: ChecklistDueItem
  daysUntil: number
  onComplete: (id: number) => void
  onRestore?: (item: ChecklistDueItem) => void
}): React.ReactElement {
  const [completing, setCompleting] = useState(false)
  const navigate = useNavigate()

  const tier = classifyDeadline(daysUntil)
  const urgencyLabel = daysAwayLabel(daysUntil)
  const urgencyColor = TIER_TEXT[tier]
  const barColor = tier === 'future' ? 'bg-teal-300' : TIER_BAR[tier]

  const dueDateFormatted = (() => {
    const [y = NaN, m = NaN, d = NaN] = item.due_date!.split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  })()

  const priorityDot =
    item.priority === 'high' || item.priority === 'urgent' ? '🔴' :
    item.priority === 'normal' ? '🟡' : '⚪'

  async function handleComplete() {
    setCompleting(true)
    try {
      // A repeating item stays open with its next due date, so it's shown at that
      // date instead of dropping off until the next visit (bug sweep S2)
      const repeat = { nextDue: null as string | null }
      const showAt = (due: string) => { onComplete(item.id); onRestore?.({ ...item, due_date: due }) }
      const done = await tickChecklistItem(item, {
        onUndo: () => { if (repeat.nextDue && item.due_date) showAt(item.due_date); else onRestore?.(item) },
        onRedo: () => { if (repeat.nextDue) showAt(repeat.nextDue); else onComplete(item.id) },
        onRepeat: next => { repeat.nextDue = next },
      })
      if (done) {
        if (repeat.nextDue) showAt(repeat.nextDue)
        else onComplete(item.id)
      }
    } catch { /* ignore */ } finally {
      setCompleting(false)
    }
  }

  return (
    <div
      role="listitem"
      className="flex items-center gap-4 px-4 border-b border-slate-100 dark:border-slate-700/50 last:border-0 hover:bg-teal-50/30 dark:hover:bg-teal-900/10 transition-colors"
      style={{ minHeight: 52 }}
    >
      <div className={`w-1 self-stretch rounded-full ${barColor}`} />
      <button
        onClick={handleComplete}
        disabled={completing}
        title="Mark complete"
        aria-label="Mark complete"
        className="hit-44 w-5 h-5 rounded-full border-2 border-teal-400 dark:border-teal-500 flex items-center justify-center flex-shrink-0 hover:bg-teal-100 dark:hover:bg-teal-900/40 transition-colors focus:outline-hidden focus-visible:ring-3 focus-visible:ring-teal-500"
      >
        {completing && <span className="w-2 h-2 rounded-full bg-teal-400 animate-pulse" />}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm">{priorityDot}</span>
          <span className="font-medium text-slate-800 dark:text-slate-100 truncate">{item.title}</span>
          <span className="text-sm bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 px-1.5 py-0.5 rounded-sm flex-shrink-0">checklist</span>
        </div>
        <div className="text-sm text-slate-500 dark:text-slate-400 truncate">
          <button
            onClick={() => navigate(`/profile/${item.row_id}?gridId=${item.grid_id}`)}
            className="hit-44 hover:text-blue-500 dark:hover:text-blue-400 hover:underline transition-colors"
          >
            {item.client_name ?? 'Unknown'}
          </button>
          {' '}&middot; {item.grid_name}
        </div>
      </div>
      <div className="flex-shrink-0 text-right">
        <div className="text-sm text-slate-500 dark:text-slate-400 tabular-nums">{dueDateFormatted}</div>
        <div className={`text-sm ${urgencyColor} tabular-nums`}>{urgencyLabel}</div>
      </div>
    </div>
  )
}
