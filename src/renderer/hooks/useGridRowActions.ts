import { useCallback, useState } from 'react'
import { useGridStore } from '../stores/gridStore'
import type { GridState } from '../stores/gridStore'

interface UseGridRowActionsOptions {
  /** Closes the right-click menu the action was picked from */
  setContextMenu: (menu: null) => void
  archiveRow: GridState['archiveRow']
  unarchiveRow: GridState['unarchiveRow']
  duplicateRow: GridState['duplicateRow']
  updateRow: GridState['updateRow']
}

/** A record's own actions from the grid (star, duplicate, archive, delete, move) and the dialogs they open */
export function useGridRowActions({ setContextMenu, archiveRow, unarchiveRow, duplicateRow, updateRow }: UseGridRowActionsOptions) {
  const [archiveTarget, setArchiveTarget] = useState<number | null>(null)
  const [archiveReason, setArchiveReason] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null)
  const [moveToGridTarget, setMoveToGridTarget] = useState<number | null>(null)

  const handleDeleteRow = useCallback((rowId: number) => {
    setContextMenu(null)
    setDeleteTarget(rowId)
  }, [setContextMenu])

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

  const handleArchiveConfirm = useCallback(async (opts: { cancelAppointments: boolean }) => {
    if (archiveTarget == null) return
    await archiveRow(archiveTarget, archiveReason.trim() || undefined, opts)
    setArchiveTarget(null)
    setArchiveReason('')
  }, [archiveTarget, archiveReason, archiveRow])

  const handleUnarchiveRow = useCallback(async (rowId: number) => {
    setContextMenu(null)
    await unarchiveRow(rowId)
  }, [unarchiveRow, setContextMenu])

  return {
    archiveTarget, setArchiveTarget, archiveReason, setArchiveReason,
    deleteTarget, setDeleteTarget, moveToGridTarget, setMoveToGridTarget,
    handleDeleteRow, handleToggleStar, handleToggleStarProp, handleDuplicateRow, handleArchiveConfirm, handleUnarchiveRow,
  }
}
