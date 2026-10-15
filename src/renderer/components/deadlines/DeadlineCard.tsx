/**
 * A grid cell's deadline card (UX pass Q3): the shared deadline card in a
 * small pop-up under the cell, so a deadline can be marked done or extended
 * without leaving the list. It flips above the cell when there isn't room
 * below and stays 16 px inside the window. Focus goes to its first button;
 * Escape, a click outside it or a scroll of the list closes it, and focus
 * goes back to the cell.
 */
import React, { useEffect, useId, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useGridStore } from '../../stores/gridStore'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useVocab } from '../../hooks/useVocab'
import { getClientName } from '../../utils/clientName'
import { IconButton, SecondaryButton } from '../ui/Button'
import { useRecordDeadlines, deadlineKey } from './useRecordDeadlines'
import { DeadlineCardContent } from './DeadlineCardContent'

const WIDTH = 320
const MARGIN = 16
const GAP = 4
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]'

/** Where the card goes: under the anchor, or above it when it wouldn't fit, always inside the window */
export function placeCard(anchor: DOMRect, height: number, view: { width: number; height: number }): { top: number; left: number; width: number; above: boolean } {
  const width = Math.min(WIDTH, view.width - 2 * MARGIN)
  const left = Math.max(MARGIN, Math.min(anchor.left, view.width - MARGIN - width))
  const below = anchor.bottom + GAP
  const aboveTop = anchor.top - GAP - height
  const above = below + height > view.height - MARGIN && aboveTop >= MARGIN
  const top = above ? aboveTop : Math.max(MARGIN, Math.min(below, view.height - MARGIN - height))
  return { top, left, width, above }
}

/** Another dialog is open over the page (the card's own Extend… or Done on…, say) */
function otherDialogOpen(card: HTMLElement | null): boolean {
  return Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"]')).some(d => d !== card)
}

export function DeadlineCard({ rowId, columnId, anchor, onClose }: {
  rowId: number
  columnId: number
  /** The cell: the card sits under it, and focus goes back to it */
  anchor: HTMLElement
  onClose: () => void
}): React.ReactElement {
  const cardRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const navigate = useNavigate()
  const { t } = useVocab()
  const { infos, reload } = useRecordDeadlines([rowId], { includeDone: true })
  const info = infos?.get(deadlineKey(rowId, columnId))
  const { column, row, columns } = useGridStore(useShallow(s => ({
    column: s.columns.find(c => c.id === columnId),
    row: s.rows.find(r => r.row_id === rowId),
    columns: s.columns,
  })))
  const recordName = info?.clientName || (row ? getClientName(row, columns) : '')
  const title = [column?.name ?? info?.columnName, recordName].filter(Boolean).join(' · ')

  // Escape closes it (a dialog opened from it takes Escape first); focus goes back to the cell
  useFocusTrap(cardRef, true, { onEscape: onClose })

  // Under the cell, or above it near the bottom of the window; again when its height changes
  useLayoutEffect(() => {
    const el = cardRef.current
    if (!el) return
    const at = placeCard(anchor.getBoundingClientRect(), el.offsetHeight, { width: window.innerWidth, height: window.innerHeight })
    el.style.top = `${at.top}px`
    el.style.left = `${at.left}px`
    el.style.width = `${at.width}px`
    el.dataset.placement = at.above ? 'above' : 'below'
  })

  // Focus is in the card from the start, so Escape and Tab work while it loads; then on Done
  useEffect(() => { cardRef.current?.focus() }, [])
  const loaded = infos !== null
  useEffect(() => {
    if (!loaded) return
    const el = cardRef.current
    if (el && (document.activeElement === el || !el.contains(document.activeElement))) el.querySelector<HTMLElement>('[data-testid="deadline-card-actions"] button:not([disabled])')?.focus()
  }, [loaded])

  // A click outside or a scroll of the list closes it, so it never floats loose
  useEffect(() => {
    function onDown(e: MouseEvent) {
      const target = e.target as Element | null
      if (!target || cardRef.current?.contains(target) || otherDialogOpen(cardRef.current)) return
      onClose()
      // The trap puts focus back on the cell; the click meant something else
      const clicked = target.closest<HTMLElement>(FOCUSABLE)
      if (clicked) requestAnimationFrame(() => { if (clicked.isConnected) clicked.focus() })
    }
    function onScroll(e: Event) {
      const target = e.target
      if (target instanceof Node && cardRef.current?.contains(target)) return
      if (otherDialogOpen(cardRef.current)) return
      onClose()
    }
    document.addEventListener('mousedown', onDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  const changed = async () => {
    await useGridStore.getState().refreshDeadlineContext()
    await reload()
  }
  const openRecord = () => { onClose(); navigate(`/profile/${rowId}?gridId=${info?.gridId ?? column?.grid_id ?? ''}`) }

  return createPortal(
    // Under the dialog layer (z-[200]), so the card's own Extend… and Done on… open over it
    <div ref={cardRef} role="dialog" aria-labelledby={titleId} tabIndex={-1} data-testid="deadline-card"
      className="fixed z-[150] rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-xl p-4 space-y-3 focus:outline-hidden"
      style={{ top: 0, left: 0, width: WIDTH, maxWidth: `calc(100vw - ${2 * MARGIN}px)` }}>
      <h2 id={titleId} className="pr-8 text-base font-semibold text-slate-900 dark:text-slate-100 break-words">{title}</h2>
      {infos === null ? (
        <p className="text-base text-slate-600 dark:text-slate-300">Loading…</p>
      ) : info ? (
        <DeadlineCardContent info={info} where="grid" layout="stack" onChanged={changed}
          onDone={() => { void useGridStore.getState().refreshDeadlineContext(); onClose() }}
          onOpenRecord={onClose} />
      ) : (
        <>
          <p className="text-base text-slate-600 dark:text-slate-300">Nothing due yet.</p>
          <div className="flex flex-wrap gap-2" data-testid="deadline-card-actions">
            <SecondaryButton onClick={openRecord}>Open {t('record')}</SecondaryButton>
          </div>
        </>
      )}
      {/* Last in the tab order, so focus starts on Done */}
      <IconButton label="Close" icon={<X className="w-5 h-5" />} size="compact" onClick={onClose} className="absolute top-2 right-2" />
    </div>,
    document.body,
  )
}
