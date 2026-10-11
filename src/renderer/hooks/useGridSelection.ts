/**
 * useGridSelection — manages row selection state for DataGrid.
 * Handles single click, Ctrl+click, Shift+click, select-all, and clear.
 * Selection state lives in gridStore so other components (e.g. GridStatusFooter) can read it.
 */
import { useCallback, useEffect, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useGridStore } from '../stores/gridStore'

interface UseGridSelectionOptions {
  /** Ref to the current visual row IDs (post-sort, post-filter, post-group order) */
  visualRowIdsRef: React.RefObject<number[]>
  /** Active grid ID — the Shift+click starting point is forgotten on grid switch */
  activeGridId: number | null
}

export function useGridSelection({ visualRowIdsRef, activeGridId }: UseGridSelectionOptions) {
  const { selectedRowIds, setSelectedRowIds } = useGridStore(useShallow(s => ({
    selectedRowIds: s.selectedRowIds,
    setSelectedRowIds: s.setSelectedRowIds,
  })))
  const selectedRowIdsRef = useRef<Set<number>>(new Set())
  selectedRowIdsRef.current = selectedRowIds
  // Shift+click ranges start at the last clicked record, wherever a sort or filter
  // has moved it since, not at whatever now sits in its old place (AUDIT-131)
  const anchorRowIdRef = useRef<number | null>(null)

  useEffect(() => { anchorRowIdRef.current = null }, [activeGridId])

  const handleToggleRowSelect = useCallback((e: React.MouseEvent, rowId: number) => {
    e.stopPropagation()
    const vIds = visualRowIdsRef.current
    const idx = vIds.indexOf(rowId)
    const anchorIdx = anchorRowIdRef.current !== null ? vIds.indexOf(anchorRowIdRef.current) : -1

    if (e.shiftKey && anchorIdx !== -1 && idx !== -1) {
      const from = Math.min(anchorIdx, idx)
      const to = Math.max(anchorIdx, idx)
      setSelectedRowIds(prev => {
        const next = new Set(prev)
        for (let i = from; i <= to; i++) {
          next.add(vIds[i]!)
        }
        return next
      })
    } else {
      // A checkbox: a click ticks or unticks just this row, like everywhere else (G-06)
      setSelectedRowIds(prev => {
        const next = new Set(prev)
        if (next.has(rowId)) next.delete(rowId)
        else next.add(rowId)
        return next
      })
    }
    anchorRowIdRef.current = rowId
  }, [visualRowIdsRef, setSelectedRowIds])

  return {
    selectedRowIds,
    setSelectedRowIds,
    selectedRowIdsRef,
    anchorRowIdRef,
    handleToggleRowSelect,
  }
}
