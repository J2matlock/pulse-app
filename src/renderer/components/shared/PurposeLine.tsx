/**
 * The one sentence under a screen's title saying what the screen is for
 * (UX pass Q2). Permanent, unlike a one-time hint: a hint says how to do one
 * thing, this says why the screen exists. One per screen; PageHeader's
 * description is the same line for screens drawn with PageHeader.
 *
 * Words come from the caller through the vocabulary layer (useVocab().f).
 */
import React from 'react'

export function PurposeLine({ children, className }: { children: React.ReactNode; className?: string }): React.ReactElement {
  return (
    <p data-purpose className={`max-w-prose text-base text-slate-600 dark:text-slate-300 ${className ?? ''}`}>
      {children}
    </p>
  )
}
