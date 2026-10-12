import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createTestDb, cleanupTestDb, seedGrid, setDbWords, type TestDb } from './helpers'

let testDb: TestDb
vi.mock('../src/main/database', async () => {
  const actual = await vi.importActual<typeof import('../src/main/database')>('../src/main/database')
  return { ...actual, getDb: () => testDb.db, cachedStmt: (_key: string, sql: string) => testDb.db.prepare(sql) }
})
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp/pulse-test-handoff', commandLine: { appendSwitch: () => {} } },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  dialog: { showMessageBoxSync: () => 0 },
}))

import { exportHandoffPacket, drawFiles } from '../src/main/export-handoff'
import { jsPDF } from '../src/main/export-shared'

const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
const addFile = (rowId: number, name: string, mime: string, data: Buffer, deleted = false) => {
  const id = Number(testDb.db.prepare(`INSERT INTO attachments (row_id, file_name, mime_type, size_bytes, sha256, description, deleted_at) VALUES (?, ?, ?, ?, 'x', 'Front of card', ${deleted ? "datetime('now')" : 'NULL'})`).run(rowId, name, mime, data.length).lastInsertRowid)
  testDb.db.prepare('INSERT INTO attachment_blobs (attachment_id, data) VALUES (?, ?)').run(id, data)
}

beforeEach(() => { testDb = createTestDb(); setDbWords(testDb.db) })
afterEach(() => cleanupTestDb(testDb))

describe('handoff packet', () => {
  it('writes cover, profile and audit trail into one PDF', async () => {
    const { gridId, rowIds } = seedGrid(testDb.db, { rowCount: 1 })
    testDb.db.prepare("INSERT INTO case_log (row_id, content, log_type, created_at, updated_at) VALUES (?, 'Met at home', 'visit', datetime('now'), datetime('now'))").run(rowIds[0])
    const dest = join(testDb.tmpDir, 'handoff.pdf')
    const { pages } = await exportHandoffPacket({ rowId: rowIds[0]!, gridId, receiving: 'Sam Lee', summary: 'Pending: housing application.' }, dest)
    expect(pages).toBeGreaterThanOrEqual(3)
    const buf = readFileSync(dest)
    expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-')
    expect(buf.toString('latin1')).toContain('Client handoff packet')
  })

  it('wraps a long "To" and moves the next line down by the extra lines (Q-077)', async () => {
    const { gridId, rowIds } = seedGrid(testDb.db, { rowCount: 1 })
    const dest = join(testDb.tmpDir, 'handoff-long.pdf')
    const receiving = 'Sam Lee, ' + 'Regional Intake and Transitions Team '.repeat(3) + 'TO-END'
    await exportHandoffPacket({ rowId: rowIds[0]!, gridId, receiving, summary: 'Pending: housing application.' }, dest)
    const pdf = readFileSync(dest, 'latin1')
    const yOf = (start: string) => Number(new RegExp(`[\\d.]+ ([\\d.]+) Td\\s*\\(${start}`).exec(pdf)?.[1])
    expect(pdf).toMatch(/TO-END\) Tj/)
    const lines = (/\(Sam Lee,[^)]*\) Tj(?:\s*T\*\s*\([^)]*\) Tj)*/.exec(pdf)?.[0].match(/\) Tj/g) ?? []).length
    expect(lines).toBeGreaterThan(1)
    // "To" starts at the top of its block; the notes heading sits below every line of it (11 pt lines, 8 mm = 22.7 pt per row)
    expect(yOf('Sam Lee,') - yOf('Notes for the next')).toBeGreaterThan(22.7 + 11 + (lines - 1) * 11)
  })

  it('lists the record’s files and can add pictures as pages', () => {
    const { rowIds } = seedGrid(testDb.db, { rowCount: 1 })
    const r = rowIds[0]!
    const blank = () => new jsPDF({ unit: 'mm', format: 'a4' })
    expect(drawFiles(blank(), r, {})).toBe(0)

    addFile(r, 'card.png', 'image/png', PNG_1PX)
    addFile(r, 'order.pdf', 'application/pdf', Buffer.from('%PDF-1.7'))
    addFile(r, 'broken.jpg', 'image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0, 1, 2]))
    addFile(r, 'gone.png', 'image/png', PNG_1PX, true)

    const listOnly = blank()
    expect(drawFiles(listOnly, r, {})).toBe(0)
    expect(listOnly.getNumberOfPages()).toBe(2)
    const text = Buffer.from(listOnly.output('arraybuffer')).toString('latin1')
    expect(text).toContain('order.pdf')
    expect(text).toContain('Front of card')
    expect(text).not.toContain('gone.png')

    const withPictures = blank()
    // The PNG gets a page; the PDF can't be merged and the broken JPEG is skipped
    expect(drawFiles(withPictures, r, { includePictures: true })).toBe(1)
    expect(withPictures.getNumberOfPages()).toBe(3)
  })
})
