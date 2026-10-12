import { useEffect, useRef, useState } from 'react'
import type { Column } from '../../shared/types'
import { useVocab } from './useVocab'

/** What the grid's live region says: the cell editor opening and closing, and the selection count */
export function useGridAnnouncer(
  editingCell: { rowId: number; columnId: number } | null,
  columnMap: Map<number, Column>,
  selectedRowIds: Set<number>,
): string {
  const { t } = useVocab()
  // Said out loud for screen readers: entering and leaving a cell's editor (AUDIT-043)
  const [announcement, setAnnouncement] = useState('')
  const announcedEditRef = useRef<{ rowId: number; columnId: number } | null>(null)
  useEffect(() => {
    const prev = announcedEditRef.current
    if (prev?.rowId === editingCell?.rowId && prev?.columnId === editingCell?.columnId) return
    announcedEditRef.current = editingCell
    const name = (id: number) => columnMap.get(id)?.name
    if (editingCell) setAnnouncement(`Editing ${name(editingCell.columnId) ?? 'cell'}`)
    else if (prev) setAnnouncement(`Done editing ${name(prev.columnId) ?? 'cell'}`)
  }, [editingCell, columnMap])
  // ...and how many records are picked for bulk actions, after Shift+Space, Ctrl+A or a click (AUDIT-057)
  const announcedSelectedRef = useRef(selectedRowIds.size)
  useEffect(() => {
    const n = selectedRowIds.size
    if (announcedSelectedRef.current === n) return
    announcedSelectedRef.current = n
    setAnnouncement(n === 0 ? 'Nothing selected' : `${n} ${t('record', { count: n })} selected`)
  }, [selectedRowIds, t])
  return announcement
}
