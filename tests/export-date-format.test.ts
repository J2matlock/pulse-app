/**
 * Date cells in the list PDF and the summary report's roster follow
 * Settings → Date format (X-20, Q-076), whichever format is chosen.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'

let testDb: TestDb
type Db = typeof import('../src/main/database')
let realBuildGridQuery: Db['buildGridQuery']
vi.mock('../src/main/database', () => ({
  getDb: () => testDb.db,
  cachedStmt: (_key: string, sql: string) => testDb.db.prepare(sql),
  buildGridQuery: (...args: Parameters<Db['buildGridQuery']>) => realBuildGridQuery(...args),
}))
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp/pulse-test-export-dates', commandLine: { appendSwitch: () => {} } },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  dialog: { showMessageBoxSync: () => 0 },
}))

/** The body of every table drawn into a PDF */
const tables: unknown[][][] = []
vi.mock('../src/main/export-shared', async () => {
  const actual = await vi.importActual<typeof import('../src/main/export-shared')>('../src/main/export-shared')
  return {
    ...actual,
    autoTable: (doc: Parameters<typeof actual.autoTable>[0], opts: Parameters<typeof actual.autoTable>[1]) => {
      tables.push((opts as { body?: unknown[][] }).body ?? [])
      actual.autoTable(doc, opts)
    },
  }
})

import { exportPdfGrid } from '../src/main/export-pdf'
import { exportSupervisorReport } from '../src/main/export-supervisor'

beforeAll(async () => {
  realBuildGridQuery = (await vi.importActual<Db>('../src/main/database')).buildGridQuery
})

let gridId: number, nameCol: number, dateCol: number
beforeEach(() => {
  testDb = createTestDb()
  tables.length = 0
  const g = seedGrid(testDb.db, { rowCount: 2, columnTypes: ['text', 'date'] })
  ;({ gridId } = g)
  ;[nameCol, dateCol] = g.columnIds as [number, number]
  testDb.db.prepare("UPDATE columns SET name = 'Name', is_name_column = 1 WHERE id = ?").run(nameCol)
  testDb.db.prepare("UPDATE columns SET name = 'Start date' WHERE id = ?").run(dateCol)
  const cell = testDb.db.prepare('INSERT OR REPLACE INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
  g.rowIds.forEach((rowId, i) => {
    cell.run(rowId, nameCol, `Person ${i + 1}`)
    cell.run(rowId, dateCol, `2026-03-0${i + 5}`)
  })
})
afterEach(() => cleanupTestDb(testDb))

const setFormat = (f: string) => testDb.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('date_format', ?)").run(f)
const EXPECTED = { us: ['03/05/2026', '03/06/2026'], eu: ['05/03/2026', '06/03/2026'], iso: ['2026-03-05', '2026-03-06'] } as const

describe.each(['us', 'eu', 'iso'] as const)('date format %s', (format) => {
  it('the list PDF writes every date cell in it', async () => {
    setFormat(format)
    await exportPdfGrid({ gridId, columnIds: [nameCol, dateCol], activeRowIds: [], destPath: join(testDb.tmpDir, 'list.pdf') })
    expect(tables).toHaveLength(1)
    expect(tables[0]!.map(r => r[1])).toEqual(EXPECTED[format])
  })

  it("the summary report's roster writes every date cell in it, CSV and PDF", async () => {
    setFormat(format)
    const opts = {
      gridId, columnIds: [nameCol, dateCol], dateRange: { start: '2026-03-01', end: '2026-03-31' },
      includeActivityLog: false, includeSystemActivity: false, includeTaskSummary: false,
    }
    const csvPath = join(testDb.tmpDir, 'summary.csv')
    await exportSupervisorReport({ ...opts, format: 'csv', destPath: csvPath })
    const csv = readFileSync(csvPath, 'utf8').split('\r\n')
    for (const [i, date] of EXPECTED[format].entries()) expect(csv).toContain(`Person ${i + 1},${date}`)

    await exportSupervisorReport({ ...opts, format: 'pdf', destPath: join(testDb.tmpDir, 'summary.pdf') })
    const roster = tables.find(body => body.some(r => r[0] === 'Person 1'))
    expect(roster?.map(r => r[1])).toEqual(EXPECTED[format])
  })
})
