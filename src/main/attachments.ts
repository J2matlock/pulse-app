/**
 * Attachments (generalization W09 §4–5): files kept inside the encrypted
 * database. The type is worked out from the file's own bytes, never
 * trusted from its name; executables, scripts, archives, web pages and
 * anything unrecognized are refused.
 */
import { createHash } from 'crypto'
import { readFileSync, statSync } from 'fs'
import { basename } from 'path'
import { getDb } from './database'
import { scheduleReclaimFreePages } from './purge-hooks'
import { word } from './vocab'
import { ALLOWED_TYPES_TEXT, DEFAULT_LIMIT_MB, LIMIT_MB_RANGE, MAX_FILE_BYTES, formatBytes, type Attachment, type AttachmentUsage } from '../shared/attachments'
import { notTrashedRow } from '../shared/liveRecords'

export class AttachmentError extends Error {}

const startsWith = (b: Buffer, bytes: number[], at = 0) => bytes.every((x, i) => b[at + i] === x)

/**
 * The MIME type from a file's first bytes, or null when it isn't a kind
 * Pulse keeps. Text files are recognized only with a .txt/.csv name and no
 * binary bytes or web-page markup.
 */
export function sniffType(b: Buffer, fileName: string): string | null {
  if (startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith(b, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (b.subarray(0, 6).toString('latin1') === 'GIF87a' || b.subarray(0, 6).toString('latin1') === 'GIF89a') return 'image/gif'
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp'
  if (b.subarray(4, 8).toString('latin1') === 'ftyp' && /^(heic|heix|hevc|mif1|msf1|heif)$/.test(b.subarray(8, 12).toString('latin1'))) return 'image/heic'
  if (b.subarray(0, 5).toString('latin1') === '{\\rtf') return 'application/rtf'
  if (startsWith(b, [0x50, 0x4b, 0x03, 0x04])) {
    // Office and OpenDocument files are zips; other zips (archives) aren't allowed
    const head = b.subarray(0, Math.min(b.length, 256 * 1024)).toString('latin1')
    if (head.includes('mimetypeapplication/vnd.oasis.opendocument.text')) return 'application/vnd.oasis.opendocument.text'
    if (head.includes('mimetypeapplication/vnd.oasis.opendocument.spreadsheet')) return 'application/vnd.oasis.opendocument.spreadsheet'
    if (head.includes('[Content_Types].xml')) {
      if (head.includes('word/')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      if (head.includes('xl/')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      if (head.includes('ppt/')) return 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    }
    return null
  }
  const ext = fileName.toLowerCase().split('.').pop()
  if (ext === 'txt' || ext === 'csv') {
    const sample = b.subarray(0, 64 * 1024)
    if (sample.includes(0)) return null
    const text = sample.toString('utf8').trimStart().toLowerCase()
    if (text.startsWith('<!doctype') || text.startsWith('<html') || text.startsWith('<svg') || text.includes('<script')) return null
    return ext === 'csv' ? 'text/csv' : 'text/plain'
  }
  return null
}

/** A safe display name: the last part of the path, no control characters, at most 200 characters */
const EXTENSION = /\.[A-Za-z0-9]{1,8}$/

/** Endings of the kinds of file Pulse keeps (see sniffType): a rename may switch between these */
const KEPT_EXTENSIONS = new Set(['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif', 'rtf', 'txt', 'csv', 'docx', 'xlsx', 'pptx', 'odt', 'ods'])

/**
 * Renaming "scan.pdf" to "Intake scan" keeps ".pdf": without it "Save a copy"
 * writes a file the computer can't open with a double-click. A new ending that
 * isn't one of those kinds ("notes.txt" renamed "run.bat") gets the old one added
 * after it ("run.bat.txt"), so plain text can't be saved as a script (Q-057, D-021).
 */
export function keepExtension(newName: string, oldName: string): string {
  const ext = EXTENSION.exec(oldName)?.[0]
  const newExt = EXTENSION.exec(newName)?.[0]
  if (!ext) return newName
  if (newExt && KEPT_EXTENSIONS.has(newExt.slice(1).toLowerCase())) return newName
  return cleanFileName(newName + ext)
}

/** Windows device names, which can't be file names there, with or without an ending */
const RESERVED_NAME = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\.|$)/i

export function cleanFileName(path: string): string {
  let name = basename(path)
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, '_')
    // Zero-width and direction marks can disguise an ending ("txt.exe" shown as "exe.txt")
    .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .trim()
    // Windows drops trailing dots and spaces, so "report.pdf." would save as something else
    .replace(/[. ]+$/, '')
  if (!name || /^\.+$/.test(name)) name = 'file'
  if (RESERVED_NAME.test(name)) name = `_${name}`
  if (name.length <= 200) return name
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 && name.length - dot <= 10 ? name.slice(dot) : ''
  return name.slice(0, 200 - ext.length) + ext
}

export function limitBytes(): number {
  const v = Number((getDb().prepare("SELECT value FROM settings WHERE key = 'attachments_max_mb'").get() as { value: string } | undefined)?.value)
  const mb = Number.isFinite(v) && v >= LIMIT_MB_RANGE.min && v <= LIMIT_MB_RANGE.max ? v : DEFAULT_LIMIT_MB
  return mb * 1024 * 1024
}

/** Files kept, trash included (they still take room until purged) */
export function attachmentUsage(): AttachmentUsage {
  const r = getDb().prepare('SELECT COUNT(*) AS count, COALESCE(SUM(size_bytes), 0) AS bytes FROM attachments').get() as { count: number; bytes: number }
  return { ...r, limitBytes: limitBytes() }
}

/** An audit-trail entry on the record (shown in its activity timeline with system entries) */
function auditNote(rowId: number | null, text: string): void {
  if (rowId === null) return
  getDb().prepare("INSERT INTO case_log (row_id, content, log_type, created_at, updated_at) VALUES (?, ?, 'system', datetime('now'), datetime('now'))").run(rowId, text)
}

const COLS = 'id, row_id, case_log_id, file_name, mime_type, size_bytes, sha256, description, created_at, deleted_at'

export function listAttachments(rowId: number, opts: { includeDeleted?: boolean } = {}): Attachment[] {
  return getDb().prepare(`SELECT ${COLS} FROM attachments WHERE row_id = ? ${opts.includeDeleted ? '' : 'AND deleted_at IS NULL'} ORDER BY created_at DESC, id DESC`).all(rowId) as Attachment[]
}

export function getAttachment(id: number): Attachment | undefined {
  return getDb().prepare(`SELECT ${COLS} FROM attachments WHERE id = ?`).get(id) as Attachment | undefined
}

export function attachmentBytes(id: number): Buffer {
  const r = getDb().prepare('SELECT data FROM attachment_blobs WHERE attachment_id = ?').get(id) as { data: Buffer } | undefined
  if (!r) throw new AttachmentError('That file is no longer available.')
  return r.data
}

export interface AddResult {
  added: Attachment[]
  /** Files already on this record (same contents), not added unless allowed */
  duplicates: Array<{ path: string; fileName: string; existingDate: string }>
}

/**
 * Add files to a record (optionally on one of its notes), checking each
 * one's size and type and the total limit; all or nothing.
 */
export function addAttachments(rowId: number, paths: string[], opts: { caseLogId?: number; description?: string; allowDuplicates?: boolean } = {}): AddResult {
  const db = getDb()
  if (!db.prepare(`SELECT 1 FROM rows WHERE id = ? AND ${notTrashedRow('')}`).get(rowId)) throw new AttachmentError(`That ${word('record')} is no longer available.`)
  if (opts.caseLogId !== undefined && !db.prepare('SELECT 1 FROM case_log WHERE id = ? AND row_id = ?').get(opts.caseLogId, rowId)) throw new AttachmentError(`That ${word('activity', {}, (db.prepare('SELECT grid_id FROM rows WHERE id = ?').get(rowId) as { grid_id: number }).grid_id)} is no longer available.`)
  if (paths.length === 0) return { added: [], duplicates: [] }
  if (paths.length > 50) throw new AttachmentError('Add up to 50 files at a time.')
  const files = paths.map(path => {
    let size: number
    try {
      const st = statSync(path)
      if (!st.isFile()) throw new AttachmentError(`"${basename(path)}" isn't a file.`)
      size = st.size
    } catch (err) {
      if (err instanceof AttachmentError) throw err
      throw new AttachmentError(`"${basename(path)}" couldn't be read.`)
    }
    const fileName = cleanFileName(path)
    if (size > MAX_FILE_BYTES) throw new AttachmentError(`"${fileName}" is ${formatBytes(size)}; files can be up to ${formatBytes(MAX_FILE_BYTES)}.`)
    if (size === 0) throw new AttachmentError(`"${fileName}" is empty.`)
    let data: Buffer
    try { data = readFileSync(path) } catch { throw new AttachmentError(`"${fileName}" couldn't be read.`) }
    const mime = sniffType(data, fileName)
    if (!mime) throw new AttachmentError(`"${fileName}" isn't a kind of file Pulse keeps. You can attach ${ALLOWED_TYPES_TEXT}.`)
    return { path, fileName, data, mime, sha256: createHash('sha256').update(data).digest('hex') }
  })
  const duplicates: AddResult['duplicates'] = []
  const dupStmt = db.prepare('SELECT created_at FROM attachments WHERE row_id = ? AND sha256 = ? AND deleted_at IS NULL ORDER BY created_at LIMIT 1')
  const toAdd = files.filter(f => {
    const existing = dupStmt.get(rowId, f.sha256) as { created_at: string } | undefined
    if (existing && !opts.allowDuplicates) { duplicates.push({ path: f.path, fileName: f.fileName, existingDate: existing.created_at }); return false }
    return true
  })
  const adding = toAdd.reduce((n, f) => n + f.data.length, 0)
  const usage = attachmentUsage()
  if (usage.bytes + adding > usage.limitBytes) {
    throw new AttachmentError(`That would use ${formatBytes(usage.bytes + adding)} of the ${formatBytes(usage.limitBytes)} set aside for files. Remove files from the Trash, or raise the limit in Settings → Data.`)
  }
  return db.transaction((): AddResult => {
    const ins = db.prepare('INSERT INTO attachments (row_id, case_log_id, file_name, mime_type, size_bytes, sha256, description) VALUES (?, ?, ?, ?, ?, ?, ?)')
    const blob = db.prepare('INSERT INTO attachment_blobs (attachment_id, data) VALUES (?, ?)')
    const added = toAdd.map(f => {
      const id = Number(ins.run(rowId, opts.caseLogId ?? null, f.fileName, f.mime, f.data.length, f.sha256, opts.description?.trim().slice(0, 500) || null).lastInsertRowid)
      blob.run(id, f.data)
      auditNote(rowId, `File added: ${f.fileName} (${formatBytes(f.data.length)})`)
      return getAttachment(id)!
    })
    return { added, duplicates }
  })()
}

export function describeAttachment(id: number, patch: { fileName?: string; description?: string | null }): Attachment {
  const a = getAttachment(id)
  if (!a || a.deleted_at) throw new AttachmentError('That file is no longer available.')
  const name = patch.fileName !== undefined ? keepExtension(cleanFileName(patch.fileName), a.file_name) : a.file_name
  const desc = patch.description !== undefined ? (patch.description?.trim().slice(0, 500) || null) : a.description
  getDb().transaction(() => {
    getDb().prepare('UPDATE attachments SET file_name = ?, description = ? WHERE id = ?').run(name, desc, id)
    if (name !== a.file_name) auditNote(a.row_id, `File renamed: ${a.file_name} → ${name}`)
  })()
  return getAttachment(id)!
}

export function deleteAttachment(id: number): void {
  const db = getDb()
  db.transaction(() => {
    if (db.prepare("UPDATE attachments SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL").run(id).changes === 0) throw new AttachmentError('That file is no longer available.')
    const a = getAttachment(id)!
    auditNote(a.row_id, `File removed: ${a.file_name}`)
  })()
}

export function restoreAttachment(id: number): void {
  const db = getDb()
  db.transaction(() => {
    if (db.prepare('UPDATE attachments SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL').run(id).changes === 0) throw new AttachmentError("That file isn't in the Trash.")
    const a = getAttachment(id)!
    auditNote(a.row_id, `File restored: ${a.file_name}`)
  })()
}

/** Remove files that have been in the trash this long (0 = all of them now) */
export function purgeDeletedAttachments(olderThanDays = 30): number {
  const db = getDb()
  const n = db.prepare("DELETE FROM attachments WHERE deleted_at IS NOT NULL AND deleted_at <= datetime('now', ?)").run(`-${Math.max(0, olderThanDays)} days`).changes
  if (n) scheduleReclaimFreePages(db)
  return n
}

/** Files in the trash, newest first, with the record they belong to */
export function trashedAttachments(): Array<Attachment & { record_name: string | null }> {
  return getDb().prepare(`SELECT a.id, a.row_id, a.case_log_id, a.file_name, a.mime_type, a.size_bytes, a.sha256, a.description, a.created_at, a.deleted_at,
    COALESCE(NULLIF(r.display_name, ''), '(unnamed)') AS record_name
    FROM attachments a LEFT JOIN rows r ON r.id = a.row_id WHERE a.deleted_at IS NOT NULL ORDER BY a.deleted_at DESC, a.id DESC`).all() as Array<Attachment & { record_name: string | null }>
}

/** Remove one file from the trash for good */
export function purgeAttachment(id: number): void {
  const db = getDb()
  if (db.prepare('DELETE FROM attachments WHERE id = ? AND deleted_at IS NOT NULL').run(id).changes === 0) throw new AttachmentError("That file isn't in the Trash.")
  scheduleReclaimFreePages(db)
}
