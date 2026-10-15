import React from 'react'
import { ChevronRight } from 'lucide-react'

interface Props {
  gridName: string
  clientName: string
  onGridClick: () => void
}

export function Breadcrumb({ gridName, clientName, onGridClick }: Props): React.ReactElement {
  return (
    <nav className="flex items-center gap-1 text-base min-w-0" aria-label="Breadcrumb">
      <button
        onClick={onGridClick}
        title={`Back to ${gridName}`}
        className="hit-44 text-blue-600 dark:text-blue-400 hover:underline font-medium truncate cursor-pointer
                   focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 rounded-sm"
      >
        {gridName}
      </button>
      {/* No name yet (the record is loading, or isn't in the list): just the list (C-22) */}
      {clientName && (<>
        <ChevronRight className="w-4 h-4 text-slate-500 dark:text-slate-400 flex-shrink-0" />
        <span className="text-slate-700 dark:text-slate-200 font-medium truncate">
          {clientName}
        </span>
      </>)}
    </nav>
  )
}
