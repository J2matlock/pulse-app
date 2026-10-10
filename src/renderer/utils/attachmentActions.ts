/** Attachment actions from the window (W09): add (dialog or dropped files), delete with undo. */
import toast from 'react-hot-toast'
import { IPC } from '../../shared/ipc-channels'
import type { Attachment } from '../../shared/attachments'
import { safeInvoke, mustInvoke } from './safeInvoke'
import { useUndoStore } from '../stores/undoStore'

interface AddResult { added: Attachment[]; duplicates: unknown[] }

function addedToast(n: number) { if (n) toast.success(n === 1 ? 'Added 1 file' : `Added ${n} files`) }

export async function addFilesWithDialog(rowId: number, opts: { caseLogId?: number } = {}): Promise<Attachment[]> {
  const res = await safeInvoke<AddResult>(IPC.ATTACHMENT_ADD, rowId, opts)
  if (!res.ok) { toast.error(res.error); return [] }
  addedToast(res.data.added.length)
  return res.data.added
}

export async function addDroppedFiles(rowId: number, files: FileList | File[], opts: { caseLogId?: number } = {}): Promise<Attachment[]> {
  const paths = Array.from(files).map(f => window.api.pathForFile?.(f) ?? '').filter(Boolean)
  if (paths.length === 0) { toast.error("Those files couldn't be read. Try “Add files…” instead."); return [] }
  const res = await safeInvoke<AddResult>(IPC.ATTACHMENT_ADD_PATHS, rowId, paths, opts)
  if (!res.ok) { toast.error(res.error); return [] }
  addedToast(res.data.added.length)
  return res.data.added
}

export async function deleteAttachment(a: Attachment): Promise<boolean> {
  const res = await safeInvoke(IPC.ATTACHMENT_DELETE, a.id)
  if (!res.ok) { toast.error(res.error); return false }
  useUndoStore.getState().pushWithToast({
    id: crypto.randomUUID(), timestamp: Date.now(), category: 'silent', icon: 'paperclip',
    description: `Moved "${a.file_name}" to the trash`,
    undo: async () => { await mustInvoke(IPC.ATTACHMENT_RESTORE, a.id) },
    redo: async () => { await mustInvoke(IPC.ATTACHMENT_DELETE, a.id) },
  })
  return true
}

export async function openAttachment(a: Attachment): Promise<void> {
  const res = await safeInvoke(IPC.ATTACHMENT_OPEN, a.id)
  if (!res.ok) toast.error(res.error)
}

export async function saveAttachmentCopy(a: Attachment): Promise<void> {
  const res = await safeInvoke<string | null>(IPC.ATTACHMENT_SAVE_AS, a.id)
  if (!res.ok) toast.error(res.error)
  else if (res.data) toast.success('Saved a copy. It isn’t encrypted, so keep it somewhere safe.')
}
