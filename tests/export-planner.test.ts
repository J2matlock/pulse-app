import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, existsSync, statSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'
import { localDateFromToday } from '../src/shared/dates'

let testDb: TestDb
vi.mock('../src/main/database', () => ({ getDb: () => testDb.db }))
vi.mock('electron', () => ({ app: { getPath: () => tmpdir(), isPackaged: false } }))

import { loadPlannerRows, exportWeeklyPlanner } from '../src/main/export-planner'

beforeEach(() => {
  testDb = createTestDb()
  const { columnIds, rowIds } = seedGrid(testDb.db, { columnTypes: ['text', 'date'], rowCount: 2 })
  const rule = testDb.db.prepare("INSERT INTO alert_rules (name, interval_days, thresholds, created_at) VALUES ('Monthly', 30, '[]', datetime('now'))").run().lastInsertRowid
  testDb.db.prepare('UPDATE columns SET config = ? WHERE id = ?').run(JSON.stringify({ alert_rule_id: rule }), columnIds[1])
  testDb.db.prepare("INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, ?, datetime('now'))").run(rowIds[0], columnIds[1], localDateFromToday(-28)) // due in 2 days
  testDb.db.prepare("INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, ?, datetime('now'))").run(rowIds[1], columnIds[1], localDateFromToday(-40)) // overdue
  testDb.db.prepare("INSERT INTO caseload_tasks (title, due_date, is_completed, position, created_at, updated_at) VALUES ('Report', ?, 0, 0, datetime('now'), datetime('now'))").run(localDateFromToday(1))
})
afterEach(() => cleanupTestDb(testDb))

describe('weekly planner', () => {
  it('splits this week from overdue, using effective due dates', () => {
    const { week, overdue } = loadPlannerRows(localDateFromToday(0), localDateFromToday(6))
    expect(week.map(r => r.kind).sort()).toEqual(['Deadline', 'Task'])
    expect(overdue).toHaveLength(1)
    expect(overdue[0]!.due).toBe(localDateFromToday(-10))
  })

  it('writes a PDF', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'planner-'))
    const dest = join(dir, 'week.pdf')
    await exportWeeklyPlanner(localDateFromToday(0), dest, 'Jordan')
    expect(existsSync(dest) && statSync(dest).size > 1000).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('appointments on the planner (W07 §7)', () => {
  it('lists this week\'s scheduled appointments with their times', () => {
    testDb.db.prepare("INSERT INTO settings (key, value) VALUES ('workspace_features', ?)").run(JSON.stringify({ appointments: true }))
    const day = localDateFromToday(1)
    testDb.db.prepare("INSERT INTO appointments (title, start_at) VALUES ('Drop-off', ?)").run(`${day}T08:30`)
    testDb.db.prepare("INSERT INTO appointments (title, start_at, status) VALUES ('Done one', ?, 'done')").run(`${day}T10:00`)
    const { week } = loadPlannerRows(localDateFromToday(0), localDateFromToday(6))
    expect(week.filter(r => r.kind === 'Appointment')).toEqual([{ due: day, client: '', what: '8:30 am  Drop-off', kind: 'Appointment' }])
  })
})
