import React from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

export const FocusSection = React.memo(function FocusSection({
  icon, title, iconColor, count, expanded, onToggle, children
}: {
  icon: React.ReactNode
  title: string
  iconColor: string
  count: number
  expanded: boolean
  onToggle: () => void
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-5 py-4 text-left focus:outline-hidden focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-blue-500"
        style={{ minHeight: 56 }}
      >
        <div className={iconColor}>{icon}</div>
        <span className="flex-1 text-base font-semibold text-white">{title}</span>
        <span className="text-sm text-slate-500 dark:text-slate-400 tabular-nums mr-2">{count} remaining</span>
        {expanded
          ? <ChevronUp className="w-4 h-4 text-slate-500" />
          : <ChevronDown className="w-4 h-4 text-slate-500" />
        }
      </button>
      {expanded && (
        <div className="border-t border-slate-700 divide-y divide-slate-700/50">
          {children}
        </div>
      )}
    </div>
  )
})
