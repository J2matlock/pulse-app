/**
 * ChecklistToolbar.tsx — the Checklist header: "+ Add with details…" and a "⋯"
 * menu with "Add a heading" and "Templates…". Three side-by-side buttons wrapped
 * onto two rows in the 300 px column (C-07, C-19).
 */

import { ListChecks } from 'lucide-react'
import { RowMenu, type MenuItem } from '../ui/RowMenu'

interface Props {
  loading: boolean
  total: number
  doneCount: number
  onOpenTemplates: () => void
  onAddTask?: () => void
  onAddGroup?: () => void
}

export function ChecklistToolbar({ loading, total, doneCount, onOpenTemplates, onAddTask, onAddGroup }: Props) {
  const items: MenuItem[] = [
    ...(onAddGroup ? [{ label: 'Add a heading', onSelect: onAddGroup }] : []),
    { label: 'Templates…', onSelect: onOpenTemplates },
  ]

  return (
    <div className="flex items-center justify-between px-1 pb-3 border-b border-slate-200 dark:border-slate-700 flex-wrap gap-2">
      <div className="flex items-center gap-2">
        <ListChecks className="w-5 h-5 text-slate-500 dark:text-slate-400" aria-hidden="true" />
        <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Checklist</h2>
        {!loading && total > 0 && (
          <span className="text-sm text-slate-500 dark:text-slate-400 tabular-nums">
            {doneCount}/{total}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1 min-w-0">
        {/* The box below adds an item; this opens the form with a due date, priority and notes (3.4) */}
        {onAddTask && (
          <button
            onClick={onAddTask}
            className="btn-compact-secondary whitespace-nowrap"
          >
            + Add with details…
          </button>
        )}

        <RowMenu label="More checklist actions" items={items} />
      </div>
    </div>
  )
}
