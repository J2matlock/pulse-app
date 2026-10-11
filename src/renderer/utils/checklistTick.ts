/**
 * Ticking a checklist item off from outside its record page (Tasks, Focus mode,
 * Dashboard), with the same undo step the record page's checklist pushes:
 * - a repeating item that main moved on to its next due date goes back to the old one
 * - undo and redo are silent, so main neither writes a "Reopened" note nor repeats again
 * - the "Completed" note is voided on undo and restored on redo
 */
import toast from 'react-hot-toast'
import { IPC } from '../../shared/ipc-channels'
import type { ChecklistItem } from '../../shared/types'
import { safeInvoke, mustInvoke } from './safeInvoke'
import { useUndoStore } from '../stores/undoStore'
import { pulseEvents } from '../events'

interface TickResult {
  sysLogId: number | null
  repeat?: { previousDue: string | null; nextDue: string } | null
}

export async function tickChecklistItem(
  item: { id: number; title: string; client_name?: string | null; row_id?: number | null },
  hooks: { onUndo?: () => void; onRedo?: () => void } = {},
): Promise<boolean> {
  const completedAt = new Date().toISOString()
  const res = await safeInvoke<TickResult>(IPC.CHECKLIST_UPDATE_ITEM, item.id, { is_completed: 1, completed_at: completedAt })
  if (!res.ok) {
    toast.error(`We couldn't tick off "${item.title}" — try again`)
    return false
  }
  const sysLogId = res.data?.sysLogId ?? null
  const repeat = res.data?.repeat ?? null
  const before: Partial<ChecklistItem> = { is_completed: 0, completed_at: null, ...(repeat ? { due_date: repeat.previousDue } : {}) }
  const after: Partial<ChecklistItem> = repeat
    ? { is_completed: 0, completed_at: null, completed_by: null, due_date: repeat.nextDue }
    : { is_completed: 1, completed_at: completedAt }
  const nextText = repeat ? ` · next due ${new Date(`${repeat.nextDue}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''
  const changed = () => {
    pulseEvents.emit('urgentchecklist:changed')
    if (item.row_id != null) pulseEvents.emit('checklist:changed', { rowId: item.row_id })
  }
  useUndoStore.getState().pushWithToast({
    id: crypto.randomUUID(),
    description: `Completed "${item.title}"${nextText}`,
    timestamp: Date.now(),
    category: sysLogId != null ? 'logged' : 'silent',
    icon: 'check-square',
    contextLabel: item.client_name ?? undefined,
    contextId: item.row_id ?? undefined,
    sideEffects: sysLogId != null ? [{ type: 'void_case_log', caseLogId: sysLogId }] : undefined,
    undo: async () => {
      await mustInvoke(IPC.CHECKLIST_UPDATE_ITEM, item.id, before, { silent: true })
      hooks.onUndo?.()
      changed()
    },
    redo: async () => {
      await mustInvoke(IPC.CHECKLIST_UPDATE_ITEM, item.id, after, { silent: true })
      hooks.onRedo?.()
      changed()
    },
  })
  return true
}
