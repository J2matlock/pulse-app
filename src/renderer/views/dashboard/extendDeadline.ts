import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'
import { useUndoStore } from '../../stores/undoStore'
import { formatDue } from '../../../shared/deadlineEngine'
import toast from 'react-hot-toast'
import { friendlyError } from '../../utils/friendlyError'

/** Extend a deadline (new date + reason), as one undo step. Returns whether it worked. */
export async function extendDeadline(rowId: number, columnId: number, label: string, newDue: string, reason: string, onChanged?: () => Promise<void> | void): Promise<boolean> {
  const res = await safeInvoke<{ id: number; sysLogId: number }>(IPC.DEADLINE_EXTEND, rowId, columnId, newDue, reason)
  if (!res.ok) { toast.error(friendlyError(res.error)); return false }
  const { id, sysLogId } = res.data
  useUndoStore.getState().pushWithToast({
    id: crypto.randomUUID(),
    description: `Extended "${label}" to ${formatDue(newDue)}`,
    timestamp: Date.now(),
    category: 'logged',
    icon: 'calendar-plus',
    sideEffects: [{ type: 'void_case_log', caseLogId: sysLogId }],
    undo: async () => { await safeInvoke(IPC.DEADLINE_EXTENSION_RESTORE, id, false); await onChanged?.() },
    redo: async () => { await safeInvoke(IPC.DEADLINE_EXTENSION_RESTORE, id, true); await onChanged?.() },
  })
  await onChanged?.()
  return true
}

/** Remove an extension, as one undo step. */
export async function removeExtension(extensionId: number, label: string, onChanged?: () => Promise<void> | void): Promise<boolean> {
  const res = await safeInvoke<{ rowId: number; sysLogId: number }>(IPC.DEADLINE_EXTENSION_REVOKE, extensionId)
  if (!res.ok) { toast.error(friendlyError(res.error)); return false }
  useUndoStore.getState().pushWithToast({
    id: crypto.randomUUID(),
    description: `Removed the extension on "${label}"`,
    timestamp: Date.now(),
    category: 'logged',
    icon: 'calendar-x',
    sideEffects: [{ type: 'void_case_log', caseLogId: res.data.sysLogId }],
    undo: async () => { await safeInvoke(IPC.DEADLINE_EXTENSION_RESTORE, extensionId, true); await onChanged?.() },
    redo: async () => { await safeInvoke(IPC.DEADLINE_EXTENSION_RESTORE, extensionId, false); await onChanged?.() },
  })
  await onChanged?.()
  return true
}
