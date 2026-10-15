/**
 * The summary report, proofread (persona study R7): no "Roster Roster", the
 * deadlines in the next 7 days named, and the time spent with records when
 * time on notes is on. Run with a school's words (students on a roster).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createTestDb, cleanupTestDb, seedGrid, setDbWords, setDbFeatures, type TestDb } from './helpers'
import { localDateFromToday } from '../src/shared/dates'
import { GENERIC_VOCAB, type Vocab } from '../src/shared/vocab'
import { featuresForExistingInstall } from '../src/shared/features'

let testDb: TestDb
type Db = typeof import('../src/main/database')
let realBuildGridQuery: Db['buildGridQuery']
vi.mock('../src/main/database', () => ({
  getDb: () => testDb.db,
  cachedStmt: (_key: string, sql: string) => testDb.db.prepare(sql),
  buildGridQuery: (...args: Parameters<Db['buildGridQuery']>) => realBuildGridQuery(...args),
}))
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp/pulse-test-supervisor-r7', commandLine: { appendSwitch: () => {} } },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  dialog: { showMessageBoxSync: () => 0 },
}))

import { exportSupervisorReport } from '../src/main/export-supervisor'

beforeAll(async () => {
  realBuildGridQuery = (await vi.importActual<Db>('../src/main/database')).buildGridQuery
})

const words = (list: string): Vocab => ({
  ...GENERIC_VOCAB,
  record: { one: 'student', many: 'students', article: 'a' },
  list: { one: list, many: `${list}s`, article: 'a' },
  activity: { one: 'session note', many: 'session notes', article: 'a' },
})

let grid: ReturnType<typeof seedGrid>
beforeEach(() => {
  testDb = createTestDb()
  setDbWords(testDb.db, words('roster'))
  grid = seedGrid(testDb.db, { rowCount: 13, columnTypes: ['text', 'date'] })
  const [nameCol, reviewCol] = grid.columnIds as [number, number]
  testDb.db.prepare("UPDATE columns SET name = 'Name' WHERE id = ?").run(nameCol)
  const rule = testDb.db.prepare("INSERT INTO alert_rules (name, thresholds, interval_days) VALUES ('Monthly', '[]', 30)").run().lastInsertRowid
  testDb.db.prepare("UPDATE columns SET name = 'IEP review', config = ? WHERE id = ?").run(JSON.stringify({ alert_rule_id: rule }), reviewCol)
  const cell = testDb.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
  grid.rowIds.forEach((id, i) => {
    cell.run(id, nameCol, `Student ${String(i + 1).padStart(2, '0')}`)
    // Twelve due within the week (in 1–6 days), the last one not for weeks
    cell.run(id, reviewCol, localDateFromToday(i < 12 ? -29 + (i % 6) : 0))
  })
})
afterEach(() => cleanupTestDb(testDb))

async function report(format: 'csv' | 'pdf'): Promise<string> {
  const destPath = join(testDb.tmpDir, `summary.${format}`)
  await exportSupervisorReport({
    gridId: grid.gridId, columnIds: [], dateRange: { start: localDateFromToday(-30), end: localDateFromToday(0) },
    includeActivityLog: false, includeSystemActivity: false, includeTaskSummary: false, format, destPath,
  })
  return readFileSync(destPath, format === 'csv' ? 'utf8' : 'latin1')
}

describe('summary report, proofread (persona study R7)', () => {
  it.each(['roster', 'caseload', 'list'])('the roster heading never doubles up (list word "%s")', async (list) => {
    setDbWords(testDb.db, words(list))
    const csv = await report('csv')
    const pdf = await report('pdf')
    for (const out of [csv, pdf]) {
      expect(out).toContain('All students')
      expect(out).not.toMatch(/Roster Roster|Caseload Roster|List Roster/i)
    }
  })

  it('names the records with deadlines in the next 7 days, up to 10, then how many more', async () => {
    const csv = await report('csv')
    expect(csv).toContain('12 students have deadlines within 7 days: Student 01 (IEP review, ')
    expect(csv).toMatch(/Student \d\d \(IEP review, [A-Z][a-z]{2} \d+, \d{4}\) and 2 more\./)
  })

  it('shows the time with each student and the total when time on notes is on, and nothing when it is off', async () => {
    const note = testDb.db.prepare("INSERT INTO case_log (row_id, content, log_type, minutes, occurred_at, created_at) VALUES (?, 'x', 'note', ?, datetime('now', '-2 days'), datetime('now'))")
    note.run(grid.rowIds[0], 50); note.run(grid.rowIds[0], 25); note.run(grid.rowIds[1], 30)
    setDbFeatures(testDb.db, { ...featuresForExistingInstall({ trackTime: false, trackMileage: false }), timeTracking: false })
    expect(await report('csv')).not.toContain('Time with students')
    setDbFeatures(testDb.db, { ...featuresForExistingInstall({ trackTime: true, trackMileage: false }), timeTracking: true })
    const csv = await report('csv')
    expect(csv).toContain('Time with students')
    expect(csv).toContain('Student 01,2,75')
    expect(csv).toContain('Total,3,105')
    expect(csv).toContain('1 hr 45 min logged with 2 students.')
    const pdf = await report('pdf')
    expect(pdf).toContain('(Time with students)')
    expect(pdf).toContain('(1 hr 45 min)')
  })
})
