import React from 'react'
import { AlertTriangle } from 'lucide-react'

/** Placeholders a document had that matched nothing (W10 §3); they're left in the text as typed. */
export function UnknownPlaceholders({ unknown }: { unknown: string[] }): React.ReactElement | null {
  if (unknown.length === 0) return null
  return (
    <p role="status" className="flex items-start gap-2 text-base text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2">
      <AlertTriangle className="w-4 h-4 mt-1 flex-shrink-0" aria-hidden="true" />
      <span>
        {unknown.length === 1 ? "This placeholder wasn't recognized, so it's left as typed: " : "These placeholders weren't recognized, so they're left as typed: "}
        <span className="font-mono">{unknown.join(', ')}</span>
      </span>
    </p>
  )
}
