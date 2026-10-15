/**
 * Shows one grid deadline card at a time, opened by the 'deadline:open-card'
 * event (see openDeadlineCard.ts). Mounted once, next to the grid.
 */
import React, { useCallback, useEffect, useState } from 'react'
import { pulseEvents } from '../../events'
import { DeadlineCard } from './DeadlineCard'

interface Open { rowId: number; columnId: number; anchor: HTMLElement }

export function DeadlineCardHost(): React.ReactElement | null {
  const [open, setOpen] = useState<Open | null>(null)
  const close = useCallback(() => setOpen(null), [])

  useEffect(() => {
    const offOpen = pulseEvents.on('deadline:open-card', ({ rowId, columnId, anchor }) => {
      const cell = anchor?.closest<HTMLElement>('[data-row-id][data-col-id]')
        ?? document.querySelector<HTMLElement>(`[data-row-id="${rowId}"][data-col-id="${columnId}"]`)
      if (!cell) return
      // Focus is on the cell before the card takes it, so it comes back there on close;
      // no scrolling, which would close the card again
      cell.focus({ preventScroll: true })
      setOpen({ rowId, columnId, anchor: cell })
    })
    const offLock = pulseEvents.on('app:locked', close)
    return () => { offOpen(); offLock() }
  }, [close])

  if (!open) return null
  return <DeadlineCard key={`${open.rowId}:${open.columnId}`} rowId={open.rowId} columnId={open.columnId} anchor={open.anchor} onClose={close} />
}
