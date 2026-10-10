import type { Column, GridRow } from '../../../shared/types'
import { isNotTypedColumnType, storesNoCells } from '../../../shared/types'
import { formatCellForClipboard, validateForColumnType } from './gridHelpers'
import toast from 'react-hot-toast'

type CellCoord = { rowId: number; columnId: number }

export interface KeyboardNavDeps {
  editingCellRef: React.RefObject<CellCoord | null>
  /** Blocks editing from the keyboard when it holds true */
  isReadOnlyRef?: React.RefObject<boolean>
  rowsRef: React.RefObject<GridRow[]>
  filteredRowsRef: React.RefObject<GridRow[]>
  selectedRowIdsRef: React.RefObject<Set<number>>
  columns: Column[]
  columnMap: Map<number, Column>
  updateCell: (rowId: number, colId: number, value: string | null) => Promise<unknown>
  navigateCell: (
    rowId: number,
    columnId: number,
    direction: 'next-col' | 'prev-col' | 'next-row' | 'prev-row' | 'first-col' | 'last-col'
  ) => void
  setEditingCell: (c: CellCoord | null) => void
  setSelectedRowIds: React.Dispatch<React.SetStateAction<Set<number>>>
  setClipboard: React.Dispatch<React.SetStateAction<string | null>>
}

export function handleCellKeyDown(
  e: React.KeyboardEvent,
  rowId: number,
  columnId: number,
  deps: KeyboardNavDeps
): void {
  const {
    editingCellRef, isReadOnlyRef, rowsRef, filteredRowsRef, selectedRowIdsRef,
    columns, columnMap, updateCell, navigateCell,
    setEditingCell, setSelectedRowIds, setClipboard,
  } = deps

  const editing = editingCellRef.current
  const readOnly = isReadOnlyRef?.current ?? false
  const currentRows = rowsRef.current
  const currentFilteredRows = filteredRowsRef.current
  const currentSelectedRowIds = selectedRowIdsRef.current

  switch (e.key) {
    case 'Enter':
    case 'F2': {
      e.preventDefault()
      if (readOnly) break
      const col = columnMap.get(columnId)
      if (col?.column_type === 'checkbox') {
        const row = currentRows.find(r => r.row_id === rowId)
        const curVal = row?.[`col_${columnId}` as keyof GridRow] as string | null
        void updateCell(rowId, columnId, (curVal === 'true' || curVal === '1') ? 'false' : 'true')
      } else {
        setEditingCell({ rowId, columnId })
      }
      break
    }
    case 'Escape':
      if (editing) {
        setEditingCell(null)
      } else if (currentSelectedRowIds.size > 0) {
        setSelectedRowIds(new Set())
      }
      break
    case 'Tab': {
      e.preventDefault()
      navigateCell(rowId, columnId, e.shiftKey ? 'prev-col' : 'next-col')
      break
    }
    case 'ArrowRight':
      if (!editing) { e.preventDefault(); navigateCell(rowId, columnId, 'next-col') }
      break
    case 'ArrowLeft':
      if (!editing) { e.preventDefault(); navigateCell(rowId, columnId, 'prev-col') }
      break
    case 'ArrowDown':
      if (!editing) { e.preventDefault(); navigateCell(rowId, columnId, 'next-row') }
      break
    case 'ArrowUp':
      if (!editing) { e.preventDefault(); navigateCell(rowId, columnId, 'prev-row') }
      break
    case 'Home':
      if (!editing) { e.preventDefault(); navigateCell(rowId, columnId, 'first-col') }
      break
    case 'End':
      if (!editing) { e.preventDefault(); navigateCell(rowId, columnId, 'last-col') }
      break
    case 'c':
    case 'C':
      if ((e.ctrlKey || e.metaKey) && !editing) {
        e.preventDefault()
        // Multi-row copy: tab-separated with headers
        if (currentSelectedRowIds.size > 0 && !e.shiftKey) {
          const visibleCols = columns.filter(c => c.is_visible !== 0)
          const header = visibleCols.map(c => c.name).join('\t')
          const bodyLines = currentFilteredRows
            .filter(r => currentSelectedRowIds.has(r.row_id))
            .map(r => visibleCols.map(c => formatCellForClipboard(c, r[`col_${c.id}` as keyof GridRow] as string | null)).join('\t'))
          void window.api.copyToClipboard([header, ...bodyLines].join('\n'))
        } else {
          // Single-cell copy
          const row = currentRows.find(r => r.row_id === rowId)
          const col = columns.find(c => c.id === columnId)
          if (row && col) {
            const cellVal = row[`col_${columnId}` as keyof GridRow] as string | null
            const plainText = formatCellForClipboard(col, cellVal)
            if (e.shiftKey) {
              const labeled = `${col.name}: ${plainText}`
              void window.api.copyToClipboard(labeled)
            } else {
              void window.api.copyToClipboard(plainText)
            }
            setClipboard(cellVal)
          }
        }
      }
      break
    case 'v':
    case 'V':
      if ((e.ctrlKey || e.metaKey) && !editing && !readOnly) {
        e.preventDefault()
        const pasteTargetRowId = rowId
        const pasteTargetColId = columnId
        const pasteTargetCol = columns.find(c => c.id === columnId)
        void (async () => {
          if (!pasteTargetCol) return
          try {
            const text = await navigator.clipboard.readText()
            if (!text) return
            const validated = validateForColumnType(text, pasteTargetCol)
            if (validated === null) {
              toast.error('Value does not match column type — paste skipped')
            } else {
              void updateCell(pasteTargetRowId, pasteTargetColId, validated)
            }
          } catch { /* clipboard access denied */ }
        })()
      }
      break
    case 'a':
    case 'A':
      if ((e.ctrlKey || e.metaKey) && !editing) {
        e.preventDefault()
        setSelectedRowIds(new Set(currentFilteredRows.map(r => r.row_id)))
      }
      break
    case ' ': {
      if (!editing && !readOnly) {
        const col = columns.find(c => c.id === columnId)
        if (col?.column_type === 'checkbox') {
          e.preventDefault()
          const row = currentRows.find(r => r.row_id === rowId)
          const curVal = row?.[`col_${columnId}` as keyof GridRow] as string | null
          void updateCell(rowId, columnId, (curVal === 'true' || curVal === '1') ? 'false' : 'true')
        }
      }
      break
    }
    case 'Delete':
    case 'Backspace':
      if (!editing && !readOnly && !storesNoCells(columnMap.get(columnId)?.column_type ?? '')) {
        e.preventDefault()
        void updateCell(rowId, columnId, null)
      }
      break
    default: {
      if (!editing && !readOnly && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        const col = columns.find(c => c.id === columnId)
        if (col && col.column_type !== 'checkbox' && !isNotTypedColumnType(col.column_type)) {
          setEditingCell({ rowId, columnId })
        }
      }
    }
  }
}
