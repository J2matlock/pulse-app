import React from 'react'
import { useNavigate } from 'react-router-dom'
import { TickingNumber } from '../../components/shared/TickingNumber'

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
        <span className="flex-shrink-0" aria-hidden="true">{icon}</span>
        <span className="text-sm font-medium text-slate-600 dark:text-slate-300 leading-tight">{label}</span>
      </div>
      <div className={`text-2xl font-bold leading-none ${colorClass}`}><TickingNumber value={value} /></div>
    </>
  )
  // A tint, not a border, sets a tile apart (Q8); a late count adds a red ring
  const ring = urgent ? 'ring-1 ring-inset ring-red-300 dark:ring-red-700' : ''

  if (href || onClick) {
    return (
      <button
        type="button"
        onClick={() => { if (onClick) onClick(); else if (href) navigate(href) }}
        className={`rounded-lg px-4 py-3 bg-slate-50 dark:bg-slate-800/60 text-left w-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus:outline-hidden focus-visible:ring-3 focus-visible:ring-accent ${ring}`}
        style={{ minHeight: 90 }}
      >
        {inner}
      </button>
    )
  }

  return (
    <div className={`rounded-lg px-4 py-3 bg-slate-50 dark:bg-slate-800/60 ${ring}`} style={{ minHeight: 90 }}>
      {inner}
    </div>
  )
}
