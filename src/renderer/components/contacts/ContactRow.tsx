import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Star } from 'lucide-react'
import { AvailabilityBadge } from './AvailabilityBadge'
import type { Provider } from '../../../shared/types'
import { relativeTime } from '../../utils/relativeTime'

interface Props {
  provider: Provider
  isSelected: boolean
  isFocused?: boolean
  onClick: () => void
  onToggleStar: () => void
}


export const ContactRow = React.memo(function ContactRow({ provider, isSelected, isFocused, onClick, onToggleStar }: Props) {
  const [starBounce, setStarBounce] = useState(false)
  const starTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => { clearTimeout(starTimerRef.current) }, [])

  const handleToggleStar = useCallback(() => {
    onToggleStar()
    setStarBounce(true)
    clearTimeout(starTimerRef.current)
    starTimerRef.current = setTimeout(() => setStarBounce(false), 400)
  }, [onToggleStar])

  const p = provider

  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-3 px-4 rounded-lg cursor-pointer transition-colors ${
        isSelected
          ? 'bg-blue-50 dark:bg-blue-900/20 border border-blue-500'
          : isFocused
            ? 'bg-slate-50 dark:bg-slate-800/50 border border-blue-400 ring-3 ring-blue-100 dark:ring-blue-900'
            : 'border border-transparent hover:bg-slate-50 dark:hover:bg-slate-800'
      }`}
      style={{ minHeight: 44, fontSize: 15 }}
    >
      {/* Category color dot */}
      <div
        className="w-3 h-3 rounded-full flex-shrink-0"
        style={{ backgroundColor: p.category_color || '#94a3b8' }}
        title={p.category_name ? `Category: ${p.category_name}` : 'No category'}
      />

      {/* Star */}
      <button
        onClick={e => { e.stopPropagation(); handleToggleStar() }}
        className="hit-44 p-0.5 flex-shrink-0 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 rounded-sm"
        title={p.is_starred ? 'Unstar' : 'Star'}
        aria-label={p.is_starred ? 'Unstar' : 'Star'}
      >
        <Star size={14} className={`${p.is_starred ? 'fill-amber-400 text-amber-400' : 'text-slate-300 dark:text-slate-500'} ${starBounce ? 'animate-star-bounce' : ''}`} />
      </button>

      {/* Name + Org */}
      <div className="min-w-0 flex-1">
        <span className="font-medium text-slate-900 dark:text-white truncate block">{p.name}</span>
        {p.org_name && p.org_name !== p.name && (
          <span className="text-sm text-slate-500 dark:text-slate-400 truncate block">{p.org_name}</span>
        )}
      </div>

      {/* Category */}
      {p.category_name && (
        <span
          className="px-2 py-0.5 rounded-sm text-sm font-medium flex-shrink-0"
          style={{
            backgroundColor: (p.category_color || '#64748b') + '20',
            color: p.category_color || '#64748b',
          }}
        >
          {p.category_name}
        </span>
      )}

      {/* Phone */}
      {p.phone_main && (
        <span className="text-sm text-slate-600 dark:text-slate-400 flex-shrink-0 hidden md:inline" style={{ fontSize: 15 }}>
          {p.phone_main}
        </span>
      )}

      {/* Availability */}
      <div className="flex-shrink-0">
        <AvailabilityBadge status={p.availability_status} compact />
      </div>

      {/* Last contacted */}
      <span className="text-sm text-slate-500 dark:text-slate-400 flex-shrink-0 w-16 text-right hidden lg:inline">
        {relativeTime(p.last_interaction_at)}
      </span>
    </div>
  )
})
