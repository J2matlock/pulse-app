/**
 * Escape in a cell still cancels, but the typing it threw away can be put
 * back (persona study D5: "Karl & Jean Bergstrom" was gone, and Undo had
 * nothing). The step's Undo puts the typing back, so the Undo toast, Ctrl+Z
 * and the history panel all reach it; Redo puts the stored value back.
 */
import { useGridStore } from '../stores/gridStore'
import { useUndoStore } from '../stores/undoStore'
import { getClientName } from './clientName'

const PREVIEW_CHARS = 40

/** 'Not saved in Parents: "Karl & Jean Bergstrom"', the typing cut to 40 characters */
export function discardedDescription(columnName: string, typed: string): string {
  const oneLine = typed.replace(/\s+/g, ' ').trim()
  const preview = oneLine.length > PREVIEW_CHARS ? `${oneLine.slice(0, PREVIEW_CHARS).trimEnd()}…` : oneLine
  return `Not saved in ${columnName}: "${preview}"`
}

export function pushDiscardedTyping({ rowId, columnId, columnName, typed, previous, recordName }: {
  rowId: number
  columnId: number
  columnName: string
  typed: string
  /** What the cell holds (Redo puts it back) */
  previous: string | null
  /** For a record that isn't in the open list (the record page of an archived one) */
  recordName?: string
}): void {
  const { rows, columns } = useGridStore.getState()
  const row = rows.find(r => r.row_id === rowId)
  const contextLabel = row ? getClientName(row, columns) : recordName
  const put = (value: string | null) => useGridStore.getState().updateCell(rowId, columnId, value, { fromUndo: true, columnName, recordName: contextLabel })
  useUndoStore.getState().pushWithToast({
    id: crypto.randomUUID(),
    description: discardedDescription(columnName, typed),
    timestamp: Date.now(),
    category: 'silent',
    icon: 'pencil',
    contextLabel,
    contextId: rowId,
    undo: async () => { await put(typed) },
    redo: async () => { await put(previous) },
  })
}
