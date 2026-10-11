/**
 * useGridSelection — manages row selection state for DataGrid.
 * Handles single click, Ctrl+click, Shift+click, select-all, and clear.
 * Selection state lives in gridStore so other components (e.g. GridStatusFooter) can read it.
 */
import { useCallback, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useGridStore } from '../stores/gridStore'

interface UseGridSelectionOptions {
  /** Ref to the current visual row IDs (post-sort, post-filter, post-group order) */
  visualRowIdsRef: React.RefObject<number[]>
  /** Active grid ID — selection is cleared on grid switch */
  activeGridId: number | null
}

export function useGridSelection({ visualRowIdsRef }: UseGridSelectionOptions) {
  const { selectedRowIds, setSelectedRowIds } = useGridStore(useShallow(s => ({
    selectedRowIds: s.selectedRowIds,
    setSelectedRowIds: s.setSelectedRowIds,
  })))
  const selectedRowIdsRef = useRef<Set<number>>(new Set())
  selectedRowIdsRef.current = selectedRowIds
  const lastSelectedIndexRef = useRef<number | null>(null)

  const handleToggleRowSelect = useCallback((e: React.MouseEvent, rowId: number) => {
    e.stopPropagation()
    const vIds = visualRowIdsRef.current
    const idx = vIds.indexOf(rowId)
    const lastIdx = lastSelectedIndexRef.current

    if (e.shiftKey && lastIdx !== null) {
      const from = Math.min(lastIdx, idx)
      const to = Math.max(lastIdx, idx)
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
    lastSelectedIndexRef.current = idx
  }, [visualRowIdsRef, setSelectedRowIds])

  return {
    selectedRowIds,
    setSelectedRowIds,
    selectedRowIdsRef,
    lastSelectedIndexRef,
    handleToggleRowSelect,
  }
}
