import React, { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

interface CollapsibleSectionProps {
  title: string
  sectionKey: string
  defaultExpanded?: boolean
  /** How many things are inside, shown in the title ("Files (2)"). A section with none starts collapsed. */
  count?: number
  /** Shown instead of the number, e.g. "1 coming up" */
  countLabel?: string
  /** Keep the contents mounted while collapsed (so they can report their count) */
  keepMounted?: boolean
  children: React.ReactNode
}

function getStoredState(sectionKey: string): boolean | null {
  try {
    const stored = localStorage.getItem(`pulse-section-${sectionKey}`)
    if (stored !== null) return stored === 'true'
  } catch {
    // localStorage unavailable
  }
  return null
}

export function CollapsibleSection({
  title,
  sectionKey,
  defaultExpanded = true,
  count,
  countLabel,
  keepMounted = false,
  children,
}: CollapsibleSectionProps): React.ReactElement {
  // What the person chose last time wins; otherwise empty sections start collapsed
  const [stored, setStored] = useState<boolean | null>(() => getStoredState(sectionKey))
  const expanded = stored ?? (count === 0 ? false : defaultExpanded)

  function toggle() {
    const next = !expanded
    setStored(next)
    try {
      localStorage.setItem(`pulse-section-${sectionKey}`, String(next))
    } catch {
      // localStorage unavailable
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        className="flex items-center gap-2 w-full px-2 py-2 rounded-lg cursor-pointer select-none
                   text-base font-semibold text-slate-700 dark:text-slate-300
                   hover:bg-slate-50 dark:hover:bg-slate-800
                   focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
        style={{ minHeight: 44 }}
        aria-expanded={expanded}
      >
        {expanded
          ? <ChevronDown className="w-4 h-4 text-slate-500 dark:text-slate-400 flex-shrink-0" />
          : <ChevronRight className="w-4 h-4 text-slate-500 dark:text-slate-400 flex-shrink-0" />
        }
        {title}
        {count !== undefined && <>
          {' '}<span className="font-normal text-slate-500 dark:text-slate-400">({countLabel ?? count})</span>
        </>}
      </button>
      {keepMounted
        ? <div hidden={!expanded}>{children}</div>
        : expanded && children}
    </div>
  )
}
