import type { Column, GridRow } from '../../../shared/types'
import { isNotTypedColumnType, storesNoCells } from '../../../shared/types'
import { formatCellForClipboard, checkPaste } from './gridHelpers'
import toast from 'react-hot-toast'
import { friendlyError } from '../../utils/friendlyError'
import { copyText } from '../../hooks/useCopyFeedback'

type CellCoord = { rowId: number; columnId: number }

export interface KeyboardNavDeps {
  /** Open the record's page */
  openRecord?: (rowId: number) => void
  editingCellRef: React.RefObject<CellCoord | null>
  rowsRef: React.RefObject<GridRow[]>
  filteredRowsRef: React.RefObject<GridRow[]>
  selectedRowIdsRef: React.RefObject<Set<number>>
  columns: Column[]
  columnMap: Map<number, Column>
  updateCell: (rowId: number, colId: number, value: string | null) => Promise<unknown>
  /** Returns false when there's nowhere to move (the first or last cell) */
  navigateCell: (
    rowId: number,
    columnId: number,
    direction: 'next-col' | 'prev-col' | 'next-row' | 'prev-row' | 'first-col' | 'last-col'
  ) => boolean | void
  setEditingCell: (c: CellCoord | null) => void
  setSelectedRowIds: React.Dispatch<React.SetStateAction<Set<number>>>
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Move focus to the next (or previous) control outside the list, as Tab would. */
export function focusOutsideGrid(from: Element, backwards: boolean): void {
  const grid = from.closest('[role="grid"]')
  if (!grid) return
  const all = Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => !grid.contains(el))
  const after = (el: HTMLElement) => (grid.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
  const candidates = backwards ? all.filter(el => !after(el)).reverse() : all.filter(after)
  // Hidden controls refuse focus, so take the first one that accepts it
  for (const el of candidates) {
    el.focus()
    if (document.activeElement === el) return
  }
}

export function handleCellKeyDown(
  e: React.KeyboardEvent,
  rowId: number,
  columnId: number,
  deps: KeyboardNavDeps
): void {
  const {
    editingCellRef, rowsRef, filteredRowsRef, selectedRowIdsRef,
    columns, columnMap, updateCell, navigateCell,
    setEditingCell, setSelectedRowIds,
  } = deps

  const editing = editingCellRef.current
  const currentRows = rowsRef.current
  const currentFilteredRows = filteredRowsRef.current
  const currentSelectedRowIds = selectedRowIdsRef.current

  switch (e.key) {
    case 'Enter':
    case 'F2': {
      // The open editor owns Enter: a notes or address box takes it as a new line,
      // the others save on it themselves (AUDIT-040)
      if (editing && editing.rowId === rowId && editing.columnId === columnId) break
      e.preventDefault()
      // Ctrl+Enter or Shift+Enter opens the record, so keyboard users can get to it (G-31)
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || e.shiftKey) && !editing && deps.openRecord) {
        deps.openRecord(rowId)
        break
      }
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
      // Ctrl+Tab always leaves the list. Tab on the last cell (Shift+Tab on
      // the first) is left to the browser, so the list never traps focus (G-32).
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        if (e.currentTarget) focusOutsideGrid(e.currentTarget as Element, e.shiftKey)
        break
      }
      const moved = navigateCell(rowId, columnId, e.shiftKey ? 'prev-col' : 'next-col')
      if (moved !== false) e.preventDefault()
      break
    }
    case 'ArrowRight':
      if (!editing) { e.preventDefault(); navigateCell(rowId, columnId, 'next-col') }
      break
    case 'ArrowLeft':
      if (!editing) {
        e.preventDefault()
        // From the first column, Left reaches the record's priority badge, if the list has one (AUDIT-045)
        const badge = columns[0]?.id === columnId && e.currentTarget instanceof HTMLElement
          ? e.currentTarget.closest('[role="row"]')?.querySelector<HTMLElement>('[data-acuity-badge]')
          : null
        if (badge) badge.focus()
        else navigateCell(rowId, columnId, 'prev-col')
      }
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
            .map(r => visibleCols.map(c => formatCellForClipboard(c, r[`col_${c.id}` as keyof GridRow] as string | null, r)).join('\t'))
          void copyText([header, ...bodyLines].join('\n'))
        } else {
          // Single-cell copy
          const row = currentRows.find(r => r.row_id === rowId)
          const col = columns.find(c => c.id === columnId)
          if (row && col) {
            const cellVal = row[`col_${columnId}` as keyof GridRow] as string | null
            const plainText = formatCellForClipboard(col, cellVal, row)
            if (e.shiftKey) {
              const labeled = `${col.name}: ${plainText}`
              void copyText(labeled)
            } else {
              void copyText(plainText)
            }
          }
        }
      }
      break
    case 'v':
    case 'V':
      if ((e.ctrlKey || e.metaKey) && !editing) {
        e.preventDefault()
        const pasteTargetRowId = rowId
        const pasteTargetColId = columnId
        const pasteTargetCol = columns.find(c => c.id === columnId)
        void (async () => {
          if (!pasteTargetCol) return
          try {
            const text = await navigator.clipboard.readText()
            if (!text) return
            const checked = checkPaste(text, pasteTargetCol)
            if ('error' in checked) toast.error(friendlyError(checked.error))
            else void updateCell(pasteTargetRowId, pasteTargetColId, checked.value)
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
      // Shift+Space (or Ctrl+Space) ticks or unticks this record for bulk actions, as in a spreadsheet (AUDIT-057)
      if (!editing && (e.shiftKey || e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        setSelectedRowIds(prev => {
          const next = new Set(prev)
          if (next.has(rowId)) next.delete(rowId)
          else next.add(rowId)
          return next
        })
        break
      }
      if (!editing) {
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
      // Deadline and worked-out cells aren't cleared by a key: only Mark done changes a deadline (G-15)
      if (!editing && !storesNoCells(columnMap.get(columnId)?.column_type ?? '') && !isNotTypedColumnType(columnMap.get(columnId)?.column_type ?? '')) {
        e.preventDefault()
        void updateCell(rowId, columnId, null)
      }
      break
    default: {
      if (!editing && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        const col = columns.find(c => c.id === columnId)
        if (col && col.column_type !== 'checkbox' && !isNotTypedColumnType(col.column_type)) {
          setEditingCell({ rowId, columnId })
        }
      }
    }
  }
}
