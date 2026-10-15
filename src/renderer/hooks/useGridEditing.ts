/**
 * useGridEditing — manages cell editing state for DataGrid.
 * Handles entering/exiting edit mode and saving cell values.
 * Extracted from DataGrid for reuse and testability.
 */
import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import { useGridStore } from '../stores/gridStore'
import { useSettingsStore } from '../stores/settingsStore'

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

/** After the tick in which focus moves on (navigation and Esc focus their cell on a 0 ms timer) */
function afterFocusMoves(fn: () => void): void {
  setTimeout(() => setTimeout(fn, 0), 0)
}

/**
 * Editing moved from `prev` to `next`. The record Add just made is removed if editing left it
 * with nothing in it: Esc on its name, Enter on an empty name, a click somewhere else
 * (persona study R3). Moving along the same record (Tab past the name) keeps it.
 */
function editingMoved(prev: CellCoord | null, next: CellCoord | null): void {
  const fresh = useGridStore.getState().freshRow
  if (!fresh) return
  const onFresh = next?.rowId === fresh.rowId
  if (fresh.editing !== onFresh) useGridStore.setState({ freshRow: { ...fresh, editing: onFresh } })
  if (!prev || prev.rowId !== fresh.rowId || onFresh) return
  afterFocusMoves(() => {
    const active = document.activeElement
    const cell = active instanceof HTMLElement ? active.closest('[data-row-id][data-col-id]') : null
    if (cell && Number(cell.getAttribute('data-row-id')) === prev.rowId && Number(cell.getAttribute('data-col-id')) !== prev.columnId) return
    void useGridStore.getState().discardIfUntouched(prev.rowId)
  })
}

export function useGridEditing({ onCellUpdate }: UseGridEditingOptions): UseGridEditingReturn {
  const [editingCell, setEditingCellRaw] = useState<CellCoord | null>(null)

  const editingCellRef = useRef<CellCoord | null>(null)
  editingCellRef.current = editingCell

  /** Every change of the open cell goes through here, so a record left empty is noticed */
  const moveEditing = useCallback((c: CellCoord | null) => {
    editingMoved(editingCellRef.current, c)
    editingCellRef.current = c
    setEditingCellRaw(c)
  }, [])

  const setEditingCell = useCallback((c: CellCoord | null) => {
    moveEditing(c)
  }, [moveEditing])

  const startEditing = useCallback((rowId: number, columnId: number) => {
    moveEditing({ rowId, columnId })
  }, [moveEditing])

  const stopEditing = useCallback(() => {
    moveEditing(null)
  }, [moveEditing])

  const handleCellSave = useCallback(async (rowId: number, columnId: number, value: string) => {
    await onCellUpdate(rowId, columnId, value)
    // Only clear editing state if this cell is still the active one
    const cur = editingCellRef.current
    if (cur && cur.rowId === rowId && cur.columnId === columnId) {
      moveEditing(null)
    }
  }, [onCellUpdate, moveEditing])

  // The grid closes (another page, the record page, a lock): a record Add just made and left
  // empty goes, unless its own page opened or the database is locking (the reload after unlock does it)
  useEffect(() => () => {
    const fresh = useGridStore.getState().freshRow
    if (!fresh) return
    if (fresh.editing) useGridStore.setState({ freshRow: { ...fresh, editing: false } })
    afterFocusMoves(() => {
      if (useSettingsStore.getState().isLocked) return
      void useGridStore.getState().discardIfUntouched(fresh.rowId)
    })
  }, [])

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
