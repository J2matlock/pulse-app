/**
 * Moving a record to another stage (W06 §4), from the board or the table:
 * the stage's on-enter actions run in main, and everything is one undo step
 * (the stage, a filled-in date, the checklist, and the notes).
 */
import toast from 'react-hot-toast'
import { IPC } from '../../shared/ipc-channels'
import type { StageMoveResult } from '../../shared/stages'
import type { GridRow } from '../../shared/types'
import { localDateString } from '../../shared/dates'
import { safeInvoke } from './safeInvoke'
import { useUndoStore } from '../stores/undoStore'
import { useGridStore } from '../stores/gridStore'
import { getClientName } from './clientName'
import { friendlyError } from './friendlyError'

function patchRow(rowId: number, columnId: number, value: string | null, stamped: StageMoveResult['stamped']): void {
  useGridStore.setState(s => ({
    rows: s.rows.map(r => r.row_id !== rowId ? r : {
      ...r, [`col_${columnId}`]: value, ...(stamped ? { [`col_${stamped.columnId}`]: localDateString() } : {}),
    } as GridRow),
  }))
}

/** Returns whether the record moved. */
export async function moveToStage(rowId: number, columnId: number, value: string | null): Promise<boolean> {
  const res = await safeInvoke<StageMoveResult>(IPC.STAGE_MOVE, rowId, columnId, value)
  if (!res.ok) { toast.error(friendlyError(res.error)); return false }
  let result = res.data
  if (!result.changed) return false
  patchRow(rowId, columnId, value, result.stamped)
  const { rows, columns } = useGridStore.getState()
  const row = rows.find(r => r.row_id === rowId)
  const name = row ? getClientName(row, columns) : ''
  useUndoStore.getState().pushWithToast({
    id: crypto.randomUUID(),
    description: `Moved ${name ? `${name} ` : ''}to ${value ?? 'no stage'}`,
    timestamp: Date.now(),
    category: 'logged',
    icon: 'columns',
    contextLabel: name || undefined,
    contextId: rowId,
    sideEffects: result.sysLogIds.map(caseLogId => ({ type: 'void_case_log' as const, caseLogId })),
    undo: async () => {
      const grid = useGridStore.getState()
      await grid.updateCell(rowId, columnId, result.previous)
      if (result.stamped) await grid.updateCell(rowId, result.stamped.columnId, result.stamped.previous)
      for (const id of result.checklistItemIds) await safeInvoke(IPC.CHECKLIST_DELETE_ITEM, id)
    },
    redo: async () => {
      const again = await safeInvoke<StageMoveResult>(IPC.STAGE_MOVE, rowId, columnId, value)
      if (again.ok && again.data.changed) { result = again.data; patchRow(rowId, columnId, value, result.stamped) }
    },
  })
  return true
}
