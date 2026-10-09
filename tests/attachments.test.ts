/** Attachments (W09 commit 1): type sniffing, limits, duplicates, add/list/delete/restore/purge, usage. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createTestDb, cleanupTestDb, seedGrid, createEmptyEncryptedDb, allMigrations, type TestDb } from './helpers'

let t: TestDb
vi.mock('../src/main/database', () => ({ getDb: () => t.db, cachedStmt: (_k: string, sql: string) => t.db.prepare(sql) }))

import { sniffType, cleanFileName, addAttachments, listAttachments, deleteAttachment, restoreAttachment, purgeDeletedAttachments, attachmentUsage, attachmentBytes, describeAttachment, AttachmentError, trashedAttachments, purgeAttachment } from '../src/main/attachments'
import { up as migration042 } from '../src/main/migrations/042_attachments'
import { formatBytes } from '../src/shared/attachments'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const PDF = Buffer.from('%PDF-1.7\nhello')
let dir: string
let g: { gridId: number; rowIds: number[] }
const file = (name: string, data: Buffer | string) => { const p = join(dir, name); writeFileSync(p, data); return p }

beforeEach(() => { t = createTestDb(); dir = mkdtempSync(join(tmpdir(), 'pulse-attach-')); g = seedGrid(t.db, { rowCount: 2, columnCount: 1 }) })
afterEach(() => { cleanupTestDb(t); rmSync(dir, { recursive: true, force: true }) })

describe('migration 042', () => {
  it('adds the tables and is safe to run twice', () => {
    const e = createEmptyEncryptedDb()
    e.db.exec('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    for (const m of allMigrations) if (m.version <= 41) m.up(e.db)
    migration042(e.db)
    expect(() => migration042(e.db)).not.toThrow()
    expect((e.db.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get() as { value: string }).value).toBe('42')
    cleanupTestDb(e)
  })
})

describe('file types', () => {
  it('come from the bytes, not the name', () => {
    expect(sniffType(PDF, 'scan.exe')).toBe('application/pdf')
    expect(sniffType(PNG, 'photo.pdf')).toBe('image/png')
    expect(sniffType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'x')).toBe('image/jpeg')
    expect(sniffType(Buffer.from('GIF89a....'), 'x')).toBe('image/gif')
    expect(sniffType(Buffer.from('RIFF\0\0\0\0WEBPVP8 '), 'x')).toBe('image/webp')
    expect(sniffType(Buffer.from('\0\0\0\x18ftypheic'), 'x')).toBe('image/heic')
    expect(sniffType(Buffer.from('{\\rtf1 hi'), 'x')).toBe('application/rtf')
    expect(sniffType(Buffer.from('PK\x03\x04....[Content_Types].xml....word/document.xml'), 'x')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    expect(sniffType(Buffer.from('PK\x03\x04....mimetypeapplication/vnd.oasis.opendocument.spreadsheet'), 'x')).toBe('application/vnd.oasis.opendocument.spreadsheet')
  })

  it('refuse programs, archives, web pages and unknown files', () => {
    expect(sniffType(Buffer.from('MZ\x90\0'), 'tool.pdf')).toBeNull()
    expect(sniffType(Buffer.from('\x7fELF'), 'x')).toBeNull()
    expect(sniffType(Buffer.from('PK\x03\x04plain zip'), 'notes.docx')).toBeNull()
    expect(sniffType(Buffer.from('<!DOCTYPE html><script>'), 'page.txt')).toBeNull()
    expect(sniffType(Buffer.from('<svg onload=x>'), 'pic.txt')).toBeNull()
    expect(sniffType(Buffer.from('#!/bin/sh\nrm -rf'), 'run.sh')).toBeNull()
    expect(sniffType(Buffer.from('a,b\n1,2'), 'data.csv')).toBe('text/csv')
    expect(sniffType(Buffer.from('a\0b'), 'data.txt')).toBeNull()
  })

  it('clean names', () => {
    expect(cleanFileName('/x/y/court:order?.pdf')).toBe('court_order_.pdf')
    expect(cleanFileName(`/x/${'a'.repeat(300)}.pdf`)).toHaveLength(200)
    expect(cleanFileName(`/x/${'a'.repeat(300)}.pdf`).endsWith('.pdf')).toBe(true)
  })
})

describe('adding files', () => {
  it('keeps them in the database with their exact bytes, newest first', () => {
    const r = g.rowIds[0]!
    const { added } = addAttachments(r, [file('order.pdf', PDF), file('damage.png', PNG)], { description: ' Signed ' })
    expect(added.map(a => [a.file_name, a.mime_type, a.size_bytes, a.description])).toEqual([['order.pdf', 'application/pdf', PDF.length, 'Signed'], ['damage.png', 'image/png', PNG.length, 'Signed']])
    expect(attachmentBytes(added[1]!.id).equals(PNG)).toBe(true)
    expect(listAttachments(r).map(a => a.file_name).sort()).toEqual(['damage.png', 'order.pdf'])
    expect(attachmentUsage()).toMatchObject({ count: 2, bytes: PDF.length + PNG.length })
  })

  it('refuses the whole batch when one file is wrong', () => {
    expect(() => addAttachments(g.rowIds[0]!, [file('ok.pdf', PDF), file('tool.pdf', Buffer.from('MZ....'))])).toThrow(/"tool.pdf" isn't a kind of file Pulse keeps/)
    expect(listAttachments(g.rowIds[0]!)).toEqual([])
    expect(() => addAttachments(g.rowIds[0]!, [file('big.pdf', Buffer.concat([PDF, Buffer.alloc(15 * 1024 * 1024)]))])).toThrow(/files can be up to 15 MB/)
    expect(() => addAttachments(g.rowIds[0]!, [dir])).toThrow(/isn't a file/)
  })

  it('stays within the total limit', () => {
    t.db.prepare("INSERT INTO settings (key, value) VALUES ('attachments_max_mb', '100')").run()
    t.db.prepare("INSERT INTO attachments (row_id, file_name, mime_type, size_bytes, sha256) VALUES (?, 'old', 'application/pdf', ?, 'x')").run(g.rowIds[1], 100 * 1024 * 1024 - 5)
    expect(() => addAttachments(g.rowIds[0]!, [file('order.pdf', PDF)])).toThrow(/set aside for files/)
  })

  it('asks before adding a file that is already there', () => {
    const r = g.rowIds[0]!
    addAttachments(r, [file('order.pdf', PDF)])
    const again = addAttachments(r, [file('copy.pdf', PDF)])
    expect(again.added).toEqual([])
    expect(again.duplicates).toEqual([expect.objectContaining({ fileName: 'copy.pdf' })])
    expect(addAttachments(r, [file('copy.pdf', PDF)], { allowDuplicates: true }).added).toHaveLength(1)
    // Another record can have the same file
    expect(addAttachments(g.rowIds[1]!, [file('copy.pdf', PDF)]).added).toHaveLength(1)
  })

  it('attaches to a note of the same record only', () => {
    const note = Number(t.db.prepare("INSERT INTO case_log (row_id, content, log_type) VALUES (?, 'Renewed', 'note')").run(g.rowIds[0]).lastInsertRowid)
    expect(addAttachments(g.rowIds[0]!, [file('card.png', PNG)], { caseLogId: note }).added[0]!.case_log_id).toBe(note)
    expect(() => addAttachments(g.rowIds[1]!, [file('card.png', PNG)], { caseLogId: note })).toThrow(AttachmentError)
  })
})

describe('trash', () => {
  it('delete, restore, rename and purge', () => {
    const [a] = addAttachments(g.rowIds[0]!, [file('order.pdf', PDF)]).added
    expect(describeAttachment(a!.id, { fileName: 'Court order.pdf', description: 'Signed 3/3' })).toMatchObject({ file_name: 'Court order.pdf', description: 'Signed 3/3' })
    deleteAttachment(a!.id)
    expect(listAttachments(g.rowIds[0]!)).toEqual([])
    expect(listAttachments(g.rowIds[0]!, { includeDeleted: true })).toHaveLength(1)
    restoreAttachment(a!.id)
    expect(() => restoreAttachment(a!.id)).toThrow(/isn't in the trash/)
    deleteAttachment(a!.id)
    expect(purgeDeletedAttachments(30)).toBe(0)
    expect(purgeDeletedAttachments(0)).toBe(1)
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM attachment_blobs').get()).toEqual({ n: 0 })
    expect(formatBytes(240 * 1024)).toBe('240 KB')
  })

  it('lists the trash with record names and removes one file for good', () => {
    t.db.prepare("UPDATE rows SET display_name = 'Jane Smith' WHERE id = ?").run(g.rowIds[0])
    const [a, b] = addAttachments(g.rowIds[0]!, [file('order.pdf', PDF), file('card.png', PNG)]).added
    expect(trashedAttachments()).toEqual([])
    deleteAttachment(a!.id)
    expect(trashedAttachments()).toEqual([expect.objectContaining({ id: a!.id, file_name: 'order.pdf', record_name: 'Jane Smith' })])
    expect(() => purgeAttachment(b!.id)).toThrow(/isn't in the trash/)
    purgeAttachment(a!.id)
    expect(trashedAttachments()).toEqual([])
    expect(listAttachments(g.rowIds[0]!).map(x => x.id)).toEqual([b!.id])
  })
})

describe('audit trail', () => {
  it('records adding, renaming, removing and restoring a file on the record', () => {
    const r = g.rowIds[0]!
    const [a] = addAttachments(r, [file('order.pdf', PDF)]).added
    describeAttachment(a!.id, { fileName: 'Court order.pdf' })
    describeAttachment(a!.id, { description: 'just a description' })
    deleteAttachment(a!.id)
    restoreAttachment(a!.id)
    const notes = (t.db.prepare("SELECT content FROM case_log WHERE row_id = ? AND log_type = 'system' ORDER BY id").all(r) as { content: string }[]).map(n => n.content)
    expect(notes).toEqual([`File added: order.pdf (${formatBytes(PDF.length)})`, 'File renamed: order.pdf → Court order.pdf', 'File removed: Court order.pdf', 'File restored: Court order.pdf'])
  })
})
