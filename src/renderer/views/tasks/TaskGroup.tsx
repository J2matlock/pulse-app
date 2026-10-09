import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { CaseloadTask } from '../../../shared/types'
import { TaskItem } from '../../components/tasks/TaskItem'

export function TaskGroup({
  title, tasks, defaultOpen = true,
  onComplete, onDelete, onEdit, onSnooze, onUpdate
}: {
  title: string
  tasks: CaseloadTask[]
  defaultOpen?: boolean
  onComplete: (id: number) => void
  onDelete: (id: number) => void
  onEdit: (task: CaseloadTask) => void
  onSnooze: (id: number) => void
  onUpdate: (id: number, updates: Partial<CaseloadTask>) => void
}) {
  const [open, setOpen] = useState(defaultOpen)

  if (tasks.length === 0) return null

  return (
    <div>
      <button
        onClick={() => setOpen(p => !p)}
        className="hit-44 flex items-center gap-2 w-full text-left px-1 py-2
                   text-base font-medium text-slate-600 dark:text-slate-400
                   hover:text-slate-800 dark:hover:text-slate-200
                   focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 rounded-sm"
      >
        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        {title}
        <span className="ml-1 px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-sm">
          {tasks.length}
        </span>
      </button>
      {open && (
        <div className="space-y-0.5 mt-1">
          {tasks.map(task => (
            <TaskItem
              key={task.id}
              task={task}
              isDragDisabled
              onToggle={() => onComplete(task.id)}
              onUpdate={updates => onUpdate(task.id, updates)}
              onDelete={() => onDelete(task.id)}
              onEdit={() => onEdit(task)}
              onSnooze={() => onSnooze(task.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
