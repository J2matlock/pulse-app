import { useState, useCallback, useRef } from 'react'
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

interface UseGridCellNavigationOptions {
  /** Visible columns in display order */
  columns: Column[]
  /** Ref to an array of row IDs in current visual (filtered/sorted) order */
  visualRowIdsRef: React.RefObject<number[]>
  /** Ref to the scrollable container element for scroll-into-view */
  containerRef: React.RefObject<HTMLDivElement | null>
}

interface UseGridCellNavigationReturn {
  /** Currently focused (selected) cell, or null */
  selectedCell: CellCoord | null
  /** Set the focused cell directly */
  selectCell: (rowId: number, columnId: number) => void
  /** Clear the focused cell */
  clearSelection: () => void
  /**
   * Move the selection from (rowId, columnId) in the given direction.
   * Wraps between rows for next-col/prev-col. Clamps at grid boundaries.
   */
  navigateCell: (rowId: number, columnId: number, direction: NavDirection) => void
  /**
   * Handle a keyboard event for pure navigation keys (Arrow, Tab, Home, End).
   * Returns true if the event was handled (caller should preventDefault).
   * Does NOT handle editing, clipboard, or selection — only movement.
   */
  handleNavigationKey: (e: React.KeyboardEvent, rowId: number, columnId: number) => boolean
}

/**
 * Encapsulates grid cell navigation: focused cell state, directional
 * movement, Tab/Shift-Tab wrapping, Home/End, and scroll-into-view.
 */
export function useGridCellNavigation({
  columns,
  visualRowIdsRef,
  containerRef,
}: UseGridCellNavigationOptions): UseGridCellNavigationReturn {
  const [selectedCell, setSelectedCell] = useState<CellCoord | null>(null)
  const navTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const selectCell = useCallback((rowId: number, columnId: number) => {
    setSelectedCell({ rowId, columnId })
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedCell(null)
  }, [])

  const navigateCell = useCallback((
    rowId: number,
    columnId: number,
    direction: NavDirection,
  ) => {
    const vIds = visualRowIdsRef.current
    const currentColIdx = columns.findIndex(c => c.id === columnId)
    const currentRowIdx = vIds.indexOf(rowId)
    let newColIdx = currentColIdx
    let newRowIdx = currentRowIdx

    switch (direction) {
      case 'next-col':
        if (currentColIdx < columns.length - 1) newColIdx++
        else { newColIdx = 0; newRowIdx++ }
        break
      case 'prev-col':
        if (currentColIdx > 0) newColIdx--
        else { newColIdx = columns.length - 1; newRowIdx-- }
        break
      case 'next-row': newRowIdx++; break
      case 'prev-row': newRowIdx--; break
      case 'first-col': newColIdx = 0; break
      case 'last-col': newColIdx = columns.length - 1; break
    }

    if (newRowIdx < 0 || newRowIdx >= vIds.length) return
    if (newColIdx < 0 || newColIdx >= columns.length) return

    const newRowId = vIds[newRowIdx]!
    const newColId = columns[newColIdx]!.id
    setSelectedCell({ rowId: newRowId, columnId: newColId })

    // Scroll the target cell into view on the next tick (after React render)
    if (navTimeoutRef.current) clearTimeout(navTimeoutRef.current)
    navTimeoutRef.current = setTimeout(() => {
      navTimeoutRef.current = null
      const el = containerRef.current?.querySelector<HTMLElement>(
        `[data-row-id="${newRowId}"][data-col-id="${newColId}"]`
      )
      el?.focus()
      el?.scrollIntoView({ block: 'nearest' })
    }, 0)
  }, [columns, visualRowIdsRef, containerRef])

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
        navigateCell(rowId, columnId, 'next-col')
        return true
      case 'ArrowLeft':
        navigateCell(rowId, columnId, 'prev-col')
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
    handleNavigationKey,
  }
}
