/**
 * ChecklistToolbar.tsx — Action buttons for Checklist header (Add Task, Group, Templates).
 */

import { ListChecks, FolderPlus } from 'lucide-react'

export type SortMode = 'manual' | 'due_date' | 'priority'

interface Props {
  loading: boolean
  total: number
  doneCount: number
  onOpenTemplates: () => void
  onAddTask?: () => void
  onAddGroup?: () => void
}

export function ChecklistToolbar({ loading, total, doneCount, onOpenTemplates, onAddTask, onAddGroup }: Props) {
  return (
    <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-slate-100 dark:border-slate-700 flex-wrap gap-2">
      <div className="flex items-center gap-2">
        <ListChecks className="w-5 h-5 text-slate-500 dark:text-slate-400" />
        <h2 className="text-base font-semibold text-slate-700 dark:text-slate-300">Checklist</h2>
        {!loading && total > 0 && (
          <span className="text-sm text-slate-500 dark:text-slate-400 tabular-nums">
            {doneCount}/{total}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap min-w-0">
        {/* Add Task */}
        {onAddTask && (
          <button
            onClick={onAddTask}
            className="btn-compact-primary"
          >
            + Add Task
          </button>
        )}

        {/* Add Group */}
        {onAddGroup && (
          <button
            onClick={onAddGroup}
            title="Add a group to organize checklist items"
            className="btn-compact-secondary"
          >
            <FolderPlus className="w-3.5 h-3.5" />
            Group
          </button>
        )}

        {/* Templates */}
        <button
          onClick={onOpenTemplates}
          className="btn-compact-soft"
        >
          Templates
        </button>
      </div>
    </div>
  )
}
