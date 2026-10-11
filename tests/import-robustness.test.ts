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
