/**
 * Smarter import (C2): messy agency spreadsheets — grouped/merged headers,
 * merged cells, "Last, First" names, and mixed date formats.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import ExcelJS from 'exceljs'
import { writeFileSync, rmSync, mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createTestDb, cleanupTestDb, type TestDb } from './helpers'

let testDb: TestDb
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => join(tmpdir(), 'pulse-test-mock'), whenReady: () => Promise.resolve(), commandLine: { appendSwitch: () => {} } },
  ipcMain: { handle: () => {} },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  dialog: { showMessageBoxSync: () => 0 },
}))
vi.mock('electron-store', () => ({ default: class { get() { return undefined } set() {} has() { return false } delete() {} } }))
vi.mock('../src/main/database', () => ({ getDb: () => testDb.db, cachedStmt: (_key: string, sql: string) => testDb.db.prepare(sql) }))

import { parseImportFile, executeImport, clearImportCache, normalizeDate, detectDateOrder, analyzeDateOrder, flipLastFirst, buildTable } from '../src/main/import'

let dir: string
beforeEach(() => { testDb = createTestDb(); dir = mkdtempSync(join(tmpdir(), 'pulse-smart-import-')); clearImportCache() })
afterEach(() => { clearImportCache(); cleanupTestDb(testDb); rmSync(dir, { recursive: true, force: true }) })

describe('dates in many formats', () => {
  it.each([
    ['3/5/2026', '2026-03-05'],
    ['03-05-2026', '2026-03-05'],
    ['3.5.2026', '2026-03-05'],
    ['3/5/26', '2026-03-05'],
    ['1/5/75', '1975-01-05'],
    ['2026/03/05', '2026-03-05'],
    ['2026-03-05 14:30:00', '2026-03-05'],
    ['2026-03-05T00:00:00.000Z', '2026-03-05'],
    ['3/5/2026 2:30 PM', '2026-03-05'],
    ['Mar 5, 2026', '2026-03-05'],
    ['March 5th 2026', '2026-03-05'],
    ['5 Mar 2026', '2026-03-05'],
    ['05-Mar-26', '2026-03-05'],
    ['Sept. 30, 2026', '2026-09-30'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeDate(input)).toBe(expected)
  })

  it('reads day-first columns and keeps unreadable values as typed', () => {
    expect(detectDateOrder(['25/03/2026', '04/05/2026'])).toBe('dmy')
    expect(detectDateOrder(['03/25/2026', '04/05/2026'])).toBe('mdy')
    expect(normalizeDate('04/05/2026', 'dmy')).toBe('2026-05-04')
    expect(normalizeDate('25/03/2026')).toBe('2026-03-25')  // only one reading is possible
    expect(normalizeDate('pending')).toBe('pending')
    expect(normalizeDate('2/30/2026')).toBe('2/30/2026')
  })
})

describe('names written last name first', () => {
  it('flips "Last, First" only', () => {
    expect(flipLastFirst('Smith, Jane')).toBe('Jane Smith')
    expect(flipLastFirst("O'Brien, Mary Ann")).toBe("Mary Ann O'Brien")
    expect(flipLastFirst('Jane Smith')).toBe('Jane Smith')
    expect(flipLastFirst('Smith, Jr., John')).toBe('Smith, Jr., John')
  })
})

describe('grouped headers and merged cells', () => {
  it('prefixes group headers and fills merged cells down', () => {
    const raw = [
      ['Client', 'Annual Review', '', 'Program'],
      ['Name', 'Due', 'Done', ''],
      ['Ana', '1/2/2026', 'yes', 'Waiver'],
      ['Ben', '2/3/2026', 'no', ''],
    ]
    const merges = [
      { row: 0, startCol: 1, endCol: 2, anchorRow: 0 },
      { row: 2, startCol: 3, endCol: 3, anchorRow: 2 }, { row: 3, startCol: 3, endCol: 3, anchorRow: 2 },
    ]
    const { headers, allRows } = buildTable(raw, 1, merges)
    expect(headers).toEqual(['Name', 'Annual Review Due', 'Annual Review Done', 'Column 4'])
    expect(allRows[1]![3]).toBe('Waiver')
  })

  it('handles a real Excel sheet with a title row, grouped header and vertical merge', async () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Caseload')
    ws.addRow(['Eastside caseload, updated weekly'])
    ws.mergeCells('A1:E1')
    ws.addRow(['', '', 'Annual Review', '', ''])
    ws.mergeCells('C2:D2')
    ws.addRow(['Name', 'Program', 'Due', 'Done', 'Phone'])
    ws.addRow(['Smith, Jane', 'Waiver', '03/15/2026', 'yes', '555-123-4567'])
    ws.addRow(['Lee, Sam', '', 'Apr 2, 2026', 'no', '555-987-6543'])
    ws.mergeCells('B4:B5')
    const file = join(dir, 'messy.xlsx')
    await wb.xlsx.writeFile(file)

    const preview = await parseImportFile(file)
    expect(preview.detectedHeaderRow).toBe(2)
    expect(preview.headers).toEqual(['Name', 'Program', 'Annual Review Due', 'Annual Review Done', 'Phone'])
    expect(preview.rows[1]![1]).toBe('Waiver')
    expect(preview.detectedColumns[0]!.lastFirstNames).toBe(true)
    expect(preview.detectedColumns[2]!.detectedType).toBe('date')

    const grid = Number(testDb.db.prepare("INSERT INTO grids (name, created_at, updated_at) VALUES ('G', datetime('now'), datetime('now'))").run().lastInsertRowid)
    const result = await executeImport({
      gridId: grid, filePath: file, cleanData: true, duplicateStrategy: 'none', flipLastFirst: true,
      columnMappings: preview.headers.map((_, i) => ({ sourceIndex: i, action: 'create' as const })),
    }, preview)
    expect(result.imported).toBe(2)
    const cells = testDb.db.prepare(`
      SELECT col.name, c.value FROM cells c JOIN columns col ON col.id = c.column_id ORDER BY c.row_id, col.position
    `).all() as Array<{ name: string; value: string }>
    const byName = (n: string) => cells.filter(c => c.name === n).map(c => c.value)
    expect(byName('Name')).toEqual(['Jane Smith', 'Sam Lee'])
    expect(byName('Annual Review Due')).toEqual(['2026-03-15', '2026-04-02'])
    expect(byName('Program')).toEqual(['Waiver', 'Waiver'])
  })

  it('warns about values in a date column that are not dates', async () => {
    const file = join(dir, 'dates.csv')
    writeFileSync(file, 'Name,Next Review\nAna,3/1/2026\nBen,pending\nCy,TBD\n')
    const preview = await parseImportFile(file)
    const grid = Number(testDb.db.prepare("INSERT INTO grids (name, created_at, updated_at) VALUES ('G', datetime('now'), datetime('now'))").run().lastInsertRowid)
    const result = await executeImport({
      gridId: grid, filePath: file, cleanData: true, duplicateStrategy: 'none',
      columnMappings: [{ sourceIndex: 0, action: 'create' }, { sourceIndex: 1, action: 'create', newType: 'date' }],
    }, preview)
    expect(result.warnings.some(w => w.startsWith('2 values in "Next Review"'))).toBe(true)
  })
})

describe('date order that the file doesn\'t settle (F-026)', () => {
  async function importDates(csv: string, dateFormat?: string) {
    if (dateFormat) testDb.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('date_format', ?)").run(dateFormat)
    const file = join(dir, 'order.csv')
    writeFileSync(file, csv)
    const preview = await parseImportFile(file)
    const grid = Number(testDb.db.prepare("INSERT INTO grids (name, created_at, updated_at) VALUES ('G', datetime('now'), datetime('now'))").run().lastInsertRowid)
    const result = await executeImport({
      gridId: grid, filePath: file, cleanData: true, duplicateStrategy: 'none',
      columnMappings: [{ sourceIndex: 0, action: 'create' }, { sourceIndex: 1, action: 'create', newType: 'date' }],
    }, preview)
    const values = (testDb.db.prepare("SELECT c.value FROM cells c JOIN columns col ON col.id = c.column_id WHERE col.name = 'Review' ORDER BY c.row_id").all() as Array<{ value: string }>).map(r => r.value)
    return { warnings: result.warnings, values }
  }

  it('says what it assumed when every date could be read either way', async () => {
    const r = await importDates('Name,Review\nAna,03/04/2026\nBen,05/06/2026\n')
    expect(r.values).toEqual(['2026-03-04', '2026-05-06'])
    expect(r.warnings).toContain('2 dates in "Review" (like 03/04/2026) could be read either way and were read month first, as Settings → Appearance → Date Format says. If your dates are written day first, change Date Format and import again.')
  })

  it('reads them day first under Date Format DD/MM/YYYY, and says so', async () => {
    const r = await importDates('Name,Review\nAna,03/04/2026\nBen,05/06/2026\n', 'eu')
    expect(r.values).toEqual(['2026-04-03', '2026-06-05'])
    expect(r.warnings.some(w => w.includes('were read day first') && w.includes('written month first'))).toBe(true)
  })

  it('says when a column mixes both orders, and how the either-way dates were read', async () => {
    const r = await importDates('Name,Review\nAna,25/03/2026\nBen,26/03/2026\nCy,03/27/2026\nDee,04/05/2026\n')
    expect(r.values).toEqual(['2026-03-25', '2026-03-26', '2026-03-27', '2026-05-04'])
    expect(r.warnings).toContain('"Review" has dates written both day first (like 25/03/2026) and month first (like 03/27/2026). 1 date that could be read either way (like 04/05/2026) was read day first. Check it in the list.')
  })

  it('says nothing when the file settles it', async () => {
    const r = await importDates('Name,Review\nAna,25/03/2026\nBen,04/05/2026\nCy,2026-01-02\n')
    expect(r.values).toEqual(['2026-03-25', '2026-05-04', '2026-01-02'])
    expect(r.warnings.filter(w => w.includes('Review'))).toEqual([])
  })

  it('reports what it saw', () => {
    expect(analyzeDateOrder(['25/03/2026', '03/27/2026', '04/05/2026', '06/06/2026', 'x'], 'mdy')).toEqual({
      order: 'mdy', dayFirst: 1, monthFirst: 1, ambiguous: 1, settledBy: 'fallback',
      examples: { dayFirst: '25/03/2026', monthFirst: '03/27/2026', ambiguous: '04/05/2026' },
    })
    expect(analyzeDateOrder(['25/03/2026', '04/05/2026']).settledBy).toBe('data')
  })
})
