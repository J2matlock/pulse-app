/**
 * The Calendar's side panel: a title, a Close button and whatever the
 * clicked thing needs (an appointment, a deadline or a follow-up, UX D-08).
 */
import React from 'react'
import { X } from 'lucide-react'

export function CalendarPanel({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }): React.ReactElement {
  return (
    <aside aria-labelledby="calendar-panel-title" className="w-full sm:w-80 flex-shrink-0 border-l border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 space-y-3 overflow-y-auto">
      <div className="flex items-start gap-2">
        <h2 id="calendar-panel-title" className="flex-1 text-lg font-semibold text-slate-900 dark:text-slate-100 break-words">{title}</h2>
        <button type="button" aria-label="Close" onClick={onClose}
          className="hit-44 p-1.5 rounded-sm hover:bg-slate-100 dark:hover:bg-slate-700 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"><X className="w-5 h-5 text-slate-500" /></button>
      </div>
      {children}
    </aside>
  )
}
