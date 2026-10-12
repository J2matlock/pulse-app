/**
 * Summary report figures (sweep Phase 2, B2): overdue and approaching counted as
 * records, used-up quotas overdue, the figure dated "as of" today; new records
 * that were archived later; capped note lists that say so.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createTestDb, cleanupTestDb, seedGrid, setDbWords, type TestDb } from './helpers'
import { localDateFromToday, localDateString } from '../src/shared/dates'
import { ymdToDate } from '../src/shared/ymd'

let testDb: TestDb
type Db = typeof import('../src/main/database')
let realBuildGridQuery: Db['buildGridQuery']
vi.mock('../src/main/database', () => ({
  getDb: () => testDb.db,
  cachedStmt: (_key: string, sql: string) => testDb.db.prepare(sql),
  buildGridQuery: (...args: Parameters<Db['buildGridQuery']>) => realBuildGridQuery(...args),
}))
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp/pulse-test-supervisor-counts', commandLine: { appendSwitch: () => {} } },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  dialog: { showMessageBoxSync: () => 0 },
}))

import { exportSupervisorReport } from '../src/main/export-supervisor'
import { deadlineCounts, loadDeadlines } from '../src/main/deadlines'
import { isUsedUp } from '../src/shared/deadlineEngine'

beforeAll(async () => {
  realBuildGridQuery = (await vi.importActual<Db>('../src/main/database')).buildGridQuery
})

beforeEach(() => { testDb = createTestDb(); setDbWords(testDb.db) })
afterEach(() => cleanupTestDb(testDb))

const today = localDateString()
const todayLabel = ymdToDate(today).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

async function report(gridId: number, format: 'csv' | 'pdf', opts: { start?: string; end?: string; activity?: boolean; system?: boolean } = {}): Promise<string> {
  const destPath = join(testDb.tmpDir, `summary.${format}`)
  await exportSupervisorReport({
    gridId, columnIds: [], dateRange: { start: opts.start ?? localDateFromToday(-30), end: opts.end ?? today },
    includeActivityLog: !!opts.activity, includeSystemActivity: !!opts.system, includeTaskSummary: false, format, destPath,
  })
  return readFileSync(destPath, format === 'csv' ? 'utf8' : 'latin1')
}

/** Record A: three overdue dates. Record B: one due in 5 days. Record C: a quota used up, its end 20 days away. */
function seedDeadlines() {
  const db = testDb.db
  const g = seedGrid(db, { columnCount: 7, columnTypes: ['text', 'date', 'date', 'date', 'date', 'date', 'deadline'], rowCount: 4 })
  const [, d1, d2, d3, start, end, quotaCol] = g.columnIds as [number, number, number, number, number, number, number]
  const [a, b, c] = g.rowIds as [number, number, number]
  const monthly = Number(db.prepare("INSERT INTO alert_rules (name, thresholds, interval_days) VALUES ('Monthly', '[]', 30)").run().lastInsertRowid)
  for (const col of [d1, d2, d3]) db.prepare('UPDATE columns SET config = ? WHERE id = ?').run(JSON.stringify({ alert_rule_id: monthly }), col)
  db.prepare("INSERT INTO activity_types (key, label, position) VALUES ('session', 'Session', 9)").run()
  const quota = Number(db.prepare("INSERT INTO alert_rules (name, thresholds, kind, rule_config) VALUES ('Authorization', '[]', 'quota', ?)")
    .run(JSON.stringify({ kind: 'quota', activityTypes: ['session'], startColumnId: start, endColumnId: end, limit: 2, warnRemaining: 0, warnDaysBeforeEnd: 0 })).lastInsertRowid)
  db.prepare('UPDATE columns SET config = ? WHERE id = ?').run(JSON.stringify({ alert_rule_id: quota }), quotaCol)
  const cell = db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
  for (const col of [d1, d2, d3]) cell.run(a, col, localDateFromToday(-60))
  cell.run(b, d1, localDateFromToday(-25))
  cell.run(c, start, localDateFromToday(-40))
  cell.run(c, end, localDateFromToday(20))
  const note = db.prepare("INSERT INTO case_log (row_id, content, log_type, created_at) VALUES (?, 'x', 'session', datetime('now', '-10 days'))")
  note.run(c); note.run(c)
  return { gridId: g.gridId, a, b, c }
}

describe('Summary report deadline figures (F-017)', () => {
  it('counts records, not deadlines, counts a used-up quota as overdue, and dates the figure', async () => {
    const { gridId, c } = seedDeadlines()
    const items = loadDeadlines({ gridId, today })
    // The seed is what it says: five deadlines, one of them a used-up quota not yet past its end
    expect(items).toHaveLength(5)
    const quota = items.find(d => d.row_id === c)!
    expect(isUsedUp(quota) && quota.daysUntil! >= 0).toBe(true)
    // Per deadline, the same split as the dashboard and the briefing
    expect(deadlineCounts(today)).toEqual({ overdue: 4, dueToday: 0, dueThisWeek: 1 })

    const csv = await report(gridId, 'csv')
    expect(csv).toContain(`Overdue Deadlines,"2 clients (as of ${todayLabel})"`)
    expect(csv).toContain(`Approaching (next 7 days),"1 client (as of ${todayLabel})"`)
    expect(csv).toContain(`As of ${todayLabel}, 2 clients have overdue deadlines. 1 has deadlines within 7 days.`)
    const pdf = await report(gridId, 'pdf')
    expect(pdf).toContain(`2 clients \\(as of ${todayLabel}\\)`)
  })

  it('a report for last month still says the deadlines are as of today', async () => {
    const { gridId } = seedDeadlines()
    const csv = await report(gridId, 'csv', { start: localDateFromToday(-60), end: localDateFromToday(-31) })
    expect(csv).toContain(`2 clients (as of ${todayLabel})`)
  })
})

describe('Summary report new and deleted records (F-018, F-010)', () => {
  it('counts a record added in the period and archived since as new', async () => {
    const db = testDb.db
    const g = seedGrid(db, { rowCount: 3 })
    const [archived, trashed] = g.rowIds as [number, number]
    db.prepare("UPDATE rows SET display_name = 'Arch Ived', is_active = 0, archived_at = datetime('now') WHERE id = ?").run(archived)
    db.prepare("UPDATE rows SET deleted_at = datetime('now') WHERE id = ?").run(trashed)
    const csv = await report(g.gridId, 'csv', { start: localDateFromToday(-7) })
    expect(csv).toContain('New Clients (Period),2')
    expect(csv).toContain('Clients Archived (Period),1')
    expect(csv).toContain('"Clients Deleted (Period, Still in the Trash)",1')
    expect(csv).toContain('(2 new, 1 archived, 1 deleted and still in the Trash)')
    const [, added = ''] = csv.split('New Clients Added')
    expect(added).toContain('Arch Ived')
    expect(csv).toContain('Clients Removed From Caseload (Still in the Trash)')
  })
})

describe('Summary report capped lists (F-019)', () => {
  it('says when the notes and system entries are cut short, CSV and PDF, and dates PDF rows with the year', async () => {
    const db = testDb.db
    const g = seedGrid(db, { rowCount: 1 })
    const [row] = g.rowIds as [number]
    const ins = db.prepare("INSERT INTO case_log (row_id, content, log_type, occurred_at, created_at) VALUES (?, ?, ?, datetime('now', ?), datetime('now', ?))")
    db.transaction(() => {
      for (let i = 0; i < 201; i++) ins.run(row, `Visit ${i} ${'x'.repeat(i === 200 ? 150 : 5)}`, 'visit', `-${i % 20} hours`, `-${i % 20} hours`)
      for (let i = 0; i < 501; i++) ins.run(row, `Auto ${i}`, 'system', '-1 hours', '-1 hours')
    })()
    const csv = await report(g.gridId, 'csv', { activity: true, system: true })
    expect(csv).toContain('Showing the latest 200 of 201 case notes.')
    expect(csv).toContain('Showing the latest 500 of 501 system entries.')
    const pdf = await report(g.gridId, 'pdf', { activity: true, system: true })
    expect(pdf).toContain('Showing the latest 200 of 201 case notes.')
    expect(pdf).toContain('Showing the latest 500 of 501 system entries.')
  })

  it('says nothing when everything fits, marks a cut note, and dates PDF rows with the year', async () => {
    const db = testDb.db
    const g = seedGrid(db, { rowCount: 1 })
    const [row] = g.rowIds as [number]
    // Three days ago at noon, local: a day the report's header doesn't name
    const day = localDateFromToday(-3)
    const at = (db.prepare("SELECT datetime(?, 'utc') AS t").get(`${day} 12:00:00`) as { t: string }).t
    db.prepare("INSERT INTO case_log (row_id, content, log_type, occurred_at, created_at) VALUES (?, ?, 'visit', ?, ?)").run(row, 'Long ' + 'y'.repeat(200), at, at)
    const csv = await report(g.gridId, 'csv', { activity: true, system: true })
    expect(csv).not.toContain('Showing the latest')
    const pdf = await report(g.gridId, 'pdf', { activity: true })
    expect(pdf).not.toContain('Showing the latest')
    expect(pdf).toMatch(/y{5}\.\.\.\)/)
    expect(pdf).toContain(ymdToDate(day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }))
  })
})
