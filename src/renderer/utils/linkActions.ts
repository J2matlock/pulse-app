/**
 * Linking and unlinking records (W04 §7.2), each as one undo step. A link
 * that replaced another (many-to-one) puts the old one back on undo.
 */
import toast from 'react-hot-toast'
import { IPC } from '../../shared/ipc-channels'
import type { LinkChange, LinkDirection, LinkRef } from '../../shared/links'
import { safeInvoke } from './safeInvoke'
import { useUndoStore } from '../stores/undoStore'

const ends = (direction: LinkDirection, rowId: number, otherId: number): [number, number] =>
  direction === 'forward' ? [rowId, otherId] : [otherId, rowId]

const add = (r: LinkRef) => safeInvoke<LinkChange>(IPC.RECORD_LINK_ADD, r.typeId, r.fromRowId, r.toRowId)
const remove = (r: LinkRef) => safeInvoke<LinkChange>(IPC.RECORD_LINK_REMOVE, r.typeId, r.fromRowId, r.toRowId)

function push(description: string, sysLogIds: number[], undo: () => Promise<void>, redo: () => Promise<void>): void {
  useUndoStore.getState().pushWithToast({
    id: crypto.randomUUID(),
    description,
    timestamp: Date.now(),
    category: sysLogIds.length ? 'logged' : 'silent',
    icon: 'link',
    sideEffects: sysLogIds.map(caseLogId => ({ type: 'void_case_log' as const, caseLogId })),
    undo,
    redo,
  })
}

/** Link this record to another. Returns whether anything changed. */
export async function linkRecords(typeId: number, direction: LinkDirection, rowId: number, otherId: number, otherName: string): Promise<boolean> {
  const [fromRowId, toRowId] = ends(direction, rowId, otherId)
  const res = await add({ typeId, fromRowId, toRowId })
  if (!res.ok) { toast.error(res.error); return false }
  const change = res.data
  if (!change.added) return false
  const added = change.added
  push(`Linked ${otherName}`, change.sysLogIds,
    async () => { await remove(added); for (const r of change.removed) await add(r) },
    async () => { await add(added) })
  return true
}

/** Unlink this record from another. Returns whether anything changed. */
export async function unlinkRecords(typeId: number, direction: LinkDirection, rowId: number, otherId: number, otherName: string): Promise<boolean> {
  const [fromRowId, toRowId] = ends(direction, rowId, otherId)
  const ref = { typeId, fromRowId, toRowId }
  const res = await remove(ref)
  if (!res.ok) { toast.error(res.error); return false }
  if (res.data.removed.length === 0) return false
  push(`Unlinked ${otherName}`, res.data.sysLogIds, async () => { await add(ref) }, async () => { await remove(ref) })
  return true
}

/** "New Customer…": add a record to the other list with this name and link it. */
export async function createAndLink(typeId: number, direction: LinkDirection, rowId: number, name: string): Promise<number | null> {
  const res = await safeInvoke<{ rowId: number; change: LinkChange }>(IPC.RECORD_LINK_CREATE, typeId, direction, rowId, name)
  if (!res.ok) { toast.error(res.error); return null }
  let createdId = res.data.rowId
  push(`Added and linked ${name.trim()}`, res.data.change.sysLogIds,
    async () => {
      // Brand-new records go away completely; an older one (redo long ago) goes to the trash
      const hard = await safeInvoke(IPC.ROW_HARD_DELETE, createdId)
      if (!hard.ok) await safeInvoke(IPC.ROW_DELETE, createdId)
    },
    async () => {
      const again = await safeInvoke<{ rowId: number; change: LinkChange }>(IPC.RECORD_LINK_CREATE, typeId, direction, rowId, name)
      if (again.ok) createdId = again.data.rowId
    })
  return createdId
}
