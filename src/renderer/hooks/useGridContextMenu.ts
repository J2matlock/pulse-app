/**
 * useGridContextMenu — manages context menu state for DataGrid cell right-clicks.
 */
import { useState, useCallback } from 'react'

export interface GridContextMenuState {
  x: number
  y: number
  rowId: number
  colId: number
}

export function useGridContextMenu() {
  const [contextMenu, setContextMenu] = useState<GridContextMenuState | null>(null)

  const handleCellContextMenu = useCallback((e: React.MouseEvent, rowId: number, colId: number) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, rowId, colId })
  }, [])

  const closeContextMenu = useCallback(() => {
    setContextMenu(null)
  }, [])

  return {
    contextMenu,
    setContextMenu,
    handleCellContextMenu,
    closeContextMenu,
  }
}
