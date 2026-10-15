import React from 'react'
import { CheckCircle2 } from 'lucide-react'
import type { UrgentChecklistItem } from './types'
import { useVocabByList } from '../../hooks/useVocab'
import { ymdLocalDate } from '../../../shared/dates'

export const ChecklistFocusItem = React.memo(function ChecklistFocusItem({ item, celebrating, onComplete, onNavigate }: {
  item: UrgentChecklistItem
  celebrating: boolean
  onComplete: () => void
  onNavigate: () => void
}): React.ReactElement {
  const tFor = useVocabByList()
  const dueDateLabel = item.due_date
    ? ymdLocalDate(item.due_date!).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : null

  return (
    <div
      className={`flex items-center gap-4 px-5 py-4 ${celebrating ? 'celebrating' : ''}`}
      style={{ minHeight: 64 }}
    >
      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0 bg-amber-400" />
      <div className="flex-1 min-w-0">
        <div className="font-medium text-slate-900 dark:text-white truncate">{item.title}</div>
        <div className="text-sm text-slate-600 dark:text-slate-400 truncate">
          <button onClick={onNavigate} className="hit-44 hover:underline text-left focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-400 rounded-sm">{item.client_name ?? `Unknown ${tFor(item.grid_id)('record')}`}</button>
          {item.grid_name && <span className="ml-2">· {item.grid_name}</span>}
        </div>
        {(item.category || dueDateLabel) && (
          <div className="flex items-center gap-2 mt-0.5">
            {item.category && <span className="text-sm text-slate-600 dark:text-slate-400">{item.category}</span>}
            {item.category && dueDateLabel && <span className="text-slate-500 text-sm">·</span>}
            {dueDateLabel && <span className="text-sm text-amber-700 dark:text-amber-400">Due {dueDateLabel}</span>}
          </div>
        )}
      </div>
      <button
        onClick={onComplete}
        disabled={celebrating}
        aria-label={`Mark ${item.title} done`}
        className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-700 hover:bg-amber-600 text-white text-base font-medium transition-colors focus:outline-hidden focus-visible:ring-3 focus-visible:ring-amber-400 disabled:opacity-50"
        style={{ minHeight: 44 }}
      >
        <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
        Done
      </button>
    </div>
  )
})
