/**
 * What the summary report and the notes CSV put in (polish R5): tasks finished
 * on the last day, local calendar days, no struck-out notes or notes on records
 * in the Trash, no raw HTML, and notes dated by when they happened.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'
import { localDateFromToday, localDateString } from '../src/shared/dates'

let testDb: TestDb
type Db = typeof import('../src/main/database')
let realBuildGridQuery: Db['buildGridQuery']
vi.mock('../src/main/database', () => ({
  getDb: () => testDb.db,
  cachedStmt: (_key: string, sql: string) => testDb.db.prepare(sql),
  buildGridQuery: (...args: Parameters<Db['buildGridQuery']>) => realBuildGridQuery(...args),
}))
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp/pulse-test-supervisor', commandLine: { appendSwitch: () => {} } },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  dialog: { showMessageBoxSync: () => 0 },
}))

import { exportSupervisorReport } from '../src/main/export-supervisor'
import { exportNotesCsv } from '../src/main/export-csv'

beforeAll(async () => {
  realBuildGridQuery = (await vi.importActual<Db>('../src/main/database')).buildGridQuery
})

let grid: ReturnType<typeof seedGrid>
beforeEach(() => {
  testDb = createTestDb()
  grid = seedGrid(testDb.db, { rowCount: 3 })
})
afterEach(() => cleanupTestDb(testDb))

const today = localDateString()

async function summaryCsv(): Promise<string> {
  const destPath = join(testDb.tmpDir, 'summary.csv')
  await exportSupervisorReport({
    gridId: grid.gridId, columnIds: [], dateRange: { start: localDateFromToday(-30), end: today },
    includeActivityLog: true, includeSystemActivity: false, includeTaskSummary: true, format: 'csv', destPath,
  })
  return readFileSync(destPath, 'utf8')
}

describe('summary report', () => {
  it('labels the period with the days chosen, west of UTC too (S5)', async () => {
    const originalTz = process.env.TZ
    process.env.TZ = 'America/New_York'
    try {
      const destPath = join(testDb.tmpDir, 'period.csv')
      await exportSupervisorReport({
        gridId: grid.gridId, columnIds: [], dateRange: { start: '2026-10-01', end: '2026-10-31' },
        includeActivityLog: false, includeSystemActivity: false, includeTaskSummary: false, format: 'csv', destPath,
      })
      const csv = readFileSync(destPath, 'utf8')
      expect(csv).toContain('Oct 1, 2026 – Oct 31, 2026')
      expect(csv).not.toContain('Sep 30')
    } finally {
      process.env.TZ = originalTz
    }
  })

  it('counts a task finished today, when the period ends today', async () => {
    testDb.db.prepare("INSERT INTO caseload_tasks (grid_id, title, is_completed, completed_at, position) VALUES (?, 'Finished this afternoon', 1, ?, 0)")
      .run(grid.gridId, new Date().toISOString())
    const csv = await summaryCsv()
    expect(csv).toContain('Finished this afternoon')
    expect(csv).not.toContain('No tasks completed in this period.')
  })

  it('leaves out struck-out notes and notes on records in the Trash, and strips HTML', async () => {
    const [a, b] = grid.rowIds as [number, number]
    const note = testDb.db.prepare("INSERT INTO case_log (row_id, content, log_type, voided_at) VALUES (?, ?, 'note', ?)")
    note.run(a, '<p>Kept <strong>visit</strong></p>', null)
    note.run(a, 'Struck out by mistake', "2026-10-01 10:00:00")
    note.run(b, 'On a trashed record', null)
    testDb.db.prepare("UPDATE rows SET deleted_at = datetime('now'), is_active = 0 WHERE id = ?").run(b)
    const csv = await summaryCsv()
    expect(csv).toContain('Kept visit')
    expect(csv).not.toContain('<p>')
    expect(csv).not.toContain('Struck out by mistake')
    expect(csv).not.toContain('On a trashed record')
  })
})

describe('notes CSV', () => {
  it('dates a backdated note by when it happened, not when it was typed', async () => {
    testDb.db.prepare("INSERT INTO case_log (row_id, content, log_type, occurred_at, created_at) VALUES (?, 'Backdated visit', 'note', '2026-09-30 15:00:00', '2026-10-02 15:00:00')")
      .run(grid.rowIds[0])
    const destPath = join(testDb.tmpDir, 'notes.csv')
    await exportNotesCsv(destPath, 'iso')
    const line = readFileSync(destPath, 'utf8').split('\n').find(l => l.includes('Backdated visit'))!
    expect(line.startsWith('2026-09-30')).toBe(true)
  })
})
