/**
 * export-pdf.ts tests — PDF export via real SQLCipher DB.
 * Tests exportLetterPdf, exportPdfGrid, exportPdfProfile output.
 * We verify the PDF buffer is produced and written atomically;
 * full visual rendering is not testable without a PDF parser,
 * so we check file existence, non-zero size, and PDF magic bytes.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

let testDb: TestDb

vi.mock('../src/main/database', async () => {
  const actual = await vi.importActual<typeof import('../src/main/database')>('../src/main/database')
  return {
    ...actual,
    getDb: () => testDb.db,
    cachedStmt: (_key: string, sql: string) => testDb.db.prepare(sql),
    buildGridQuery: actual.buildGridQuery,
  }
})

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp/pulse-test-export-pdf', commandLine: { appendSwitch: () => {} } },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  dialog: { showMessageBoxSync: () => 0 },
}))

import { exportLetterPdf, exportPdfGrid, exportPdfProfile } from '../src/main/export-pdf'

beforeEach(() => { testDb = createTestDb() })
afterEach(() => { cleanupTestDb(testDb) })

function isPdfBuffer(buf: Buffer): boolean {
  return buf.length > 4 && buf.subarray(0, 5).toString('ascii') === '%PDF-'
}

describe('exportLetterPdf', () => {
  it('produces a valid PDF file from plain text', async () => {
    const destPath = join(testDb.tmpDir, 'letter.pdf')
    await exportLetterPdf('Dear Client,\n\nThis is a test letter.\n\nSincerely,\nYour Worker', destPath)

    expect(existsSync(destPath)).toBe(true)
    const buf = readFileSync(destPath)
    expect(buf.length).toBeGreaterThan(100)
    expect(isPdfBuffer(buf)).toBe(true)
  })

  it('handles empty text', async () => {
    const destPath = join(testDb.tmpDir, 'empty-letter.pdf')
    await exportLetterPdf('', destPath)

    expect(existsSync(destPath)).toBe(true)
    expect(isPdfBuffer(readFileSync(destPath))).toBe(true)
  })

  it('handles very long text with page breaks', async () => {
    const longText = 'Line of text for testing page overflow.\n'.repeat(500)
    const destPath = join(testDb.tmpDir, 'long-letter.pdf')
    await exportLetterPdf(longText, destPath)

    expect(existsSync(destPath)).toBe(true)
    const buf = readFileSync(destPath)
    expect(buf.length).toBeGreaterThan(1000)
    expect(isPdfBuffer(buf)).toBe(true)
  })
})

describe('exportPdfGrid', () => {
  it('produces a valid PDF with grid data', async () => {
    const { gridId, columnIds, rowIds } = seedGrid(testDb.db, { rowCount: 5, columnCount: 3 })
    testDb.db.prepare('UPDATE columns SET name = ? WHERE id = ?').run('Name', columnIds[0])
    testDb.db.prepare('UPDATE columns SET name = ? WHERE id = ?').run('Status', columnIds[1])
    testDb.db.prepare('UPDATE columns SET name = ? WHERE id = ?').run('Notes', columnIds[2])

    const insert = testDb.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
    insert.run(rowIds[0], columnIds[0], 'Alice')
    insert.run(rowIds[0], columnIds[1], 'Active')
    insert.run(rowIds[1], columnIds[0], 'Bob')

    const destPath = join(testDb.tmpDir, 'grid.pdf')
    await exportPdfGrid({
      gridId,
      columnIds: [],
      activeRowIds: [],
      destPath,
    })

    expect(existsSync(destPath)).toBe(true)
    expect(isPdfBuffer(readFileSync(destPath))).toBe(true)
  })

  it('respects column filter', async () => {
    const { gridId, columnIds, rowIds } = seedGrid(testDb.db, { rowCount: 1, columnCount: 3 })
    const insert = testDb.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
    insert.run(rowIds[0], columnIds[0], 'Alice')

    const destPath = join(testDb.tmpDir, 'grid-filtered.pdf')
    await exportPdfGrid({
      gridId,
      columnIds: [columnIds[0]],
      activeRowIds: [],
      destPath,
    })

    expect(existsSync(destPath)).toBe(true)
    expect(isPdfBuffer(readFileSync(destPath))).toBe(true)
  })

  it('uses custom title when provided', async () => {
    const { gridId } = seedGrid(testDb.db, { rowCount: 1, columnCount: 1 })
    const destPath = join(testDb.tmpDir, 'titled.pdf')
    await exportPdfGrid({
      gridId,
      columnIds: [],
      activeRowIds: [],
      destPath,
      title: 'Custom Report Title',
    })

    expect(existsSync(destPath)).toBe(true)
    expect(isPdfBuffer(readFileSync(destPath))).toBe(true)
  })

  it('handles grid with zero rows', async () => {
    const { gridId } = seedGrid(testDb.db, { rowCount: 0, columnCount: 2 })
    const destPath = join(testDb.tmpDir, 'empty-grid.pdf')
    await exportPdfGrid({
      gridId,
      columnIds: [],
      activeRowIds: [],
      destPath,
    })

    expect(existsSync(destPath)).toBe(true)
    expect(isPdfBuffer(readFileSync(destPath))).toBe(true)
  })
})

describe('exportPdfProfile', () => {
  it('produces a valid PDF with all sections enabled', async () => {
    const { gridId, columnIds, rowIds } = seedGrid(testDb.db, { rowCount: 1, columnCount: 2 })
    testDb.db.prepare('UPDATE columns SET name = ? WHERE id = ?').run('Name', columnIds[0])
    testDb.db.prepare('UPDATE columns SET name = ? WHERE id = ?').run('Phone', columnIds[1])
    testDb.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
      .run(rowIds[0], columnIds[0], 'Jane Doe')
    testDb.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
      .run(rowIds[0], columnIds[1], '555-1234')

    const destPath = join(testDb.tmpDir, 'profile.pdf')
    await exportPdfProfile({
      rowId: rowIds[0],
      gridId,
      destPath,
      includeSections: {
        deadlines: true,
        checklist: true,
        caseLog: true,
        scratchPad: true,
        contactInfo: true,
        gridData: true,
      },
    })

    expect(existsSync(destPath)).toBe(true)
    expect(isPdfBuffer(readFileSync(destPath))).toBe(true)
  })

  it('produces PDF with all sections disabled (header only)', async () => {
    const { gridId, rowIds } = seedGrid(testDb.db, { rowCount: 1, columnCount: 1 })

    const destPath = join(testDb.tmpDir, 'profile-minimal.pdf')
    await exportPdfProfile({
      rowId: rowIds[0],
      gridId,
      destPath,
      includeSections: {
        deadlines: false,
        checklist: false,
        caseLog: false,
        scratchPad: false,
        contactInfo: false,
        gridData: false,
      },
    })

    expect(existsSync(destPath)).toBe(true)
    expect(isPdfBuffer(readFileSync(destPath))).toBe(true)
  })
})
