import { useState, useCallback, useRef, useEffect } from 'react'
import type { Column } from '../../shared/types'

/** Coordinates identifying a single cell in the grid */
export type CellCoord = { rowId: number; columnId: number }

/** Directions for cell navigation */
export type NavDirection =
  | 'next-col'
  | 'prev-col'
  | 'next-row'
  | 'prev-row'
  | 'first-col'
  | 'last-col'

export interface NavigateOptions {
  /**
   * next-col / prev-col past the row's edge go on to the next or previous record.
   * Tab does (true, the default); the arrow keys stop at the edge (persona study, Mark:
   * Left from the first cell landed on the last cell of the record above).
   */
  wrap?: boolean
}

interface UseGridCellNavigationOptions {
  /** Visible columns in display order */
  columns: Column[]
  /** Ref to an array of row IDs in current visual (filtered/sorted) order */
  visualRowIdsRef: React.RefObject<number[]>
  /** Ref to the scrollable container element for scroll-into-view */
  containerRef: React.RefObject<HTMLDivElement | null>
  /** Brings a record that isn't drawn (scrolled out of the virtual window) on screen */
  scrollToRowIdRef?: React.RefObject<((rowId: number) => void) | null>
}

interface UseGridCellNavigationReturn {
  /** Currently focused (selected) cell, or null */
  selectedCell: CellCoord | null
  /** Set the focused cell directly */
  selectCell: (rowId: number, columnId: number) => void
  /** Clear the focused cell */
  clearSelection: () => void
  /**
   * Move the selection from (rowId, columnId) in the given direction. Returns false when
   * there's nowhere to go (the edge of the list), and nothing changes.
   */
  navigateCell: (rowId: number, columnId: number, direction: NavDirection, opts?: NavigateOptions) => boolean
  /**
   * Select this cell and give it focus once the list has drawn, found again by its record
   * and column (not where it was), so a save that re-sorts the list doesn't lose it.
   */
  focusCell: (rowId: number, columnId: number) => void
  /**
   * Handle a keyboard event for pure navigation keys (Arrow, Tab, Home, End).
   * Returns true if the event was handled (caller should preventDefault).
   * Does NOT handle editing, clipboard, or selection — only movement.
   */
  handleNavigationKey: (e: React.KeyboardEvent, rowId: number, columnId: number) => boolean
}

const cellSelector = (c: CellCoord) => `[data-row-id="${c.rowId}"][data-col-id="${c.columnId}"]`

/**
 * A cell scrolled into view can still sit under the columns kept in view on the left
 * (they're sticky), which scrollIntoView doesn't know about (persona study, Mark: the lit
 * cell slid under the frozen Name column). Scroll back by the part that's covered.
 */
export function revealPastFrozen(cell: HTMLElement, container: HTMLElement): void {
  if (cell.style.position === 'sticky') return
  const row = cell.closest('[role="row"]')
  if (!row) return
  let frozenRight = -Infinity
  for (const el of Array.from(row.children)) {
    if (el instanceof HTMLElement && el !== cell && el.style.position === 'sticky') {
      frozenRight = Math.max(frozenRight, el.getBoundingClientRect().right)
    }
  }
  if (frozenRight === -Infinity) return
  const covered = frozenRight - cell.getBoundingClientRect().left
  if (covered > 0) container.scrollLeft = Math.max(0, container.scrollLeft - covered)
}

/**
 * Encapsulates grid cell navigation: focused cell state, directional
 * movement, Tab/Shift-Tab wrapping, Home/End, and scroll-into-view.
 */
export function useGridCellNavigation({
  columns,
  visualRowIdsRef,
  containerRef,
  scrollToRowIdRef,
}: UseGridCellNavigationOptions): UseGridCellNavigationReturn {
  const [selectedCell, setSelectedCell] = useState<CellCoord | null>(null)
  const frameRef = useRef<number | null>(null)

  useEffect(() => () => { if (frameRef.current !== null) cancelAnimationFrame(frameRef.current) }, [])

  const selectCell = useCallback((rowId: number, columnId: number) => {
    setSelectedCell({ rowId, columnId })
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedCell(null)
  }, [])

  const focusCell = useCallback((rowId: number, columnId: number) => {
    const target = { rowId, columnId }
    setSelectedCell(target)
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    const idsBefore = visualRowIdsRef.current
    let waitedForRows = false
    let scrolled = false
    // After React has drawn: the next frame, or the one after when the rows changed meanwhile
    // (a save that re-sorts the list moves the record, so it's looked up again then)
    const attempt = () => {
      frameRef.current = null
      if (!waitedForRows && visualRowIdsRef.current !== idsBefore) {
        waitedForRows = true
        frameRef.current = requestAnimationFrame(attempt)
        return
      }
      const container = containerRef.current
      const el = container?.querySelector<HTMLElement>(cellSelector(target))
      if (!el) {
        // Scrolled out of the drawn window: bring it on screen, then try once more
        const scrollTo = scrollToRowIdRef?.current
        if (!scrolled && scrollTo && visualRowIdsRef.current.includes(rowId)) {
          scrolled = true
          scrollTo(rowId)
          frameRef.current = requestAnimationFrame(attempt)
        }
        return
      }
      el.focus({ preventScroll: true })
      el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
      if (container) revealPastFrozen(el, container)
    }
    frameRef.current = requestAnimationFrame(attempt)
  }, [visualRowIdsRef, containerRef, scrollToRowIdRef])

  const navigateCell = useCallback((
    rowId: number,
    columnId: number,
    direction: NavDirection,
    opts: NavigateOptions = {},
  ): boolean => {
    const wrap = opts.wrap ?? true
    const vIds = visualRowIdsRef.current
    const currentColIdx = columns.findIndex(c => c.id === columnId)
    const currentRowIdx = vIds.indexOf(rowId)
    let newColIdx = currentColIdx
    let newRowIdx = currentRowIdx

    switch (direction) {
      case 'next-col':
        if (currentColIdx < columns.length - 1) newColIdx++
        else if (wrap) { newColIdx = 0; newRowIdx++ }
        else return false
        break
      case 'prev-col':
        if (currentColIdx > 0) newColIdx--
        else if (wrap) { newColIdx = columns.length - 1; newRowIdx-- }
        else return false
        break
      case 'next-row': newRowIdx++; break
      case 'prev-row': newRowIdx--; break
      case 'first-col': newColIdx = 0; break
      case 'last-col': newColIdx = columns.length - 1; break
    }

    if (newRowIdx < 0 || newRowIdx >= vIds.length) return false
    if (newColIdx < 0 || newColIdx >= columns.length) return false

    focusCell(vIds[newRowIdx]!, columns[newColIdx]!.id)
    return true
  }, [columns, visualRowIdsRef, focusCell])

  const handleNavigationKey = useCallback((
    e: React.KeyboardEvent,
    rowId: number,
    columnId: number,
  ): boolean => {
    switch (e.key) {
      case 'Tab':
        navigateCell(rowId, columnId, e.shiftKey ? 'prev-col' : 'next-col')
        return true
      case 'ArrowRight':
        navigateCell(rowId, columnId, 'next-col', { wrap: false })
        return true
      case 'ArrowLeft':
        navigateCell(rowId, columnId, 'prev-col', { wrap: false })
        return true
      case 'ArrowDown':
        navigateCell(rowId, columnId, 'next-row')
        return true
      case 'ArrowUp':
        navigateCell(rowId, columnId, 'prev-row')
        return true
      case 'Home':
        navigateCell(rowId, columnId, 'first-col')
        return true
      case 'End':
        navigateCell(rowId, columnId, 'last-col')
        return true
      default:
        return false
    }
  }, [navigateCell])

  return {
    selectedCell,
    selectCell,
    clearSelection,
    navigateCell,
    focusCell,
    handleNavigationKey,
  }
}
