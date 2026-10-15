import React from 'react'
import { useNavigate } from 'react-router-dom'

/**
 * A count tile. Every tile is a button that opens what it counts (UX D-06):
 * `href` goes to another page, `onClick` opens a tab on the dashboard.
 */
export function SummaryCard({
  label, value, icon, colorClass, urgent = false, href, onClick,
}: {
  label: string
  value: number | string
  icon: React.ReactNode
  colorClass: string
  urgent?: boolean
  href?: string
  onClick?: () => void
}): React.ReactElement {
  const navigate = useNavigate()
  const inner = (
    <>
      <div className={`flex items-center gap-2 mb-1 ${colorClass}`}>
        {icon}
        <span className="text-sm font-medium text-slate-500 dark:text-slate-400 leading-tight">{label}</span>
      </div>
      <div className={`text-2xl font-bold leading-none ${colorClass}`}>{value}</div>
    </>
  )
  const border = urgent ? 'border-red-300 dark:border-red-700' : 'border-slate-200 dark:border-slate-700'

  if (href || onClick) {
    return (
      <button
        type="button"
        onClick={() => { if (onClick) onClick(); else if (href) navigate(href) }}
        className={`rounded-lg border px-3 py-2 bg-white dark:bg-slate-800 text-left w-full hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:border-slate-400 dark:hover:border-slate-500 transition-colors focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 ${border}`}
        style={{ minHeight: 90 }}
      >
        {inner}
      </button>
    )
  }

  return (
    <div className={`rounded-lg border px-3 py-2 bg-white dark:bg-slate-800 ${border}`} style={{ minHeight: 90 }}>
      {inner}
    </div>
  )
}
