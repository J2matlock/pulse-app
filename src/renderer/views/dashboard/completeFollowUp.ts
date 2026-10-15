/**
 * Mark a note's follow-up done, as one undo step (the dashboard row and the
 * Calendar's panel both use it, UX D-08). Returns whether main agreed.
 */
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke, mustInvoke } from '../../utils/safeInvoke'
import { useUndoStore } from '../../stores/undoStore'
import { wordNow } from '../../utils/vocab'

export async function completeFollowUp(followUp: { id: number; client_name: string | null; grid_id: number }, onReload?: () => Promise<void>): Promise<boolean> {
  const res = await safeInvoke(IPC.CASE_LOG_COMPLETE_FOLLOWUP, followUp.id)
  if (!res.ok) return false
  const { sysLogId } = res.data
  const sideEffects = sysLogId ? [{ type: 'void_case_log' as const, caseLogId: sysLogId }] : undefined
  useUndoStore.getState().push({
    id: crypto.randomUUID(),
    description: `Completed follow-up for ${followUp.client_name ?? wordNow('record', {}, followUp.grid_id)}`,
    timestamp: Date.now(),
    category: 'logged',
    icon: 'check',
    sideEffects,
    undo: async () => {
      await mustInvoke(IPC.CASE_LOG_UNCOMPLETE_FOLLOWUP, followUp.id)
      await onReload?.()
    },
    redo: async () => {
      await mustInvoke(IPC.CASE_LOG_COMPLETE_FOLLOWUP, followUp.id)
      await onReload?.()
    },
  })
  return true
}
