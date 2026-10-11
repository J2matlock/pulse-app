import React, { useState } from 'react'
import type { CaseloadTask } from '../../../shared/types'
import { useTaskStore } from '../../stores/taskStore'

export function TaskRow({
  task,
  daysUntil,
  onComplete,
  onRestore,
}: {
  task: CaseloadTask
  daysUntil: number
  onComplete: (id: number) => void
  onRestore?: (task: CaseloadTask) => void
}): React.ReactElement {
  const [completing, setCompleting] = useState(false)

  const urgencyLabel =
    daysUntil < 0   ? `${Math.abs(daysUntil)} day${Math.abs(daysUntil) === 1 ? '' : 's'} overdue` :
    daysUntil === 0 ? 'Due today' :
    `${daysUntil} day${daysUntil === 1 ? '' : 's'}`

  const urgencyColor =
    daysUntil < 0    ? 'text-red-600 dark:text-red-400 font-semibold' :
    daysUntil === 0  ? 'text-red-600 dark:text-red-400 font-semibold' :
    daysUntil <= 7   ? 'text-orange-600 dark:text-orange-400' :
    daysUntil <= 30  ? 'text-yellow-600 dark:text-yellow-400' :
    'text-slate-500 dark:text-slate-400'

  const barColor =
    daysUntil < 0    ? 'bg-red-500' :
    daysUntil === 0  ? 'bg-red-400' :
    daysUntil <= 7   ? 'bg-orange-400' :
    daysUntil <= 30  ? 'bg-yellow-400' : 'bg-purple-300'

  const dueDateFormatted = task.due_date
    ? (() => { const [y = NaN, m = NaN, d = NaN] = task.due_date!.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) })()
    : '—'

  const priorityDot =
    task.priority === 'high'   ? '🔴' :
    task.priority === 'normal' ? '🟡' : '⚪'

  async function handleComplete() {
    setCompleting(true)
    try {
      // completeTask pushes the one undo step (with its toast); undo reopens the
      // task through TASK_UNCOMPLETE, due date and all
      const done = await useTaskStore.getState().completeTask(task.id, {
        task, toast: true,
        onUndo: () => onRestore?.(task),
        onRedo: () => onComplete(task.id),
      })
      if (done) onComplete(task.id)
    } finally {
      setCompleting(false)
    }
  }

  return (
    <div
      role="listitem"
      className="flex items-center gap-4 px-4 border-b border-slate-100 dark:border-slate-700/50 last:border-0 hover:bg-purple-50/30 dark:hover:bg-purple-900/10 transition-colors"
      style={{ minHeight: 52 }}
    >
      <div className={`w-1 self-stretch rounded-full ${barColor}`} />
      <button
        onClick={handleComplete}
        disabled={completing}
        title="Mark complete"
        aria-label="Mark complete"
        className="hit-44 w-5 h-5 rounded-full border-2 border-purple-400 dark:border-purple-500 flex items-center justify-center flex-shrink-0 hover:bg-purple-100 dark:hover:bg-purple-900/40 transition-colors focus:outline-hidden focus-visible:ring-3 focus-visible:ring-purple-500"
      >
        {completing && <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm">{priorityDot}</span>
          <span className="font-medium text-slate-800 dark:text-slate-100 truncate">{task.title}</span>
          <span className="text-sm bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 px-1.5 py-0.5 rounded-sm flex-shrink-0">task</span>
        </div>
        {task.category && (
          <div className="text-sm text-slate-500 dark:text-slate-400 truncate">{task.category}</div>
        )}
      </div>
      <div className="flex-shrink-0 text-right">
        <div className="text-sm text-slate-500 dark:text-slate-400 tabular-nums">{dueDateFormatted}</div>
        <div className={`text-sm ${urgencyColor} tabular-nums`}>{urgencyLabel}</div>
      </div>
    </div>
  )
}
