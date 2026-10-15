/**
 * The one sentence under a screen's title saying what the screen is for
 * (UX pass Q2). Permanent, unlike a one-time hint: a hint says how to do one
 * thing, this says why the screen exists. One per screen; PageHeader's
 * description is the same line for screens drawn with PageHeader.
 *
 * Words come from the caller through the vocabulary layer (useVocab().f).
 */
import React from 'react'

/** wide: no line-length cap, for a screen whose line also carries a key (Calendar's colours) */
export function PurposeLine({ children, className, wide = false }: { children: React.ReactNode; className?: string; wide?: boolean }): React.ReactElement {
  return (
    <p data-purpose className={`${wide ? '' : 'max-w-3xl '}text-base text-slate-600 dark:text-slate-300 ${className ?? ''}`}>
      {children}
    </p>
  )
}
