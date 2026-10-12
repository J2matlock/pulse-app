/**
 * ipc-attachments.ts — files kept inside the database (generalization W09 §6).
 * Main shows the open dialog itself, so the window never chooses paths;
 * dropped files' paths are checked like any other.
 */
import { BrowserWindow, dialog } from 'electron'
import { z } from 'zod'
import { IPC } from '../../shared/ipc-channels'
import { formatBytes } from '../../shared/attachments'
import { parseDbTimestamp } from '../../shared/dates'
import { ok, fail, validId, assertSafePath, notifyCaseLogChanged, pickSavePath, pickOpenPaths } from './ipc-utils'
import {
  AttachmentError, addAttachments, listAttachments, describeAttachment, deleteAttachment, restoreAttachment, attachmentUsage, purgeDeletedAttachments, getAttachment,
  trashedAttachments, purgeAttachment, keepExtension, cleanFileName,
  type AddResult,
} from '../attachments'
import { openAttachment, saveAttachmentCopy, previewAttachment, extensionForMime } from '../attachment-files'
import { handlersFor, idArg } from './ipc-define'

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

const define = handlersFor('ipc-attachments')

const BAD = 'Invalid request'

export function registerAttachmentHandlers(): void {
  define(IPC.ATTACHMENT_ADD, [idArg(BAD), z.unknown()], async (rowId, opts) => {
    const o = cleanOpts(opts)
    if (!o) return fail(BAD)
    const filePaths = await pickOpenPaths({ title: 'Add files', properties: ['openFile', 'multiSelections'] })
    if (filePaths.length === 0) return ok<AddResult>({ added: [], duplicates: [] })
    for (const p of filePaths) assertSafePath(p)
    const res = await addWithQuestion(rowId, filePaths, o)
    if (res.ok && res.data.added.length) announce(rowId)
    return res
  }, { write: true })

  // Every check answers the same message, so their order doesn't show
  define(IPC.ATTACHMENT_ADD_PATHS, [
    idArg(BAD), z.array(z.string(BAD), BAD).min(1, BAD).max(50, BAD), z.unknown(),
  ], async (rowId, paths, opts) => {
    const o = cleanOpts(opts)
    if (!o) return fail(BAD)
    for (const p of paths) assertSafePath(p)
    const res = await addWithQuestion(rowId, paths, o)
    if (res.ok && res.data.added.length) announce(rowId)
    return res
  }, { write: true })

  define(IPC.ATTACHMENT_LIST, [idArg(), z.unknown()], (rowId, includeDeleted) =>
    ok(listAttachments(rowId, { includeDeleted: includeDeleted === true })))

  define(IPC.ATTACHMENT_DESCRIBE, [idArg(BAD), z.unknown()], (id, patch) => {
    const p = (patch && typeof patch === 'object' ? patch : {}) as Record<string, unknown>
    if ((p.fileName != null && (typeof p.fileName !== 'string' || !p.fileName.trim())) || (p.description != null && typeof p.description !== 'string')) return fail('Invalid request')
    const res = action(() => describeAttachment(id, { ...(typeof p.fileName === 'string' ? { fileName: p.fileName } : {}), ...(p.description !== undefined ? { description: (p.description as string | null) ?? null } : {}) }))
    if (res.ok) announce(res.data.row_id)
    return res
  }, { write: true })

  for (const [channel, fn] of [[IPC.ATTACHMENT_DELETE, deleteAttachment], [IPC.ATTACHMENT_RESTORE, restoreAttachment]] as const) {
    define(channel, [idArg()], (id) => {
      const rowId = getAttachment(id)?.row_id ?? null
      const res = action(() => fn(id))
      if (res.ok) announce(rowId)
      return res
    }, { write: true })
  }

  define(IPC.ATTACHMENT_USAGE, [], () => {
    const u = attachmentUsage()
    return ok({ ...u, text: `${formatBytes(u.bytes)} of ${formatBytes(u.limitBytes)}` })
  })

  // One file (by id), or everything in the trash
  define(IPC.ATTACHMENT_PURGE, [idArg().nullish()], (id) => {
    const res = id != null ? action(() => { purgeAttachment(id); return 1 }) : ok(purgeDeletedAttachments(0))
    if (res.ok) announce(null)
    return res
  }, { write: true })

  define(IPC.ATTACHMENT_TRASH_LIST, [], () => ok(trashedAttachments()))

  define(IPC.ATTACHMENT_OPEN, [idArg()], async (id) => {
    try { await openAttachment(id); return ok(true) } catch (err) { if (err instanceof AttachmentError) return fail(err.message); throw err }
  })

  define(IPC.ATTACHMENT_SAVE_AS, [idArg()], async (id) => {
    const a = getAttachment(id)
    if (!a) return fail('That file is no longer available.')
    // The suggested name ends as the bytes really are: a name saved before Q-057 may say "run.bat" for text
    const ext = extensionForMime(a.mime_type)
    const suggested = ext ? keepExtension(cleanFileName(a.file_name), `file.${ext}`) : cleanFileName(a.file_name)
    const filePath = await pickSavePath({ title: 'Save a copy', defaultPath: suggested })
    if (!filePath) return ok(null)
    assertSafePath(filePath)
    try { await saveAttachmentCopy(id, filePath); return ok(filePath) } catch (err) { if (err instanceof AttachmentError) return fail(err.message); throw err }
  })

  define(IPC.ATTACHMENT_PREVIEW, [idArg()], (id) => ok(previewAttachment(id)))
}
