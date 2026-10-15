/**
 * "More settings": the choices that are right as they are for nearly
 * everyone, folded away under one plain-words disclosure (UX pass Q1c).
 *
 *   <MoreSettings changed={gridDensity !== 'comfortable'}>…</MoreSettings>
 *
 * It starts open when anything inside differs from its default, so nobody
 * loses a setting they already changed. If `changed` turns true later (the
 * values load after the first paint), it opens then, unless the person has
 * already opened or closed it themselves. After that it follows the person.
 *
 * A native <details>/<summary>: screen readers announce it as a disclosure,
 * and Enter or Space opens it from the keyboard.
 */
import React, { useState } from 'react'
import { ChevronRight } from 'lucide-react'

export interface MoreSettingsProps {
  /** Default "More settings"; the same words everywhere so people learn where things went */
  label?: string
  /** Something inside differs from its default: start open */
  changed: boolean
  children: React.ReactNode
  className?: string
  'data-testid'?: string
}

export function MoreSettings({ label = 'More settings', changed, children, className = '', ...rest }: MoreSettingsProps): React.ReactElement {
  const [open, setOpen] = useState(changed)
  const [touched, setTouched] = useState(false)
  const [wasChanged, setWasChanged] = useState(changed)
  // Values that arrive after the first render still open it (adjusting state while rendering, not in an effect)
  if (changed !== wasChanged) {
    setWasChanged(changed)
    if (changed && !touched && !open) setOpen(true)
  }
  return (
    <details
      open={open}
      onToggle={e => {
        const now = e.currentTarget.open
        // React setting `open` fires toggle too; only a different value is the person's doing
        if (now !== open) { setTouched(true); setOpen(now) }
      }}
      className={`group rounded-lg border border-slate-200 dark:border-slate-600 px-3 ${className}`}
      {...rest}
    >
      <summary className="hit-44 flex min-h-11 items-center gap-2 list-none [&::-webkit-details-marker]:hidden cursor-pointer select-none rounded-lg text-base font-medium text-slate-700 dark:text-slate-300 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-accent">
        <ChevronRight aria-hidden="true" className="w-4 h-4 flex-shrink-0 transition-transform group-open:rotate-90" />
        {label}
      </summary>
      <div className="space-y-4 pb-4 pt-2">
        {children}
      </div>
    </details>
  )
}
