import React, { useState } from 'react'
import { ClipboardList } from 'lucide-react'
import type { CaseloadTask } from '../../../shared/types'
import { useTaskStore } from '../../stores/taskStore'
import { classifyDeadline, daysAwayLabel } from '../../../shared/deadlineTiles'
import { TIER_TEXT, TIER_BAR } from '../../utils/dueTiers'
import { Tooltip } from '../../components/shared/Tooltip'
import { shortYmd } from '../../../shared/dates'

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

  const tier = classifyDeadline(daysUntil)
  const urgencyLabel = daysAwayLabel(daysUntil)
  const urgencyColor = TIER_TEXT[tier]
  const barColor = tier === 'future' ? 'bg-slate-200 dark:bg-slate-600' : TIER_BAR[tier]

  const dueDateFormatted = task.due_date
    ? shortYmd(task.due_date!)
    : '—'

  // The dot has a name as well as a colour (UX D-42)
  const priorityDot =
    task.priority === 'high' || task.priority === 'urgent' ? '🔴' :
    task.priority === 'normal' ? '🟡' : '⚪'
  const priorityWord = task.priority === 'urgent' ? 'Urgent' : task.priority === 'high' ? 'High priority' : task.priority === 'low' ? 'Low priority' : 'Normal priority'

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
      className="flex items-center gap-4 px-4 border-b border-slate-100 dark:border-slate-700/50 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors"
      style={{ minHeight: 52 }}
    >
      <div className={`w-1 self-stretch rounded-full ${barColor}`} />
      <Tooltip content="Mark complete">
        <button
          onClick={handleComplete}
          disabled={completing}
          aria-label="Mark complete"
          className="hit-44 w-5 h-5 rounded-full border-2 border-slate-400 dark:border-slate-500 flex items-center justify-center flex-shrink-0 hover:border-accent hover:bg-accent-soft focus-visible:border-accent transition-colors focus:outline-hidden focus-visible:ring-3 focus-visible:ring-accent"
        >
          {completing && <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />}
        </button>
      </Tooltip>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm" role="img" aria-label={priorityWord} title={priorityWord}>{priorityDot}</span>
          <span className="font-medium text-slate-800 dark:text-slate-100 truncate">{task.title}</span>
          <span className="inline-flex items-center gap-1 text-sm bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 px-2 rounded-full flex-shrink-0"><ClipboardList className="w-3.5 h-3.5" aria-hidden="true" />task</span>
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
