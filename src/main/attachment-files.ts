/**
 * Opening and saving attachments (generalization W09 §5). Opening writes a
 * short-lived copy to `<data folder>/tmp-open/` for the system viewer; the
 * folder is wiped on lock, quit and startup, and each copy is removed ten
 * minutes after opening when the system allows. Saving a copy writes the
 * exact bytes where the person chooses (that copy isn't encrypted).
 */
import { randomBytes } from 'crypto'
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { shell } from 'electron'
import { getPortableDataDir } from './data-dir'
import { registerCloseHook } from './database'
import { attachmentBytes, getAttachment, AttachmentError } from './attachments'
import { atomicWriteFileAsync } from './export-shared'
import { PREVIEW_MAX_BYTES, isImage } from '../shared/attachments'
import { logger } from './logger'

const EXT: Record<string, string> = {
  'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/heic': 'heic',
  'application/rtf': 'rtf', 'text/plain': 'txt', 'text/csv': 'csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.oasis.opendocument.text': 'odt', 'application/vnd.oasis.opendocument.spreadsheet': 'ods',
}
const REMOVE_AFTER_MS = 10 * 60 * 1000

export function openedFilesDir(): string {
  return join(getPortableDataDir(), 'tmp-open')
}

/** Remove every opened copy (files the system still has open are left for next time) */
export function wipeOpenedFiles(): number {
  let removed = 0
  try {
    for (const name of readdirSync(openedFilesDir())) {
      try { rmSync(join(openedFilesDir(), name), { force: true }); removed++ } catch { /* still open (Windows) */ }
    }
  } catch { /* no folder yet */ }
  return removed
}

// Locking or quitting closes the database; the opened copies go with it
registerCloseHook(() => { wipeOpenedFiles() })

/** Write a temporary copy for the system viewer; returns its path */
export function writeOpenedCopy(id: number): string {
  const a = getAttachment(id)
  if (!a || a.deleted_at) throw new AttachmentError('That file is no longer available.')
  const dir = openedFilesDir()
  mkdirSync(dir, { recursive: true })
  // A random name: nothing about the record shows in the folder
  const path = join(dir, `${randomBytes(12).toString('hex')}.${EXT[a.mime_type] ?? 'bin'}`)
  writeFileSync(path, attachmentBytes(id), { mode: 0o600 })
  setTimeout(() => { try { rmSync(path, { force: true }) } catch { /* removed at the next wipe */ } }, REMOVE_AFTER_MS).unref?.()
  return path
}

export async function openAttachment(id: number): Promise<void> {
  const path = writeOpenedCopy(id)
  const err = await shell.openPath(path)
  if (err) {
    logger.warn('attachments', 'open failed', { err })
    throw new AttachmentError("This computer doesn't have a program to open that file. Save a copy instead.")
  }
}

export async function saveAttachmentCopy(id: number, destPath: string): Promise<void> {
  const a = getAttachment(id)
  if (!a) throw new AttachmentError('That file is no longer available.')
  await atomicWriteFileAsync(destPath, attachmentBytes(id))
}

/** A data URL for showing a picture in the window; other files open in the system viewer */
export function previewAttachment(id: number): { dataUrl: string } | null {
  const a = getAttachment(id)
  if (!a || a.deleted_at || !isImage(a.mime_type) || a.size_bytes > PREVIEW_MAX_BYTES) return null
  return { dataUrl: `data:${a.mime_type};base64,${attachmentBytes(id).toString('base64')}` }
}
