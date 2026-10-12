/**
 * Import robustness (audit batch B3): file encodings, multibyte characters at
 * read boundaries, the row cap, broken quotes, Excel cell shapes, type
 * detection, checkbox values, date-like column types and all-or-nothing imports.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import ExcelJS from 'exceljs'
import { writeFileSync, rmSync, mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createTestDb, cleanupTestDb, type TestDb } from './helpers'

let testDb: TestDb

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
vi.mock('electron-store', () => ({
  default: class { private d = new Map(); get(k: string, dv?: unknown) { return this.d.has(k) ? this.d.get(k) : dv } set(k: string, v?: unknown) { this.d.set(k, v) } has(k: string) { return this.d.has(k) } delete(k: string) { this.d.delete(k) } },
}))
vi.mock('../src/main/database', () => ({
  getDb: () => testDb.db,
  cachedStmt: (_key: string, sql: string) => testDb.db.prepare(sql),
}))

import { parseImportFile, executeImport, clearImportCache, autoMatchColumns, decodeCsvBytes } from '../src/main/import'
import type { ColumnMapping } from '../src/main/import'

let tmpDir: string
beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), 'pulse-import-b3-')); clearImportCache(); testDb = createTestDb() })
afterEach(() => { clearImportCache(); cleanupTestDb(testDb); try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /**/ } })

function writeBytes(name: string, bytes: Buffer): string {
  const p = join(tmpDir, name)
  writeFileSync(p, bytes)
  return p
}
const writeCsv = (name: string, text: string) => writeBytes(name, Buffer.from(text, 'utf-8'))

async function writeXlsx(name: string, setup: (ws: ExcelJS.Worksheet) => void): Promise<string> {
  const wb = new ExcelJS.Workbook()
  setup(wb.addWorksheet('Data'))
  const p = join(tmpDir, name)
  await wb.xlsx.writeFile(p)
  return p
}

function makeGrid(columns: Array<{ name: string; type?: string; isName?: boolean }>): { gridId: number; columnIds: number[] } {
  const gridId = testDb.db.prepare("INSERT INTO grids (name, created_at, updated_at) VALUES ('Import Grid', datetime('now'), datetime('now'))").run().lastInsertRowid as number
  const columnIds = columns.map((c, i) => testDb.db.prepare(
    "INSERT INTO columns (grid_id, name, column_type, position, is_name_column, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))"
  ).run(gridId, c.name, c.type ?? 'text', i, c.isName ? 1 : 0).lastInsertRowid as number)
  return { gridId, columnIds }
}
const cellsOf = (columnId: number) => (testDb.db.prepare('SELECT value FROM cells WHERE column_id = ? ORDER BY row_id').all(columnId) as Array<{ value: string }>).map(r => r.value)
const rowCount = (gridId: number) => (testDb.db.prepare('SELECT COUNT(*) AS c FROM rows WHERE grid_id = ?').get(gridId) as { c: number }).c

// ── Encodings (AUDIT-005) and read boundaries (AUDIT-006) ────────────────────

describe('CSV text encodings', () => {
  it('reads a Windows-1252 file from Excel without replacement characters, and says so', async () => {
    // "José Muñoz", “Quoted” in Windows-1252
    const bytes = Buffer.from([...Buffer.from('Name,Note\nJos'), 0xe9, ...Buffer.from(' Mu'), 0xf1, ...Buffer.from('oz,'), 0x93, ...Buffer.from('Quoted'), 0x94, 0x0a])
    const preview = await parseImportFile(writeBytes('ansi.csv', bytes))
    expect(preview.rows[0]).toEqual(['José Muñoz', '“Quoted”'])
    expect(preview.warnings?.join(' ')).toMatch(/accented letters/)
  })

  it('reads UTF-8 with and without a byte order mark, with no warning', async () => {
    const plain = await parseImportFile(writeCsv('utf8.csv', 'Name\nJosé Núñez\n'))
    expect(plain.headers).toEqual(['Name'])
    expect(plain.rows[0]).toEqual(['José Núñez'])
    expect(plain.warnings ?? []).toEqual([])
    clearImportCache()
    const bom = await parseImportFile(writeBytes('bom.csv', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('Name\nJosé Núñez\n')])))
    expect(bom.headers).toEqual(['Name'])
    expect(bom.rows[0]).toEqual(['José Núñez'])
  })

  it('reads UTF-16 files (little and big endian)', () => {
    const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Name\nJosé\n', 'utf16le')])
    expect(decodeCsvBytes(le).text).toBe('Name\nJosé\n')
    const beBody = Buffer.from('Name\nJosé\n', 'utf16le').swap16()
    expect(decodeCsvBytes(Buffer.concat([Buffer.from([0xfe, 0xff]), beBody])).text).toBe('Name\nJosé\n')
  })

  it('keeps a multibyte character that straddles a 64 KB read boundary', async () => {
    // Pad so that the "é" of the target name starts on byte 65535
    const head = 'Name,Note\n'
    let body = ''
    while (Buffer.byteLength(head + body) < 65535 - 200) body += 'Test Person,filler text here\n'
    const prefix = head + body
    const pad = 65535 - Buffer.byteLength(prefix) - 'Jos'.length - 'Pad '.length - ',n\n'.length
    const line = `Pad ${'x'.repeat(pad)},n\nJosé Núñez,n\n`
    const text = prefix + line
    expect(Buffer.from(text).indexOf(Buffer.from('é'))).toBe(65535)
    const { gridId, columnIds } = makeGrid([{ name: 'Name', isName: true }, { name: 'Note' }])
    const filePath = writeCsv('boundary.csv', text)
    const preview = await parseImportFile(filePath)
    await executeImport({ gridId, filePath, cleanData: true, duplicateStrategy: 'none', columnMappings: [{ sourceIndex: 0, action: columnIds[0]! }, { sourceIndex: 1, action: 'skip' }] }, preview)
    expect(cellsOf(columnIds[0]!)).toContain('José Núñez')
  })
})

// ── Row cap (AUDIT-032) and broken quotes (AUDIT-033) ────────────────────────

describe('CSV structure problems', () => {
  it('says so when a file has more rows than Pulse reads at once', async () => {
    let csv = 'Name\n'
    for (let i = 0; i < 50_100; i++) csv += `P${i}\n`
    const preview = await parseImportFile(writeCsv('big.csv', csv))
    expect(preview.warnings?.join(' ')).toMatch(/50,000/)
  })

  it('a file under the cap has no row-cap warning', async () => {
    const preview = await parseImportFile(writeCsv('small.csv', 'Name\nA\nB\n'))
    expect(preview.warnings ?? []).toEqual([])
  })

  it('stops with a plain message naming the line when a quote is broken', async () => {
    await expect(parseImportFile(writeCsv('quote.csv', 'Name,Phone\nAna,556\n"Bob" Smith,555\nCy,557\n'))).rejects.toThrow(/line 3.*quote/i)
    clearImportCache()
    await expect(parseImportFile(writeCsv('open.csv', 'Name,Phone\nAna,556\n"Bob Smith,555\nCy,557\n'))).rejects.toThrow(/line 3.*quote/i)
  })

  it('properly quoted fields still import', async () => {
    const preview = await parseImportFile(writeCsv('ok.csv', 'Name,Note\n"Smith, Jr.","He said ""hi"""\n'))
    expect(preview.rows[0]).toEqual(['Smith, Jr.', 'He said "hi"'])
  })
})

// ── Date-like column types (AUDIT-007) ───────────────────────────────────────

describe('dates into deadline columns', () => {
  it('stores YYYY-MM-DD in an existing deadline column, and flags what it cannot read', async () => {
    const { gridId, columnIds } = makeGrid([{ name: 'Name', isName: true }, { name: 'Annual review', type: 'deadline' }])
    const filePath = writeCsv('deadline.csv', 'Name,Annual Review\nTest Person,3/15/2026\nTest Two,soon\n')
    const preview = await parseImportFile(filePath)
    const result = await executeImport({ gridId, filePath, cleanData: true, duplicateStrategy: 'none', columnMappings: [{ sourceIndex: 0, action: columnIds[0]! }, { sourceIndex: 1, action: columnIds[1]! }] }, preview)
    expect(cellsOf(columnIds[1]!)).toEqual(['2026-03-15', 'soon'])
    expect(result.warnings.join(' ')).toMatch(/didn't look like a date/)
  })

  it('reads ambiguous dates day-first when the date format setting is day-first', async () => {
    testDb.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('date_format', 'eu')").run()
    const { gridId, columnIds } = makeGrid([{ name: 'Name', isName: true }, { name: 'Start', type: 'date' }, { name: 'Review', type: 'deadline' }])
    const filePath = writeCsv('eu.csv', 'Name,Start,Review\nTest Person,03/04/2026,05/06/2026\n')
    const preview = await parseImportFile(filePath)
    await executeImport({ gridId, filePath, cleanData: true, duplicateStrategy: 'none', columnMappings: [0, 1, 2].map(i => ({ sourceIndex: i, action: columnIds[i]! })) }, preview)
    expect(cellsOf(columnIds[1]!)).toEqual(['2026-04-03'])
    expect(cellsOf(columnIds[2]!)).toEqual(['2026-06-05'])
  })

  it('a column that settles the order itself wins over the setting', async () => {
    testDb.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('date_format', 'eu')").run()
    const { gridId, columnIds } = makeGrid([{ name: 'Name', isName: true }, { name: 'Start', type: 'date' }])
    const filePath = writeCsv('us.csv', 'Name,Start\nTest Person,03/04/2026\nTest Two,03/25/2026\n')
    const preview = await parseImportFile(filePath)
    await executeImport({ gridId, filePath, cleanData: true, duplicateStrategy: 'none', columnMappings: [0, 1].map(i => ({ sourceIndex: i, action: columnIds[i]! })) }, preview)
    expect(cellsOf(columnIds[1]!)).toEqual(['2026-03-04', '2026-03-25'])
  })
})

// ── Type detection (AUDIT-028) and checkbox values (AUDIT-031) ───────────────

describe('column type detection', () => {
  it('plain whole numbers are not money', async () => {
    const preview = await parseImportFile(writeCsv('nums.csv', 'Household size,Count\n3,42\n5,17\n2,103\n'))
    expect(preview.detectedColumns.map(c => c.detectedType)).toEqual(['number', 'number'])
  })

  it('zip codes and IDs stay text, keeping leading zeros', async () => {
    const preview = await parseImportFile(writeCsv('ids.csv', 'Zip,Client ID,Code\n60614,10423,0042\n10001,20877,0105\n'))
    expect(preview.detectedColumns.map(c => c.detectedType)).toEqual(['text', 'text', 'text'])
  })

  it('a dollar sign or a consistent two-decimal amount is money', async () => {
    const preview = await parseImportFile(writeCsv('money.csv', 'Fee,Balance\n$40,12.50\n"$1,200",3.00\n'))
    expect(preview.detectedColumns.map(c => c.detectedType)).toEqual(['currency', 'currency'])
  })

  it('a 1/0 column is a checkbox, and Y/N is too', async () => {
    const preview = await parseImportFile(writeCsv('flags.csv', 'Active,Consent\n1,Y\n0,N\n1,y\n'))
    expect(preview.detectedColumns.map(c => c.detectedType)).toEqual(['checkbox', 'checkbox'])
  })
})

describe('values into checkbox and money columns', () => {
  it('reads Y, Done, check marks and Checked as ticked, and flags values it cannot read', async () => {
    const { gridId, columnIds } = makeGrid([{ name: 'Name', isName: true }, { name: 'Consent', type: 'checkbox' }])
    const values = ['Y', 'Done', '✓', '✔', 'Checked', 'Complete', 'N', 'no', 'maybe']
    const filePath = writeCsv('checks.csv', 'Name,Consent\n' + values.map((v, i) => `Test ${i},${v}`).join('\n') + '\n')
    const preview = await parseImportFile(filePath)
    const result = await executeImport({ gridId, filePath, cleanData: true, duplicateStrategy: 'none', columnMappings: [0, 1].map(i => ({ sourceIndex: i, action: columnIds[i]! })) }, preview)
    expect(cellsOf(columnIds[1]!)).toEqual(['true', 'true', 'true', 'true', 'true', 'true', 'false', 'false', 'false'])
    expect(result.warnings.join(' ')).toMatch(/1 value in "Consent" wasn't clearly yes or no/)
  })

  it('money: other currency signs, accounting negatives and comma decimals', async () => {
    const { gridId, columnIds } = makeGrid([{ name: 'Name', isName: true }, { name: 'Amount', type: 'currency' }])
    const filePath = writeCsv('amounts.csv', 'Name,Amount\nA,"$1,234.50"\nB,(50.00)\nC,€12.00\nD,"1.234,56"\n')
    const preview = await parseImportFile(filePath)
    await executeImport({ gridId, filePath, cleanData: true, duplicateStrategy: 'none', columnMappings: [0, 1].map(i => ({ sourceIndex: i, action: columnIds[i]! })) }, preview)
    expect(cellsOf(columnIds[1]!)).toEqual(['1234.50', '-50.00', '12.00', '1234.56'])
  })
})

// ── Excel cell shapes (AUDIT-029) and number formats (AUDIT-030) ─────────────

describe('Excel cells', () => {
  it('error, formula, rich-text hyperlink cells never come in as [object Object]', async () => {
    const filePath = await writeXlsx('shapes.xlsx', ws => {
      ws.addRow(['Name', 'Err', 'Formula err', 'No result', 'Link', 'Plain link'])
      ws.getCell('A2').value = 'Test Person'
      ws.getCell('B2').value = { error: '#N/A' } as ExcelJS.CellErrorValue
      ws.getCell('C2').value = { formula: '1/0', result: { error: '#DIV/0!' } } as ExcelJS.CellFormulaValue
      ws.getCell('D2').value = { formula: 'A2' } as ExcelJS.CellFormulaValue
      ws.getCell('E2').value = { text: { richText: [{ text: 'Site ' }, { text: 'page' }] }, hyperlink: 'https://example.org' } as unknown as ExcelJS.CellHyperlinkValue
      ws.getCell('F2').value = { text: 'Example', hyperlink: 'https://example.org' }
    })
    const preview = await parseImportFile(filePath)
    const row = preview.rows[0]!
    expect(row.join('|')).not.toMatch(/object/)
    expect(row).toEqual(['Test Person', '', '', '', 'Site page', 'Example'])
    const w = (preview.warnings ?? []).join(' ')
    expect(w).toMatch(/2 cells showed a spreadsheet error/)
    expect(w).toMatch(/1 formula had no saved value/)
  })

  it('time-only cells become a time, not 1899-12-30', async () => {
    const filePath = await writeXlsx('time.xlsx', ws => {
      ws.addRow(['Name', 'Visit time', 'Clock'])
      ws.addRow(['Test Person', new Date(Date.UTC(1899, 11, 30, 9, 30)), new Date(Date.UTC(1899, 11, 30, 14, 5))])
      ws.getCell('B2').numFmt = 'h:mm AM/PM'
      ws.getCell('C2').numFmt = 'hh:mm'
    })
    const preview = await parseImportFile(filePath)
    expect(preview.rows[0]).toEqual(['Test Person', '9:30 AM', '14:05'])
    expect(preview.detectedColumns[1]!.detectedType).not.toBe('date')
  })

  it('in a 1904-date-system workbook, a time-only cell is a time and dates stay right (A21b-08)', async () => {
    const wb = new ExcelJS.Workbook()
    wb.properties.date1904 = true
    const ws = wb.addWorksheet('Data')
    ws.addRow(['Name', 'Visit time', 'Seen on'])
    ws.addRow(['Test Person', new Date(Date.UTC(1904, 0, 1, 9, 30)), new Date(Date.UTC(2026, 9, 11))])
    ws.getCell('B2').numFmt = 'h:mm AM/PM'
    ws.getCell('C2').numFmt = 'yyyy-mm-dd'
    const filePath = join(tmpDir, 'mac1904.xlsx')
    await wb.xlsx.writeFile(filePath)
    const preview = await parseImportFile(filePath)
    expect(preview.rows[0]).toEqual(['Test Person', '9:30 AM', '2026-10-11'])
  })

  it('leading-zero and percent formats keep what the sheet shows', async () => {
    const filePath = await writeXlsx('fmt.xlsx', ws => {
      ws.addRow(['Name', 'Zip', 'Share', 'Rate'])
      ws.addRow(['Test Person', 2139, 0.25, 0.125])
      ws.getCell('B2').numFmt = '00000'
      ws.getCell('C2').numFmt = '0%'
      ws.getCell('D2').numFmt = '0.0%'
    })
    const preview = await parseImportFile(filePath)
    expect(preview.rows[0]).toEqual(['Test Person', '02139', '25%', '12.5%'])
    expect(preview.detectedColumns[1]!.detectedType).toBe('text')
  })
})

// ── Computed columns as targets (AUDIT-124) ──────────────────────────────────

describe('columns Pulse works out itself', () => {
  it('are never auto-matched, and a mapping to one is skipped', async () => {
    const { gridId, columnIds } = makeGrid([{ name: 'Name', isName: true }, { name: 'Age', type: 'age_from_dob' }, { name: 'Days until', type: 'calculated_days' }, { name: 'Number', type: 'auto_number' }])
    const mappings = autoMatchColumns(gridId, ['Name', 'Age', 'Days until', 'Number'])
    expect(mappings.map(m => m.action)).toEqual([columnIds[0], 'create', 'create', columnIds[3]])
    const filePath = writeCsv('computed.csv', 'Name,Age\nTest Person,44\n')
    const preview = await parseImportFile(filePath)
    const forced: ColumnMapping[] = [{ sourceIndex: 0, action: columnIds[0]! }, { sourceIndex: 1, action: columnIds[1]! }]
    await executeImport({ gridId, filePath, cleanData: true, duplicateStrategy: 'none', columnMappings: forced }, preview)
    expect(cellsOf(columnIds[1]!)).toEqual([])
    expect(rowCount(gridId)).toBe(1)
  })
})
