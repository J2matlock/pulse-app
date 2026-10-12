import React from 'react'
import { CheckCircle2 } from 'lucide-react'
import type { FocusTask } from './types'
import { classifyDeadline, daysAwayLabel, type DueTier } from '../../../shared/deadlineTiles'
import { shortYmd } from '../../../shared/dates'

// Focus Mode is always dark
const FOCUS_TIER_TEXT: Record<DueTier, string> = {
  overdue: 'text-red-400',
  today: 'text-red-400',
  'this-week': 'text-orange-400',
  'this-month': 'text-yellow-400',
  future: 'text-slate-500',
}

export const TaskFocusItem = React.memo(function TaskFocusItem({ task, celebrating, onComplete }: {
  task: FocusTask
  celebrating: boolean
  onComplete: () => void
}): React.ReactElement {
  const priorityDot =
    task.priority === 'urgent' ? 'bg-red-500' :
    task.priority === 'high'   ? 'bg-orange-400' :
    task.priority === 'normal' ? 'bg-blue-400' : 'bg-slate-500'

  const dueDateFormatted = task.due_date
    ? shortYmd(task.due_date!)
    : null

  // 9999 stands for "no due date"
  const urgencyLabel = task.daysUntil === 9999 ? null : daysAwayLabel(task.daysUntil)
  const urgencyColor = FOCUS_TIER_TEXT[classifyDeadline(task.daysUntil)]

  return (
    <div
      className={`flex items-center gap-4 px-5 py-4 ${celebrating ? 'celebrating' : ''}`}
      style={{ minHeight: 64 }}
    >
      <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${priorityDot}`} title={task.priority} />
      <div className="flex-1 min-w-0">
        <div className="font-medium text-white truncate">{task.title}</div>
        {task.category && (
          <div className="text-sm text-slate-500 dark:text-slate-400 truncate">{task.category}</div>
        )}
      </div>
      {dueDateFormatted && (
        <div className="flex-shrink-0 text-right mr-2">
          <div className="text-sm text-slate-500 dark:text-slate-400 tabular-nums">{dueDateFormatted}</div>
          {urgencyLabel && <div className={`text-sm ${urgencyColor} tabular-nums`}>{urgencyLabel}</div>}
        </div>
      )}
      <button
        onClick={onComplete}
        disabled={celebrating}
        className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg bg-purple-700 hover:bg-purple-600 text-white text-base font-medium transition-colors focus:outline-hidden focus-visible:ring-3 focus-visible:ring-purple-400 disabled:opacity-50"
        style={{ minHeight: 44 }}
      >
        <CheckCircle2 className="w-4 h-4" />
        Complete
      </button>
    </div>
  )
})
