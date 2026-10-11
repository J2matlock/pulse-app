/**
 * useGridEditing — manages cell editing state for DataGrid.
 * Handles entering/exiting edit mode and saving cell values.
 * Extracted from DataGrid for reuse and testability.
 */
import { useState, useCallback, useRef, useMemo } from 'react'

export type CellCoord = { rowId: number; columnId: number }

export type CellUpdateFn = (rowId: number, columnId: number, value: string) => unknown

interface UseGridEditingOptions {
  /** Called when a cell value is saved (e.g. gridStore.updateCell). */
  onCellUpdate: CellUpdateFn
}

interface UseGridEditingReturn {
  /** The cell currently being edited, or null. */
  editingCell: CellCoord | null
  /** Stable ref that always reflects the latest editingCell (for use in callbacks). */
  editingCellRef: React.RefObject<CellCoord | null>
  /** Enter edit mode for a specific cell. */
  startEditing: (rowId: number, columnId: number) => void
  /** Exit edit mode without saving. */
  stopEditing: () => void
  /**
   * Save a new value for the given cell and exit edit mode.
   * Only clears editing state if the saved cell is still the active editing cell
   * (guards against race conditions when the user clicks another cell during async save).
   */
  handleCellSave: (rowId: number, columnId: number, value: string) => Promise<void>
  /** Convenience setter matching the raw DataGrid pattern (accepts CellCoord | null). */
  setEditingCell: (coord: CellCoord | null) => void
  /** Whether any cell is currently in edit mode. */
  isEditing: boolean
}

export function useGridEditing({ onCellUpdate }: UseGridEditingOptions): UseGridEditingReturn {
  const [editingCell, setEditingCellRaw] = useState<CellCoord | null>(null)

  const editingCellRef = useRef<CellCoord | null>(null)
  editingCellRef.current = editingCell

  const setEditingCell = useCallback((c: CellCoord | null) => {
    setEditingCellRaw(c)
  }, [])

  const startEditing = useCallback((rowId: number, columnId: number) => {
    setEditingCellRaw({ rowId, columnId })
  }, [])

  const stopEditing = useCallback(() => {
    setEditingCellRaw(null)
  }, [])

  const handleCellSave = useCallback(async (rowId: number, columnId: number, value: string) => {
    await onCellUpdate(rowId, columnId, value)
    // Only clear editing state if this cell is still the active one
    const cur = editingCellRef.current
    if (cur && cur.rowId === rowId && cur.columnId === columnId) {
      setEditingCellRaw(null)
    }
  }, [onCellUpdate])

  const isEditing = editingCell !== null

  return useMemo(() => ({
    editingCell,
    editingCellRef,
    startEditing,
    stopEditing,
    handleCellSave,
    setEditingCell,
    isEditing,
  }), [editingCell, startEditing, stopEditing, handleCellSave, setEditingCell, isEditing])
}
