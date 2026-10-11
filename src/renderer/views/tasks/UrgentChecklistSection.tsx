import { useState } from 'react'
import { ChevronDown, ChevronRight, AlertTriangle, ExternalLink } from 'lucide-react'
import type { UrgentChecklistItem } from '../../../shared/types'
import { dueDateLabel } from './taskHelpers'
import { useVocabByList } from '../../hooks/useVocab'

export function UrgentChecklistSection({ items, onToggle, onNavigate }: {
  items: UrgentChecklistItem[]
  onToggle: (item: UrgentChecklistItem) => void
  onNavigate: (gridId: number, rowId: number) => void
}) {
  const tFor = useVocabByList()
  const [open, setOpen] = useState(true)

  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen(p => !p)}
        className="hit-44 flex items-center gap-2 w-full text-left px-1 py-2
                   text-base font-medium text-red-600 dark:text-red-400
                   hover:text-red-700 dark:hover:text-red-300
                   focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-red-500 rounded-sm"
      >
        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        <AlertTriangle className="w-4 h-4" />
        Urgent checklist items
        <span className="ml-1 px-1.5 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-sm text-red-700 dark:text-red-300">
          {items.length}
        </span>
      </button>
      {open && (
        <div className="space-y-0.5 mt-1">
          {items.map(item => {
            const due = dueDateLabel(item.due_date)
            return (
              <div
                key={item.id}
                className="group flex items-start gap-2 py-2 px-3 rounded-lg
                           hover:bg-slate-100 dark:hover:bg-slate-700
                           border-l-3 border-l-red-400"
              >
                {/* Checkbox */}
                <button
                  onClick={() => onToggle(item)}
                  style={{ minWidth: 28 }}
                  className="hit-44 flex-shrink-0 flex items-start justify-center pt-[1px]
                             focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500
                             focus-visible:ring-offset-3 rounded-sm"
                  aria-label="Mark complete"
                >
                  <span className="w-[22px] h-[22px] rounded-[5px] border-2 border-slate-300 dark:border-slate-500
                                   bg-white dark:bg-slate-800/40
                                   hover:border-blue-400 dark:hover:border-blue-400
                                   hover:bg-blue-50 dark:hover:bg-blue-900/20
                                   transition-all duration-200" />
                </button>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <span className="text-base text-slate-800 dark:text-slate-200 break-words leading-snug"
                        style={{ fontSize: 15 }}>
                    {item.title}
                  </span>
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    <span className="px-1.5 py-0.5 rounded-sm text-sm font-medium
                                     bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
                      Urgent
                    </span>
                    {item.client_name && (
                      <button
                        onClick={() => onNavigate(item.grid_id, item.row_id)}
                        className="hit-44 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-sm text-base
                                   bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300
                                   hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
                        title={`Open ${item.client_name}'s profile`}
                      >
                        {item.client_name}
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    )}
                    {item.grid_name && (
                      <span className="px-1.5 py-0.5 rounded-sm text-sm
                                       bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400">
                        {item.grid_name}
                      </span>
                    )}
                    {due && (
                      <span className={`text-sm font-medium ${due.className}`}>
                        {due.text}
                      </span>
                    )}
                    {item.category && (
                      <span className="px-1.5 py-0.5 rounded-sm text-sm
                                       bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400">
                        {item.category}
                      </span>
                    )}
                  </div>
                </div>

                {/* Navigate to profile */}
                <button
                  onClick={() => onNavigate(item.grid_id, item.row_id)}
                  title={`Open the profile for ${item.client_name ?? tFor(item.grid_id)('record', { article: true })}`}
                  aria-label={`Open the profile for ${item.client_name ?? tFor(item.grid_id)('record', { article: true })}`}
                  className="hit-44 flex-shrink-0 p-1.5 rounded-sm text-slate-500 hover:text-blue-500
                             hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors
                             opacity-0 group-hover:opacity-100 focus-visible:opacity-100 group-focus-within:opacity-100
                             focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
                >
                  <ExternalLink className="w-4 h-4" />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
