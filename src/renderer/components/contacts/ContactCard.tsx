import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Star, Copy, Check } from 'lucide-react'
import { AvailabilityBadge } from './AvailabilityBadge'
import type { Provider } from '../../../shared/types'
import { relativeTime } from '../../utils/relativeTime'
import { useCopyFeedbackKeyed } from '../../hooks/useCopyFeedback'

interface Props {
  provider: Provider
  isSelected: boolean
  isFocused?: boolean
  onClick: () => void
  onToggleStar: () => void
}


export const ContactCard = React.memo(function ContactCard({ provider, isSelected, isFocused, onClick, onToggleStar }: Props) {
  const { copiedKey: copiedField, copyToClipboard } = useCopyFeedbackKeyed()
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
  const lastContact = relativeTime(p.last_interaction_at)

  return (
    <div
      onClick={onClick}
      className={`relative rounded-lg border cursor-pointer transition-all hover:shadow-md ${
        isSelected
          ? 'border-blue-500 ring-3 ring-blue-200 dark:ring-blue-800'
          : isFocused
            ? 'border-blue-400 ring-3 ring-blue-100 dark:ring-blue-900'
            : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
      } bg-white dark:bg-slate-800 overflow-hidden`}
    >
      {/* Category color stripe */}
      {p.category_color && (
        <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-lg" style={{ backgroundColor: p.category_color }} />
      )}

      <div className="p-4 pl-5">
        {/* Star */}
        <button
          onClick={e => { e.stopPropagation(); handleToggleStar() }}
          className="hit-44 absolute top-3 right-3 p-1 rounded-sm hover:bg-slate-100 dark:hover:bg-slate-700 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
          title={p.is_starred ? 'Unstar' : 'Star'}
          aria-label={p.is_starred ? 'Unstar' : 'Star'}
        >
          <Star size={16} className={`${p.is_starred ? 'fill-amber-400 text-amber-400' : 'text-slate-300 dark:text-slate-500'} ${starBounce ? 'animate-star-bounce' : ''}`} />
        </button>

        {/* Name */}
        <div className="font-semibold text-slate-900 dark:text-white pr-8 truncate" style={{ fontSize: 16 }}>
          {p.name}
        </div>
        {p.org_name && p.org_name !== p.name && (
          <div className="text-sm text-slate-500 dark:text-slate-400 truncate">{p.org_name}</div>
        )}

        {/* Category + Availability */}
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          {p.category_name && (
            <span
              className="px-2 py-0.5 rounded-sm text-sm font-medium"
              style={{
                backgroundColor: (p.category_color || '#64748b') + '20',
                color: p.category_color || '#64748b',
              }}
            >
              {p.category_name}
            </span>
          )}
          {/* A grey "Unknown" on every new entry said nothing (E-22) */}
          {p.availability_status && p.availability_status !== 'unknown' && (
            <AvailabilityBadge status={p.availability_status} checkedAt={p.availability_checked_at} compact />
          )}
        </div>

        {/* Phone + Email */}
        <div className="mt-3 space-y-1">
          {p.phone_main && (
            <div className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
              <span className="truncate" style={{ fontSize: 15 }}>{p.phone_main}</span>
              <button
                onClick={e => { e.stopPropagation(); copyToClipboard(p.phone_main!, 'phone') }}
                className="hit-44 p-0.5 rounded-sm hover:bg-slate-100 dark:hover:bg-slate-700 flex-shrink-0 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
                title="Copy phone"
                aria-label="Copy phone"
              >
                {copiedField === 'phone' ? <Check size={14} className="text-green-500" /> : <Copy size={14} className="text-slate-500 dark:text-slate-400" />}
              </button>
            </div>
          )}
          {p.email && (
            <div className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
              <span className="truncate" style={{ fontSize: 15 }}>{p.email}</span>
              <button
                onClick={e => { e.stopPropagation(); copyToClipboard(p.email!, 'email') }}
                className="hit-44 p-0.5 rounded-sm hover:bg-slate-100 dark:hover:bg-slate-700 flex-shrink-0 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
                title="Copy email"
                aria-label="Copy email"
              >
                {copiedField === 'email' ? <Check size={14} className="text-green-500" /> : <Copy size={14} className="text-slate-500 dark:text-slate-400" />}
              </button>
            </div>
          )}
        </div>

        {/* Last contacted */}
        {lastContact && (
          <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Last contacted: {lastContact}
          </div>
        )}
      </div>
    </div>
  )
})
