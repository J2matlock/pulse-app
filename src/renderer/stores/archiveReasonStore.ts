/**
 * "Add a reason…" after archiving (Q4). Archive happens at once with an Undo
 * toast; the toast's second button opens ArchiveReasonDialog (mounted once,
 * next to the Undo toast) through this store. The reason is saved as a note of
 * its own (ROW_ARCHIVE_REASON), and the archive's undo step learns the reason
 * and the note ids through `step`, so Undo voids the notes and Redo archives
 * with the reason.
 */
import { create } from 'zustand'
import { IPC } from '../../shared/ipc-channels'
import { storeInvoke } from '../utils/safeInvoke'
import { rlog } from '../utils/rendererLogger'
import type { ToastAction } from './undoStore'

/** What an archive step knows about a reason added afterwards */
export interface ArchiveReasonState {
  reason?: string
  noteIds: number[]
}

export interface ArchiveReasonRequest {
  rowIds: number[]
  /** Whose reason: a name, or "3 clients" */
  label: string
  step: ArchiveReasonState
}

interface ArchiveReasonStore {
  request: ArchiveReasonRequest | null
}

export const useArchiveReasonStore = create<ArchiveReasonStore>(() => ({ request: null }))

export function closeArchiveReason(): void {
  useArchiveReasonStore.setState({ request: null })
}

/** The toast button that asks for the reason */
export function archiveReasonAction(rowIds: number[], label: string, step: ArchiveReasonState): ToastAction {
  return { label: 'Add a reason…', run: () => useArchiveReasonStore.setState({ request: { rowIds, label, step } }) }
}

/** Undoing the archive voids the reason notes added afterwards (the redo archives with the reason) */
export async function voidReasonNotes(step: ArchiveReasonState): Promise<void> {
  for (const id of step.noteIds) {
    try { await storeInvoke(IPC.CASE_LOG_VOID, id, 'Undone action') } catch (err) { rlog.warn('ArchiveReason', 'Could not void a reason note', err) }
  }
  step.noteIds = []
}
