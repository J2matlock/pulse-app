/**
 * ipc-attachments.ts — files kept inside the database (generalization W09 §6).
 * Main shows the open dialog itself, so the window never chooses paths;
 * dropped files' paths are checked like any other.
 */
import { BrowserWindow, dialog } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import { formatBytes } from '../../shared/attachments'
import { parseDbTimestamp } from '../../shared/dates'
import { secureWrap, ok, fail, enforceWritable, validId, assertSafePath, notifyCaseLogChanged } from './ipc-utils'
import {
  AttachmentError, addAttachments, listAttachments, describeAttachment, deleteAttachment, restoreAttachment, attachmentUsage, purgeDeletedAttachments, getAttachment,
  trashedAttachments, purgeAttachment,
  type AddResult,
} from '../attachments'
import { openAttachment, saveAttachmentCopy, previewAttachment } from '../attachment-files'

function action<T>(fn: () => T) {
  try { return ok(fn()) } catch (err) {
    if (err instanceof AttachmentError) return fail(err.message)
    throw err
  }
}

function announce(rowId: number | null): void {
  BrowserWindow.getAllWindows().forEach(w => { if (!w.isDestroyed()) w.webContents.send(IPC.ATTACHMENTS_CHANGED, rowId) })
  // Adding, removing and restoring write audit entries to the record's timeline
  if (rowId !== null) notifyCaseLogChanged(rowId)
}

type AddOpts = { caseLogId?: number; description?: string }
function cleanOpts(v: unknown): AddOpts | null {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  if (o.caseLogId != null && !validId(o.caseLogId)) return null
  if (o.description != null && (typeof o.description !== 'string' || o.description.length > 500)) return null
  return { ...(o.caseLogId != null ? { caseLogId: o.caseLogId as number } : {}), ...(typeof o.description === 'string' ? { description: o.description } : {}) }
}

/** Add, asking first about files already on the record */
async function addWithQuestion(rowId: number, paths: string[], opts: AddOpts) {
  const first = action(() => addAttachments(rowId, paths, opts))
  if (!first.ok || first.data.duplicates.length === 0) return first
  const d = first.data.duplicates
  const when = parseDbTimestamp(d[0]!.existingDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const { response } = await dialog.showMessageBox({
    type: 'question', buttons: ['Attach again', 'Skip'], defaultId: 1, cancelId: 1,
    message: d.length === 1 ? `"${d[0]!.fileName}" is already attached (added ${when}). Attach it again?` : `${d.length} of these files are already attached. Attach them again?`,
  })
  if (response !== 0) return first
  const again = action(() => addAttachments(rowId, d.map(x => x.path), { ...opts, allowDuplicates: true }))
  if (!again.ok) {
    // The new files from the first round are saved; show them, and say so
    const n = first.data.added.length
    if (n === 0) return again
    announce(rowId)
    return fail(`${n} new file${n === 1 ? ' was' : 's were'} added, but the ones already attached weren't added again. ${again.error}`)
  }
  return ok<AddResult>({ added: [...first.data.added, ...again.data.added], duplicates: [] })
}

export function registerAttachmentHandlers(): void {
  secureWrap(IPC.ATTACHMENT_ADD, 'ipc-attachments', async (_e, rowId: unknown, opts?: unknown) => {
    const guard = enforceWritable(); if (guard) return guard
    const o = cleanOpts(opts)
    if (!validId(rowId) || !o) return fail('Invalid request')
    const { canceled, filePaths } = await dialog.showOpenDialog({ title: 'Add files', properties: ['openFile', 'multiSelections'] })
    if (canceled || filePaths.length === 0) return ok<AddResult>({ added: [], duplicates: [] })
    for (const p of filePaths) assertSafePath(p)
    const res = await addWithQuestion(rowId, filePaths, o)
    if (res.ok && res.data.added.length) announce(rowId)
    return res
  })

  secureWrap(IPC.ATTACHMENT_ADD_PATHS, 'ipc-attachments', async (_e, rowId: unknown, paths: unknown, opts?: unknown) => {
    const guard = enforceWritable(); if (guard) return guard
    const o = cleanOpts(opts)
    if (!validId(rowId) || !o || !Array.isArray(paths) || paths.length === 0 || paths.length > 50 || !paths.every(p => typeof p === 'string')) return fail('Invalid request')
    for (const p of paths as string[]) assertSafePath(p)
    const res = await addWithQuestion(rowId, paths as string[], o)
    if (res.ok && res.data.added.length) announce(rowId)
    return res
  })

  secureWrap(IPC.ATTACHMENT_LIST, 'ipc-attachments', (_e, rowId: unknown, includeDeleted?: unknown) => {
    if (!validId(rowId)) return fail('Invalid ID')
    return ok(listAttachments(rowId, { includeDeleted: includeDeleted === true }))
  })

  secureWrap(IPC.ATTACHMENT_DESCRIBE, 'ipc-attachments', (_e, id: unknown, patch: unknown) => {
    const guard = enforceWritable(); if (guard) return guard
    const p = (patch && typeof patch === 'object' ? patch : {}) as Record<string, unknown>
    if (!validId(id) || (p.fileName != null && (typeof p.fileName !== 'string' || !p.fileName.trim())) || (p.description != null && typeof p.description !== 'string')) return fail('Invalid request')
    const res = action(() => describeAttachment(id, { ...(typeof p.fileName === 'string' ? { fileName: p.fileName } : {}), ...(p.description !== undefined ? { description: (p.description as string | null) ?? null } : {}) }))
    if (res.ok) announce(res.data.row_id)
    return res
  })

  for (const [channel, fn] of [[IPC.ATTACHMENT_DELETE, deleteAttachment], [IPC.ATTACHMENT_RESTORE, restoreAttachment]] as const) {
    secureWrap(channel, 'ipc-attachments', (_e, id: unknown) => {
      const guard = enforceWritable(); if (guard) return guard
      if (!validId(id)) return fail('Invalid ID')
      const rowId = getAttachment(id)?.row_id ?? null
      const res = action(() => fn(id))
      if (res.ok) announce(rowId)
      return res
    })
  }

  secureWrap(IPC.ATTACHMENT_USAGE, 'ipc-attachments', () => {
    const u = attachmentUsage()
    return ok({ ...u, text: `${formatBytes(u.bytes)} of ${formatBytes(u.limitBytes)}` })
  })

  // One file (by id), or everything in the trash
  secureWrap(IPC.ATTACHMENT_PURGE, 'ipc-attachments', (_e, id?: unknown) => {
    const guard = enforceWritable(); if (guard) return guard
    if (id != null && !validId(id)) return fail('Invalid ID')
    const res = id != null ? action(() => { purgeAttachment(id as number); return 1 }) : ok(purgeDeletedAttachments(0))
    if (res.ok) announce(null)
    return res
  })

  secureWrap(IPC.ATTACHMENT_TRASH_LIST, 'ipc-attachments', () => ok(trashedAttachments()))

  secureWrap(IPC.ATTACHMENT_OPEN, 'ipc-attachments', async (_e, id: unknown) => {
    if (!validId(id)) return fail('Invalid ID')
    try { await openAttachment(id); return ok(true) } catch (err) { if (err instanceof AttachmentError) return fail(err.message); throw err }
  })

  secureWrap(IPC.ATTACHMENT_SAVE_AS, 'ipc-attachments', async (_e, id: unknown) => {
    if (!validId(id)) return fail('Invalid ID')
    const a = getAttachment(id)
    if (!a) return fail('That file is no longer available.')
    const { canceled, filePath } = await dialog.showSaveDialog({ title: 'Save a copy', defaultPath: a.file_name })
    if (canceled || !filePath) return ok(null)
    assertSafePath(filePath)
    try { await saveAttachmentCopy(id, filePath); return ok(filePath) } catch (err) { if (err instanceof AttachmentError) return fail(err.message); throw err }
  })

  secureWrap(IPC.ATTACHMENT_PREVIEW, 'ipc-attachments', (_e, id: unknown) => {
    if (!validId(id)) return fail('Invalid ID')
    return ok(previewAttachment(id))
  })
}
