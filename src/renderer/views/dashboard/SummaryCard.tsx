import React from 'react'
import { useNavigate } from 'react-router-dom'

export function SummaryCard({
  label, value, icon, colorClass, urgent = false, href,
}: {
  label: string
  value: number | string
  icon: React.ReactNode
  colorClass: string
  urgent?: boolean
  href?: string
}): React.ReactElement {
  const navigate = useNavigate()
  const inner = (
    <>
      <div className={`flex items-center gap-2 mb-1 ${colorClass}`}>
        {icon}
        <span className="text-sm font-medium text-slate-500 dark:text-slate-400">{label}</span>
      </div>
      <div className={`text-3xl font-bold ${colorClass}`}>{value}</div>
    </>
  )

  if (href) {
    return (
      <button
        onClick={() => navigate(href)}
        className={`rounded-lg border p-4 bg-white dark:bg-slate-800 text-left w-full hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 ${
          urgent ? 'border-purple-300 dark:border-purple-700' : 'border-slate-200 dark:border-slate-700'
        }`}
        style={{ minHeight: 44 }}
      >
        {inner}
      </button>
    )
  }

  return (
    <div className={`rounded-lg border p-4 bg-white dark:bg-slate-800 ${
      urgent ? 'border-red-300 dark:border-red-700' : 'border-slate-200 dark:border-slate-700'
    }`}>
      {inner}
    </div>
  )
}
