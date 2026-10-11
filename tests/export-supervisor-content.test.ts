/**
 * What the summary report and the notes CSV put in (polish R5): tasks finished
 * on the last day, local calendar days, no struck-out notes or notes on records
 * in the Trash, no raw HTML, and notes dated by when they happened.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createTestDb, cleanupTestDb, seedGrid, setDbWords, type TestDb } from './helpers'
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

function seedComputed(db: TestDb['db']) {
  const g = seedGrid(db, { rowCount: 1, columnTypes: ['text', 'date', 'date', 'age_from_dob', 'calculated_days'] })
  const [name, dob, next, age, days] = g.columnIds as [number, number, number, number, number]
  const rename = db.prepare('UPDATE columns SET name = ?, config = ? WHERE id = ?')
  rename.run('Name', '{}', name)
  rename.run('Birth date', '{}', dob)
  rename.run('Next visit', '{}', next)
  rename.run('Age', JSON.stringify({ source_column_id: dob }), age)
  rename.run('Days to visit', JSON.stringify({ source_column_id: next }), days)
  db.prepare('UPDATE columns SET is_name_column = 1 WHERE id = ?').run(name)
  const insert = db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
  const [rowId = 0] = g.rowIds
  insert.run(rowId, name, 'Test Person')
  insert.run(rowId, dob, `${new Date().getFullYear() - 10}-01-01`)
  insert.run(rowId, next, localDateFromToday(5))
  return { gridId: g.gridId, rowId }
}

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

  it('lists each time a repeating task was done, once each (bug sweep S2)', async () => {
    const id = testDb.db.prepare(`INSERT INTO caseload_tasks (grid_id, title, is_completed, due_date, recurrence_rule, position)
      VALUES (?, 'Weekly call', 0, ?, '{"type":"weekly","interval":1}', 0)`).run(grid.gridId, today).lastInsertRowid as number
    const hist = testDb.db.prepare('INSERT INTO caseload_task_history (task_id, completed_at, cycle_number) VALUES (?, ?, ?)')
    hist.run(id, new Date(Date.now() - 7 * 86400000).toISOString(), 1)
    hist.run(id, new Date(Date.now() - 86400000).toISOString(), 2)
    // A one-off task done for good has a history row too; it's listed once
    const doneAt = new Date().toISOString()
    const one = testDb.db.prepare("INSERT INTO caseload_tasks (grid_id, title, is_completed, completed_at, position) VALUES (?, 'One-off', 1, ?, 1)").run(grid.gridId, doneAt).lastInsertRowid as number
    hist.run(one, doneAt, 1)
    const csv = await summaryCsv()
    expect(csv.match(/Weekly call/g)).toHaveLength(2)
    expect(csv.match(/One-off/g)).toHaveLength(1)
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

describe('summary report CSV header', () => {
  it('has a byte-order mark, uses the workspace words and guards typed text (AUDIT-034, AUDIT-065, AUDIT-122)', async () => {
    setDbWords(testDb.db)
    testDb.db.prepare("UPDATE grids SET name = '=HYPERLINK(\"http://x\")' WHERE id = ?").run(grid.gridId)
    const destPath = join(testDb.tmpDir, 'header.csv')
    await exportSupervisorReport({
      gridId: grid.gridId, columnIds: [], dateRange: { start: localDateFromToday(-30), end: today },
      includeActivityLog: false, includeSystemActivity: false, includeTaskSummary: false, format: 'csv', destPath,
      workerName: '@Test Person', workerTitle: '+Lead', workerOrg: '-Org',
    })
    const csv = readFileSync(destPath, 'utf8')
    expect(csv.startsWith('\uFEFF')).toBe(true)
    const lines = csv.slice(1).split('\r\n')
    expect(lines).toContain('Caseload,"\t=HYPERLINK(""http://x"")"')
    expect(lines).toContain('Case manager,\t@Test Person')
    expect(lines).toContain('Title,\t+Lead')
    expect(lines).toContain('Organization,\t-Org')
    expect(csv).not.toMatch(/^Grid,/m)
    expect(csv).not.toMatch(/^Worker,/m)
  })
})

describe('summary report roster', () => {
  it('shows Age and Days-until as the table does, CSV and PDF (AUDIT-036)', async () => {
    const { gridId } = seedComputed(testDb.db)
    for (const format of ['csv', 'pdf'] as const) {
      const destPath = join(testDb.tmpDir, `roster.${format}`)
      await exportSupervisorReport({
        gridId, columnIds: [], dateRange: { start: localDateFromToday(-30), end: today },
        includeActivityLog: false, includeSystemActivity: false, includeTaskSummary: false, format, destPath,
      })
      const out = readFileSync(destPath).toString(format === 'csv' ? 'utf8' : 'latin1')
      if (format === 'csv') expect(out).toContain(',10 yrs,5 days')
      else { expect(out).toContain('(10 yrs)'); expect(out).toContain('(5 days)') }
    }
  })

  it('leaves records in the Trash off the roster', async () => {
    const [a, b] = grid.rowIds as [number, number]
    const insert = testDb.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
    insert.run(a, grid.columnIds[0], 'Kept Person')
    insert.run(b, grid.columnIds[0], 'Trashed Person')
    testDb.db.prepare("UPDATE rows SET deleted_at = datetime('now') WHERE id = ?").run(b)
    const [, roster = ''] = (await summaryCsv()).split(' Roster')
    expect(roster).toContain('Kept Person')
    expect(roster).not.toContain('Trashed Person')
  })
})

describe('summary report system activity', () => {
  it('leaves out records in the Trash, CSV and PDF (AUDIT-102)', async () => {
    const [a, b] = grid.rowIds as [number, number]
    testDb.db.prepare("UPDATE rows SET display_name = 'Kept Person' WHERE id = ?").run(a)
    testDb.db.prepare("UPDATE rows SET display_name = 'Trashed Person' WHERE id = ?").run(b)
    const sys = testDb.db.prepare("INSERT INTO case_log (row_id, content, log_type) VALUES (?, ?, 'system')")
    sys.run(a, 'Stage changed on kept')
    sys.run(b, 'Moved to the Trash')
    testDb.db.prepare("UPDATE rows SET deleted_at = datetime('now'), is_active = 0 WHERE id = ?").run(b)
    for (const format of ['csv', 'pdf'] as const) {
      const destPath = join(testDb.tmpDir, `sys.${format}`)
      await exportSupervisorReport({
        gridId: grid.gridId, columnIds: [], dateRange: { start: localDateFromToday(-30), end: today },
        includeActivityLog: false, includeSystemActivity: true, includeTaskSummary: false, format, destPath,
      })
      const out = readFileSync(destPath).toString('latin1')
      expect(out).toContain('Stage changed on kept')
      expect(out).not.toContain('Moved to the Trash')
    }
  })
})

describe('notes CSV', () => {
  it("heads the columns with the workspace's words (AUDIT-154)", async () => {
    setDbWords(testDb.db)
    const destPath = join(testDb.tmpDir, 'notes-head.csv')
    await exportNotesCsv(destPath, 'iso')
    expect(readFileSync(destPath, 'utf8').slice(1).split('\r\n')[0]).toBe('Date,Caseload,Client,Kind,Case note,Follow-up')
  })

  it('dates a backdated note by when it happened, not when it was typed', async () => {
    testDb.db.prepare("INSERT INTO case_log (row_id, content, log_type, occurred_at, created_at) VALUES (?, 'Backdated visit', 'note', '2026-09-30 15:00:00', '2026-10-02 15:00:00')")
      .run(grid.rowIds[0])
    const destPath = join(testDb.tmpDir, 'notes.csv')
    await exportNotesCsv(destPath, 'iso')
    const line = readFileSync(destPath, 'utf8').split('\n').find(l => l.includes('Backdated visit'))!
    expect(line.startsWith('2026-09-30')).toBe(true)
  })
})
