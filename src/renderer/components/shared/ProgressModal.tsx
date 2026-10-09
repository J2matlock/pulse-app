import React from 'react'

interface ProgressModalProps {
  open: boolean
  title: string
  current: number
  total: number
  label?: string
}

export function ProgressModal({ open, title, current, total, label }: ProgressModalProps): React.ReactElement | null {
  if (!open) return null
  const pct = total > 0 ? Math.round((current / total) * 100) : 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl p-6 w-80">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4">{title}</h3>
        <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-3 mb-2">
          <div
            className="bg-blue-500 h-3 rounded-full transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[15px] text-slate-500 dark:text-slate-400">
          <span>{label || `${current} of ${total}`}</span>
          <span>{pct}%</span>
        </div>
      </div>
    </div>
  )
}
