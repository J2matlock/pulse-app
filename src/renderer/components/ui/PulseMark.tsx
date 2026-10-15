/**
 * Pulse's own mark (the knot running into a pulse line), the same artwork as
 * the app icon, so password setup, the lock screen, the welcome screen and
 * About all show one logo (UX pass Q8).
 *
 *   <PulseMark size={48} />                 decorative: the product name is next to it
 *   <PulseMark size={64} label="Pulse" />   when it stands alone and needs a name
 *
 * It sits on a white rounded tile with a thin ring in both themes: the navy
 * knot has too little contrast on slate-900, and a tile is how an app icon
 * looks anyway.
 */
import React from 'react'
import markUrl from '../../assets/pulse-mark.png'

export type PulseMarkSize = 32 | 48 | 64

export interface PulseMarkProps {
  size?: PulseMarkSize
  /** The image's name for screen readers; leave it out when the name is already written beside it */
  label?: string
  className?: string
}

const TILE: Record<PulseMarkSize, string> = {
  32: 'w-8 h-8 p-0.5',
  48: 'w-12 h-12 p-1',
  64: 'w-16 h-16 p-1',
}

export function PulseMark({ size = 48, label, className }: PulseMarkProps): React.ReactElement {
  return (
    <span className={`inline-flex flex-shrink-0 items-center justify-center rounded-lg bg-white ring-1 ring-slate-200 dark:ring-slate-600 ${TILE[size]} ${className ?? ''}`}>
      <img src={markUrl} alt={label ?? ''} aria-hidden={label ? undefined : true} draggable={false} className="w-full h-full object-contain" />
    </span>
  )
}
