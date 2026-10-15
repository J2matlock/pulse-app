import { useCallback, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { useGridStore } from '../stores/gridStore'
import type { GridState } from '../stores/gridStore'

interface UseGridRowActionsOptions {
  /** Closes the right-click menu the action was picked from */
  setContextMenu: (menu: null) => void
  archiveRow: GridState['archiveRow']
  unarchiveRow: GridState['unarchiveRow']
  duplicateRow: GridState['duplicateRow']
  updateRow: GridState['updateRow']
  deleteRow: GridState['deleteRow']
  setSelectedRowIds: Dispatch<SetStateAction<Set<number>>>
}

/**
 * A record's own actions from the grid (star, duplicate, archive, delete, move).
 * Trash and Archive happen at once with an Undo toast, no "Are you sure?" (Q4);
 * a reason for archiving can be added from the toast.
 */
export function useGridRowActions({ setContextMenu, archiveRow, unarchiveRow, duplicateRow, updateRow, deleteRow, setSelectedRowIds }: UseGridRowActionsOptions) {
  const [moveToGridTarget, setMoveToGridTarget] = useState<number | null>(null)

  const deselect = useCallback((rowId: number) => {
    setSelectedRowIds(prev => {
      if (!prev.has(rowId)) return prev
      const next = new Set(prev)
      next.delete(rowId)
      return next
    })
  }, [setSelectedRowIds])

  const handleDeleteRow = useCallback(async (rowId: number) => {
    setContextMenu(null)
    await deleteRow(rowId)
    deselect(rowId)
  }, [setContextMenu, deleteRow, deselect])

  const handleToggleStar = useCallback(async (rowId: number) => {
    const row = useGridStore.getState().rows.find(r => r.row_id === rowId)
    if (!row) return
    await updateRow(rowId, { is_starred: row.is_starred ? 0 : 1 })
  }, [updateRow])

  const handleToggleStarProp = useCallback((rowId: number) => { void handleToggleStar(rowId) }, [handleToggleStar])

  const handleDuplicateRow = useCallback(async (rowId: number) => {
    setContextMenu(null)
    await duplicateRow(rowId)
  }, [duplicateRow, setContextMenu])

  /** Its upcoming appointments are cancelled with it, as the old dialog did by default; Undo brings both back */
  const handleArchiveRow = useCallback(async (rowId: number) => {
    setContextMenu(null)
    await archiveRow(rowId, undefined, { cancelAppointments: true })
    deselect(rowId)
  }, [archiveRow, setContextMenu, deselect])

  const handleUnarchiveRow = useCallback(async (rowId: number) => {
    setContextMenu(null)
    await unarchiveRow(rowId)
  }, [unarchiveRow, setContextMenu])

  return {
    moveToGridTarget, setMoveToGridTarget,
    handleDeleteRow, handleToggleStar, handleToggleStarProp, handleDuplicateRow, handleArchiveRow, handleUnarchiveRow,
  }
}
