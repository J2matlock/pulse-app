/**
 * Import that just works (UX Q1a): the messy spreadsheets people really have.
 * A merged title row and a merged group row above the column names, dates
 * typed three ways with "TBD" and "n/a" between them, blank lines, very long
 * notes, a "Total" line at the bottom, first and last names apart, and a list
 * that already has a Phone column. Fixtures are built here with ExcelJS and
 * CSV strings.
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

import {
  parseImportFile, executeImport, clearImportCache, autoMatchColumns, totalsRowLabel, isDatePlaceholder, DATE_PLACEHOLDERS,
  type ColumnMapping, type ImportPreview,
} from '../src/main/import'

let dir: string
beforeEach(() => { testDb = createTestDb(); dir = mkdtempSync(join(tmpdir(), 'pulse-messy-import-')); clearImportCache() })
afterEach(() => { clearImportCache(); cleanupTestDb(testDb); rmSync(dir, { recursive: true, force: true }) })

function newGrid(columns: Array<{ name: string; type?: string; isName?: boolean }> = []): { gridId: number; columnIds: number[] } {
  const gridId = Number(testDb.db.prepare("INSERT INTO grids (name, created_at, updated_at) VALUES ('Caseload', datetime('now'), datetime('now'))").run().lastInsertRowid)
  const columnIds = columns.map((c, i) => Number(testDb.db.prepare(
    "INSERT INTO columns (grid_id, name, column_type, position, is_name_column, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))",
  ).run(gridId, c.name, c.type ?? 'text', i, c.isName ? 1 : 0).lastInsertRowid))
  return { gridId, columnIds }
}

function valuesOf(columnName: string): string[] {
  return (testDb.db.prepare(`
    SELECT c.value FROM cells c JOIN columns col ON col.id = c.column_id WHERE col.name = ? ORDER BY c.row_id
  `).all(columnName) as Array<{ value: string }>).map(r => r.value)
}

/** The wizard's quick path: every column into a new column, or the existing one autoMatch found */
function quickMappings(gridId: number, preview: ImportPreview): ColumnMapping[] {
  return autoMatchColumns(gridId, preview.headers).map((m, i) => m.action === 'create'
    ? { ...m, newType: preview.detectedColumns[i]!.detectedType }
    : m)
}

const LONG_NOTE = 'Met at home. '.repeat(160).trim() // ~2,000 characters
const TOO_LONG_NOTE = 'x'.repeat(12_000)

/** A caseload the way agencies keep it: titles, groups, three date styles, gaps and a total */
async function messyWorkbook(): Promise<string> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Caseload')
  ws.addRow(['Eastside caseload — updated weekly'])
  ws.mergeCells('A1:G1')
  ws.addRow(['Client', '', '', 'Contact', '', '', ''])
  ws.mergeCells('A2:B2')
  ws.mergeCells('D2:E2')
  ws.addRow(['First Name', 'Last Name', 'Annual review', 'Phone', 'Email', 'Case notes', 'Hours'])
  ws.addRow(['Maria', 'Garcia', '3/4/2026', '555-123-4567', 'maria@example.org', 'Called about housing', 2])
  ws.addRow(['Sam', 'Lee', 'March 4, 2026', '555-987-6543', 'sam@example.org', LONG_NOTE, 1])
  ws.addRow([])
  ws.addRow(['Ana', 'Ruiz', '2026-03-04', '555-222-3333', 'ana@example.org', 'Prefers mornings', 3])
  ws.addRow(['Bo', 'Chen', 'TBD', '555-444-5555', 'bo@example.org', TOO_LONG_NOTE, 1])
  ws.addRow([])
  ws.addRow(['Cy', 'Diaz', 'n/a', '555-666-7777', 'cy@example.org', '', 2])
  ws.addRow(['Dee', 'Ford', '', '555-888-9999', 'dee@example.org', 'New this month', 4])
  ws.addRow(['Total', '', '', '', '', '', 13])
  const file = join(dir, 'caseload_export.xlsx')
  await wb.xlsx.writeFile(file)
  return file
}

describe('placeholders in date columns', () => {
  it('knows the common ones, whatever their case or spacing', () => {
    for (const v of ['TBD', ' tba ', 'N/A', 'na', 'None', '-', '—', '?', 'Pending', 'unknown', 'Not yet', 'waiting', 'X']) {
      expect(isDatePlaceholder(v)).toBe(true)
    }
    expect(isDatePlaceholder('next spring')).toBe(false)
    expect(DATE_PLACEHOLDERS.has('tbd')).toBe(true)
  })

  it('the preview hands over a date column\'s dates as they will be stored, for "due or done?" (R4)', async () => {
    const file = join(dir, 'dates.csv')
    writeFileSync(file, 'Name,Plan Review\nAl,3/14/2026\nBea,TBD\nCal,2026-05-01\nDot,\nEd,June 2 2026\n')
    const preview = await parseImportFile(file)
    expect(preview.detectedColumns[1]!.dateValues).toEqual(['2026-03-14', '2026-05-01', '2026-06-02'])
    expect(preview.detectedColumns[0]!.dateValues).toBeUndefined()
  })

  it('"TBD" and "n/a" keep a column a date column, and are kept as typed', async () => {
    const file = join(dir, 'tbd.csv')
    writeFileSync(file, 'Name,Annual review\nAl,3/14/2026\nBea,TBD\nCal,2026-05-01\nDot,n/a\nEd,June 2 2026\n')
    const preview = await parseImportFile(file)
    expect(preview.detectedColumns[1]!.detectedType).toBe('date')
    expect(preview.detectedColumns[1]!.placeholders).toEqual({ count: 2, example: 'TBD' })
    const { gridId } = newGrid()
    const result = await executeImport({ gridId, filePath: file, cleanData: true, duplicateStrategy: 'none', columnMappings: quickMappings(gridId, preview) }, preview)
    expect(valuesOf('Annual review')).toEqual(['2026-03-14', 'TBD', '2026-05-01', 'n/a', '2026-06-02'])
    expect(result.placeholderDates).toEqual([{ column: 'Annual review', count: 2, example: 'TBD' }])
    // Said once, in the summary's words, not again as a "check this" warning
    expect(result.warnings.filter(w => w.includes('Annual review'))).toEqual([])
  })

  it('one typo among many dates no longer makes the column text (80% rule)', async () => {
    const rows = Array.from({ length: 9 }, (_, i) => `P${i},3/${i + 1}/2026`).concat(['P9,sometime'])
    const file = join(dir, 'typo.csv')
    writeFileSync(file, `Name,Seen\n${rows.join('\n')}\n`)
    const preview = await parseImportFile(file)
    expect(preview.detectedColumns[1]!.detectedType).toBe('date')
  })

  it('a notes column that mentions a few dates stays text', async () => {
    const file = join(dir, 'mentions.csv')
    writeFileSync(file, 'Name,Remarks\nAl,Seen 3/4/2026 at home\nBea,3/5/2026\nCal,Moved in May\nDot,Call back\nEd,Fine\n')
    const preview = await parseImportFile(file)
    expect(preview.detectedColumns[1]!.detectedType).not.toBe('date')
  })

  it('a column of only placeholders is not a date column', async () => {
    const file = join(dir, 'only.csv')
    writeFileSync(file, 'Name,Next step\nAl,TBD\nBea,pending\n')
    const preview = await parseImportFile(file)
    expect(preview.detectedColumns[1]!.detectedType).toBe('text')
  })
})

describe('types read from more than the first five values', () => {
  it('a date column whose first five values are blank-ish is still found', async () => {
    const rows = ['A,TBD', 'B,TBD', 'C,?', 'D,pending', 'E,TBD', 'F,3/4/2026', 'G,3/5/2026', 'H,4/1/2026']
    const file = join(dir, 'late.csv')
    writeFileSync(file, `Name,Plan of care\n${rows.join('\n')}\n`)
    const preview = await parseImportFile(file)
    expect(preview.detectedColumns[1]!.detectedType).toBe('date')
    // The preview still shows five samples
    expect(preview.detectedColumns[1]!.samples).toHaveLength(5)
  })

  it('a number column with a word in row 7 is text, not a number that loses it', async () => {
    const rows = ['A,1', 'B,2', 'C,3', 'D,4', 'E,5', 'F,6', 'G,several']
    const file = join(dir, 'count.csv')
    writeFileSync(file, `Name,Household\n${rows.join('\n')}\n`)
    const preview = await parseImportFile(file)
    expect(preview.detectedColumns[1]!.detectedType).toBe('text')
  })
})

describe('long text becomes a notes column', () => {
  it('by its header, by long values, and by average length', async () => {
    const long = 'a'.repeat(320)
    const medium = 'Talked through the plan and next steps with the family at length today.'.padEnd(95, '.')
    const file = join(dir, 'notes.csv')
    writeFileSync(file, `Name,Progress notes,Summary,Goal,Code\nAl,ok,${long},${medium},A1\nBea,fine,short,${medium},B2\n`)
    const preview = await parseImportFile(file)
    expect(preview.detectedColumns.map(c => c.detectedType)).toEqual(['text', 'notes', 'notes', 'notes', 'text'])
  })
})

describe('a "Total" line at the bottom', () => {
  it('is recognised only with numbers or blanks beside it', () => {
    expect(totalsRowLabel([['Al', '2'], ['Total', '13']])).toBe('Total')
    expect(totalsRowLabel([['Al', '2'], ['', 'TOTALS', '$1,200.50', '']])).toBe('TOTALS')
    expect(totalsRowLabel([['Al', '2'], ['Grand total', '']])).toBe('Grand total')
    expect(totalsRowLabel([['Al', '2'], ['Total Care Inc', 'Main St']])).toBeNull()
    expect(totalsRowLabel([['Al', '2'], ['Totally fine', '1']])).toBeNull()
    expect(totalsRowLabel([['Total', '2']])).toBeNull()
  })

  it('is left out of the import, with a warning that says so', async () => {
    const file = join(dir, 'total.csv')
    writeFileSync(file, 'Name,Hours\nAl,2\nBea,3\nTotal,5\n')
    const preview = await parseImportFile(file)
    expect(preview.dataRowCount).toBe(2)
    expect(preview.warnings).toContain('Left out the "Total" line at the bottom of the sheet. It adds up the lines above it, so it isn\'t one of them.')
    const { gridId } = newGrid()
    const result = await executeImport({ gridId, filePath: file, cleanData: true, duplicateStrategy: 'none', columnMappings: quickMappings(gridId, preview) }, preview)
    expect(result.imported).toBe(2)
    expect(valuesOf('Name')).toEqual(['Al', 'Bea'])
  })
})

describe('the whole messy workbook', () => {
  it('finds the real column names under a merged title and group row', async () => {
    const preview = await parseImportFile(await messyWorkbook())
    expect(preview.detectedHeaderRow).toBe(2)
    expect(preview.headerDetectionConfidence).not.toBe('low')
    expect(preview.headers).toEqual(['Client First Name', 'Client Last Name', 'Annual review', 'Contact Phone', 'Contact Email', 'Case notes', 'Hours'])
    expect(preview.dataRowCount).toBe(6)
    const types = Object.fromEntries(preview.detectedColumns.map(c => [c.originalName, c.detectedType]))
    expect(types).toMatchObject({ 'Annual review': 'date', 'Contact Phone': 'phone', 'Contact Email': 'email', 'Case notes': 'notes', Hours: 'number' })
  })

  it('imports every record once, with dates read all three ways, names together and long notes kept', async () => {
    const file = await messyWorkbook()
    const preview = await parseImportFile(file)
    const { gridId, columnIds } = newGrid([{ name: 'Name', isName: true }, { name: 'Phone', type: 'phone' }])
    const mappings = quickMappings(gridId, preview)
    // The list's own Phone column is matched, not doubled
    expect(mappings[3]!.action).toBe(columnIds[1])
    // What the quick path does with first and last name columns: first into the name, last left out
    mappings[0] = { sourceIndex: 0, action: columnIds[0]! }
    mappings[1] = { sourceIndex: 1, action: 'skip' }
    const result = await executeImport({
      gridId, filePath: file, cleanData: true, duplicateStrategy: 'none', columnMappings: mappings,
      combineNames: { firstIndex: 0, lastIndex: 1 },
    }, preview)

    expect(result.imported).toBe(6)
    expect(valuesOf('Name')).toEqual(['Maria Garcia', 'Sam Lee', 'Ana Ruiz', 'Bo Chen', 'Cy Diaz', 'Dee Ford'])
    expect(valuesOf('Annual review')).toEqual(['2026-03-04', '2026-03-04', '2026-03-04', 'TBD', 'n/a'])
    expect(valuesOf('Phone')).toHaveLength(6)
    const notes = valuesOf('Case notes')
    expect(notes).toContain(LONG_NOTE)
    expect(notes.find(n => n.startsWith('xxx'))).toHaveLength(10_000)
    expect(result.warnings.some(w => w.includes('"Case notes"') && w.includes('cut short'))).toBe(true)
    expect(result.warnings.some(w => w.startsWith('Left out the "Total" line'))).toBe(true)

    // Enough for the summary to describe what happened
    expect(result.combinedNames).toBe(true)
    expect(result.headerRow).toBe(2)
    expect(result.placeholderDates).toEqual([{ column: 'Annual review', count: 2, example: 'TBD' }])
    const byName = Object.fromEntries(result.columns.map(c => [c.name, c]))
    expect(byName['Phone']).toMatchObject({ sourceIndex: 3, id: columnIds[1], created: false, type: 'phone' })
    expect(byName['Annual review']).toMatchObject({ sourceIndex: 2, type: 'date', created: true })
    expect(byName['Case notes']).toMatchObject({ type: 'notes', created: true })
  })

  it('names the sheet it read and the names it turned around', async () => {
    const wb = new ExcelJS.Workbook()
    wb.addWorksheet('Notes').addRow(['just a note'])
    const ws = wb.addWorksheet('Clients')
    ws.addRow(['Name', 'Phone', 'Seen'])
    ws.addRow(['Garcia, Maria', '555-123-4567', '3/4/2026'])
    ws.addRow(['Lee, Sam', '555-987-6543', '3/5/2026'])
    const file = join(dir, 'two-sheets.xlsx')
    await wb.xlsx.writeFile(file)
    const preview = await parseImportFile(file, 1)
    expect(preview.sheets).toEqual(['Notes', 'Clients'])
    const { gridId } = newGrid()
    const result = await executeImport({
      gridId, filePath: file, sheetName: 'Clients', cleanData: true, duplicateStrategy: 'none', flipLastFirst: true,
      columnMappings: quickMappings(gridId, preview),
    }, preview)
    expect(result.sheetName).toBe('Clients')
    expect(result.flippedColumns).toEqual(['Name'])
    expect(valuesOf('Name')).toEqual(['Maria Garcia', 'Sam Lee'])
  })

  it('a notes column first in the file never becomes the name', async () => {
    const file = join(dir, 'notes-first.csv')
    writeFileSync(file, `Case notes,Name\n${'a'.repeat(400)},Al\nshort,Bea\n`)
    const preview = await parseImportFile(file)
    const { gridId, columnIds } = newGrid([{ name: 'Client', isName: true }])
    await executeImport({
      gridId, filePath: file, cleanData: true, duplicateStrategy: 'none',
      columnMappings: [{ sourceIndex: 0, action: 'create', newType: 'notes' }, { sourceIndex: 1, action: 'create', newType: 'text' }],
    }, preview)
    const named = testDb.db.prepare('SELECT name, column_type FROM columns WHERE grid_id = ? AND is_name_column = 1').get(gridId) as { name: string; column_type: string }
    expect(named).toEqual({ name: 'Name', column_type: 'text' })
    expect(testDb.db.prepare('SELECT id FROM columns WHERE id = ?').get(columnIds[0])).toBeUndefined()
  })
})
