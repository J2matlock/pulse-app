/**
 * Import side of two export/import decisions:
 * - AUDIT-037: CSV exports guard formula-looking text with a leading apostrophe
 *   ('=1+1); Pulse's own import takes exactly that apostrophe off again.
 * - AUDIT-127: rows and columns hidden in an Excel sheet are counted in the
 *   preview and import by default; "Leave out hidden rows" drops the rows.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import ExcelJS from 'exceljs'
import { writeFileSync, rmSync, mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'

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
  app: {
    isPackaged: false,
    getPath: () => join(tmpdir(), 'pulse-test-mock'),
    whenReady: () => Promise.resolve(),
    commandLine: { appendSwitch: () => {} },
  },
  ipcMain: { handle: () => {} },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  dialog: { showMessageBoxSync: () => 0 },
}))

import { parseImportFile, executeImport, clearImportCache } from '../src/main/import'
import { exportCsv } from '../src/main/export-csv'

let tmpDir: string
beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), 'pulse-import-guard-')); clearImportCache(); testDb = createTestDb() })
afterEach(() => { clearImportCache(); cleanupTestDb(testDb); try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /**/ } })

function makeGrid(names: string[]): { gridId: number; columnIds: number[] } {
  const gridId = testDb.db.prepare("INSERT INTO grids (name, created_at, updated_at) VALUES ('Import Grid', datetime('now'), datetime('now'))").run().lastInsertRowid as number
  const columnIds = names.map((n, i) => testDb.db.prepare(
    "INSERT INTO columns (grid_id, name, column_type, position, is_name_column, created_at) VALUES (?, ?, 'text', ?, ?, datetime('now'))",
  ).run(gridId, n, i, i === 0 ? 1 : 0).lastInsertRowid as number)
  return { gridId, columnIds }
}
const cellsOf = (columnId: number) => (testDb.db.prepare('SELECT c.value FROM cells c JOIN rows r ON r.id = c.row_id WHERE c.column_id = ? ORDER BY r.position, r.id').all(columnId) as Array<{ value: string }>).map(r => r.value)

async function importInto(filePath: string, gridId: number, columnIds: number[], extra: { skipHiddenRows?: boolean; cleanData?: boolean } = {}) {
  const preview = await parseImportFile(filePath)
  return executeImport({
    gridId, filePath, cleanData: extra.cleanData ?? false, duplicateStrategy: 'none', skipHiddenRows: extra.skipHiddenRows,
    columnMappings: columnIds.map((id, i) => ({ sourceIndex: i, action: id })),
  }, preview)
}

async function writeXlsx(name: string, setup: (ws: ExcelJS.Worksheet) => void): Promise<string> {
  const wb = new ExcelJS.Workbook()
  setup(wb.addWorksheet('Data'))
  const p = join(tmpDir, name)
  await wb.xlsx.writeFile(p)
  return p
}

describe('CSV formula guard round trip (AUDIT-037)', () => {
  // Text a user could type that the export guards, plus apostrophe names it must leave alone.
  // (Import always trims surrounding spaces, so a value starting with a TAB is covered by the unit tests.)
  const values = ['=1+1', '+1 555 0100', '-', '@home', "'Til", "'=typed with apostrophe", 'Test Person', "O'Brien", 'line one\n=line two']

  it("exports with a leading apostrophe and imports back to exactly what was typed", async () => {
    const { gridId, columnIds, rowIds } = seedGrid(testDb.db, { rowCount: values.length, columnCount: 2 })
    testDb.db.prepare("UPDATE columns SET name = 'Name' WHERE id = ?").run(columnIds[0])
    testDb.db.prepare("UPDATE columns SET name = '=Odd header' WHERE id = ?").run(columnIds[1])
    const insert = testDb.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
    values.forEach((v, i) => {
      insert.run(rowIds[i], columnIds[0], `Test Person ${i}`)
      insert.run(rowIds[i], columnIds[1], v)
    })
    const filePath = join(tmpDir, 'export.csv')
    await exportCsv({ gridId, columnIds: [], activeRowIds: [], destPath: filePath, dateFormat: 'iso' })

    const preview = await parseImportFile(filePath)
    expect(preview.headers).toEqual(['Name', '=Odd header'])
    const target = makeGrid(['Name', 'Value'])
    const result = await executeImport({
      gridId: target.gridId, filePath, cleanData: false, duplicateStrategy: 'none',
      columnMappings: [{ sourceIndex: 0, action: target.columnIds[0]! }, { sourceIndex: 1, action: target.columnIds[1]! }],
    }, preview)
    expect(result.imported).toBe(values.length)
    expect(cellsOf(target.columnIds[1]!)).toEqual(values)
  })

  it("strips one apostrophe only before = + - @ TAB CR, in CSV and Excel files", async () => {
    const csv = join(tmpDir, 'guarded.csv')
    writeFileSync(csv, "Name,Note\n'=1+1,'Til\n'@x,''=y\n'hello,'-5\n", 'utf-8')
    const a = makeGrid(['Name', 'Note'])
    await importInto(csv, a.gridId, a.columnIds)
    expect(cellsOf(a.columnIds[0]!)).toEqual(['=1+1', '@x', "'hello"])
    expect(cellsOf(a.columnIds[1]!)).toEqual(["'Til", "'=y", '-5'])

    clearImportCache()
    const xlsx = await writeXlsx('guarded.xlsx', ws => {
      ws.addRow(['Name', 'Note'])
      ws.addRow(["'=1+1", "'Til"])
      ws.addRow(["'+1 555 0100", 'plain'])
    })
    const b = makeGrid(['Name', 'Note'])
    await importInto(xlsx, b.gridId, b.columnIds)
    expect(cellsOf(b.columnIds[0]!)).toEqual(['=1+1', '+1 555 0100'])
    expect(cellsOf(b.columnIds[1]!)).toEqual(["'Til", 'plain'])
  })
})

describe('hidden Excel rows and columns (AUDIT-127)', () => {
  async function sheetWithHidden(): Promise<string> {
    return writeXlsx('hidden.xlsx', ws => {
      ws.addRow(['Name', 'Status', 'Old code'])
      ws.addRow(['Test Person A', 'Active', 'x1'])
      ws.addRow(['Test Person B', 'Closed', 'x2'])
      ws.addRow(['Test Person C', 'Active', 'x3'])
      ws.addRow(['Test Person D', 'Closed', 'x4'])
      ws.getRow(3).hidden = true
      ws.getRow(5).hidden = true
      ws.getColumn(3).hidden = true
    })
  }

  it('counts hidden rows and names hidden columns in the preview', async () => {
    const preview = await parseImportFile(await sheetWithHidden())
    expect(preview.rows).toHaveLength(4)
    expect(preview.hiddenRowCount).toBe(2)
    expect(preview.hiddenColumns).toEqual(['Old code'])
  })

  it('reports none for a sheet with nothing hidden, and for CSV', async () => {
    const plain = await writeXlsx('plain.xlsx', ws => { ws.addRow(['Name']); ws.addRow(['Test Person']) })
    const preview = await parseImportFile(plain)
    expect(preview.hiddenRowCount).toBe(0)
    expect(preview.hiddenColumns).toEqual([])
    clearImportCache()
    const csv = join(tmpDir, 'plain.csv')
    writeFileSync(csv, 'Name\nTest Person\n', 'utf-8')
    expect((await parseImportFile(csv)).hiddenRowCount).toBe(0)
  })

  it('imports hidden rows by default', async () => {
    const g = makeGrid(['Name', 'Status', 'Old code'])
    const result = await importInto(await sheetWithHidden(), g.gridId, g.columnIds)
    expect(result.imported).toBe(4)
    expect(cellsOf(g.columnIds[0]!)).toEqual(['Test Person A', 'Test Person B', 'Test Person C', 'Test Person D'])
  })

  it('leaves hidden rows out when asked, and says so', async () => {
    const g = makeGrid(['Name', 'Status', 'Old code'])
    const result = await importInto(await sheetWithHidden(), g.gridId, g.columnIds, { skipHiddenRows: true })
    expect(result.imported).toBe(2)
    expect(cellsOf(g.columnIds[0]!)).toEqual(['Test Person A', 'Test Person C'])
    expect(result.warnings.join(' ')).toMatch(/Left out 2 rows hidden in the spreadsheet/)
  })

  it('counts hidden rows below a header row that is not the first row', async () => {
    const file = await writeXlsx('titled.xlsx', ws => {
      ws.addRow(['Caseload export'])
      ws.addRow(['Name', 'Status'])
      ws.addRow(['Test Person A', 'Active'])
      ws.addRow(['Test Person B', 'Closed'])
      ws.getRow(4).hidden = true
    })
    const preview = await parseImportFile(file, 0, 1)
    expect(preview.headers).toEqual(['Name', 'Status'])
    expect(preview.hiddenRowCount).toBe(1)
    const g = makeGrid(['Name', 'Status'])
    const result = await executeImport({
      gridId: g.gridId, filePath: file, cleanData: true, duplicateStrategy: 'none', headerRowIndex: 1, skipHiddenRows: true,
      columnMappings: [{ sourceIndex: 0, action: g.columnIds[0]! }, { sourceIndex: 1, action: g.columnIds[1]! }],
    }, preview)
    expect(result.imported).toBe(1)
    expect(cellsOf(g.columnIds[0]!)).toEqual(['Test Person A'])
  })
})
