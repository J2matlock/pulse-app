import React, { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

interface CollapsibleSectionProps {
  title: string
  sectionKey: string
  defaultExpanded?: boolean
  children: React.ReactNode
}

function getInitialState(sectionKey: string, defaultExpanded: boolean): boolean {
  try {
    const stored = localStorage.getItem(`pulse-section-${sectionKey}`)
    if (stored !== null) return stored === 'true'
  } catch {
    // localStorage unavailable
  }
  return defaultExpanded
}

export function CollapsibleSection({
  title,
  sectionKey,
  defaultExpanded = true,
  children,
}: CollapsibleSectionProps): React.ReactElement {
  const [expanded, setExpanded] = useState(() => getInitialState(sectionKey, defaultExpanded))

  function toggle() {
    const next = !expanded
    setExpanded(next)
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
      </button>
      {expanded && children}
    </div>
  )
}
