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
import { jsPDF } from '../src/main/export-shared'

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

  it('wraps a long title and moves the line under it down (Q-077)', async () => {
    const { gridId } = seedGrid(testDb.db, { rowCount: 1, columnCount: 2 })
    const title = 'Quarterly review of ' + 'every open record in the northern region '.repeat(4) + 'TITLE-END'
    const destPath = join(testDb.tmpDir, 'grid-title.pdf')
    await exportPdfGrid({ gridId, columnIds: [], activeRowIds: [], destPath, title })
    const pdf = readFileSync(destPath, 'latin1')
    expect(pdf).not.toContain(`(${title})`)
    expect(pdf).toMatch(/TITLE-END\) Tj/)
    const yOf = (start: string) => Number(new RegExp(`[\\d.]+ ([\\d.]+) Td\\s*\\(${start}`).exec(pdf)?.[1])
    // 6 mm (17 pt) under a one-line title; a wrapped one adds at least a 16 pt line
    expect(yOf('Quarterly review') - yOf('Exported ')).toBeGreaterThan(30)
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

  it('prints cells starting with + or - as they are, without the CSV guard (AUDIT-121)', async () => {
    const { gridId, columnIds, rowIds } = seedGrid(testDb.db, { rowCount: 1, columnCount: 2 })
    const insert = testDb.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
    insert.run(rowIds[0], columnIds[0], '+1 555 0100')
    insert.run(rowIds[0], columnIds[1], '-follow up')
    const destPath = join(testDb.tmpDir, 'grid-guard.pdf')
    await exportPdfGrid({ gridId, columnIds: [], activeRowIds: [], destPath })
    const pdf = readFileSync(destPath).toString('latin1')
    expect(pdf).toContain('(+1 555 0100)')
    expect(pdf).toContain('(-follow up)')
  })

  it('prints names outside Windows-1252 with the Unicode font, plain ones without it (AUDIT-009)', async () => {
    const { gridId, columnIds, rowIds } = seedGrid(testDb.db, { rowCount: 3, columnCount: 1 })
    const insert = testDb.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
    insert.run(rowIds[0], columnIds[0], 'Łukasz Wójcik')
    insert.run(rowIds[1], columnIds[0], 'Иван Петров')
    insert.run(rowIds[2], columnIds[0], 'Nguyễn Thị Lan')
    const destPath = join(testDb.tmpDir, 'unicode.pdf')
    await exportPdfGrid({ gridId, columnIds: [], activeRowIds: [], destPath, title: 'Ayşe Yılmaz' })
    const pdf = readFileSync(destPath).toString('latin1')
    expect(pdf).toContain('/LiberationSans')
    // The broken path wrote each character as two bytes, a NUL between letters
    expect(pdf).not.toMatch(/u\x00k\x00a\x00s\x00z/)
    expect(pdf).not.toMatch(/Y\x001\x00l/)

    const plainPath = join(testDb.tmpDir, 'plain.pdf')
    testDb.db.prepare('UPDATE cells SET value = ? WHERE row_id IN (?, ?, ?)').run('José Núñez', rowIds[0], rowIds[1], rowIds[2])
    await exportPdfGrid({ gridId, columnIds: [], activeRowIds: [], destPath: plainPath })
    const plain = readFileSync(plainPath).toString('latin1')
    expect(plain).not.toContain('LiberationSans')
    expect(plain).toContain('(Jos\xe9 N\xfa\xf1ez)')
  })

  it('prints 11 pt and up in black, dates on the right, in the order it was given (persona study R7)', async () => {
    const { gridId, columnIds, rowIds } = seedGrid(testDb.db, { rowCount: 3, columnCount: 2, columnTypes: ['text', 'date'] })
    const insert = testDb.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
    ;['Ann', 'Bea', 'Cal'].forEach((n, i) => insert.run(rowIds[i], columnIds[0], n))
    insert.run(rowIds[0], columnIds[1], '2026-11-01')
    type Doc = Record<string, (...a: unknown[]) => unknown>
    type Hook = [string, (this: Doc) => void]
    const colors: unknown[][] = [], sizes: number[] = [], texts: Array<{ text: string; x: number }> = []
    const events = (jsPDF.API as unknown as { events: Hook[] }).events
    const hook: Hook = ['initialized', function (this: Doc) {
      const wrap = (name: string, log: (args: unknown[]) => void) => {
        const original = this[name]!
        this[name] = (...args: unknown[]) => { log(args); return original.apply(this, args) }
      }
      wrap('setTextColor', a => colors.push(a))
      wrap('setFontSize', a => sizes.push(Number(a[0])))
      wrap('text', a => texts.push({ text: Array.isArray(a[0]) ? a[0].join(' ') : String(a[0]), x: Number(a[1]) }))
    }]
    events.push(hook)
    try {
      await exportPdfGrid({ gridId, columnIds: [], activeRowIds: [rowIds[2]!, rowIds[0]!, rowIds[1]!], destPath: join(testDb.tmpDir, 'legible.pdf') })
    } finally { events.splice(events.indexOf(hook), 1) }
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(11)
    const black = (c: unknown[]) => c.every(v => v === 0 || v === '0' || v === undefined || v === '#000000' || (Array.isArray(v) && v.every(x => x === 0)))
    expect(colors.filter(c => !black(c))).toEqual([])
    const names = texts.map(t => t.text).filter(t => ['Ann', 'Bea', 'Cal'].includes(t))
    expect(names).toEqual(['Cal', 'Ann', 'Bea'])
    // Right-aligned: the date sits at its column's right edge, well past where the header starts
    const date = texts.find(t => /Nov|11\/0?1\/2026|2026-11-01/.test(t.text))!
    const header = texts.find(t => t.text === 'Column 2')!
    expect(date.x).toBeGreaterThan(header.x + 50)
  })

  it('makes each column at least as wide as its longest word, so a wide list never breaks one (persona study R7)', async () => {
    const { gridId, columnIds, rowIds } = seedGrid(testDb.db, { rowCount: 2, columnCount: 10 })
    const rename = testDb.db.prepare('UPDATE columns SET name = ? WHERE id = ?')
    rename.run('Parent/guardian', columnIds[8]); rename.run('Next appointment', columnIds[3])
    const insert = testDb.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
    insert.run(rowIds[0], columnIds[5], 'Disability compensation')
    insert.run(rowIds[0], columnIds[9], '11/03/2025')
    const destPath = join(testDb.tmpDir, 'wide.pdf')
    await exportPdfGrid({ gridId, columnIds: [], activeRowIds: [], destPath })
    const pdf = readFileSync(destPath, 'latin1')
    // Each word is whole inside one line of text
    for (const word of ['Parent/guardian', 'appointment', 'compensation', '11/03/2025']) expect(pdf).toMatch(new RegExp(`\\((?:[^)]* )?${word.replace(/\//g, '\\/')}(?: [^)]*)?\\) Tj`))
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
