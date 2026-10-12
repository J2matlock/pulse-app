/**
 * F-021: the report builder caps notes and appointments; a date range on their
 * own date must narrow the query itself, and past the cap the latest are kept,
 * or "this month" comes out empty behind years of old ones. Cap made small here.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, cleanupTestDb, seedGrid, setDbWords, type TestDb } from './helpers'

let t: TestDb
vi.mock('electron', () => ({ app: { getPath: () => '/tmp', isPackaged: false }, BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../src/main/database', async () => {
  const actual = await vi.importActual<typeof import('../src/main/database')>('../src/main/database')
  return { ...actual, getDb: () => t.db, cachedStmt: (_k: string, sql: string) => t.db.prepare(sql) }
})
vi.mock('../src/shared/reports', async () => {
  const actual = await vi.importActual<typeof import('../src/shared/reports')>('../src/shared/reports')
  return { ...actual, REPORT_LIMITS: { ...actual.REPORT_LIMITS, sourceRows: 10 } }
})

import { runReport } from '../src/main/report-builder'

const NOW = new Date(2026, 9, 15, 12, 0, 0) // Oct 15, 2026
let gridId: number, row: number

beforeEach(() => {
  t = createTestDb()
  setDbWords(t.db)
  const g = seedGrid(t.db, { rowCount: 1, columnCount: 1 })
  gridId = g.gridId; row = g.rowIds[0]!
  const note = t.db.prepare("INSERT INTO case_log (row_id, content, log_type, occurred_at, created_at, updated_at) VALUES (?, 'x', 'visit', datetime(?, 'utc'), datetime(?, 'utc'), datetime('now'))")
  const appt = t.db.prepare("INSERT INTO appointments (row_id, title, start_at, status) VALUES (?, 'Visit', ?, 'done')")
  // 15 old ones a year back, then 3 this month
  for (let i = 1; i <= 15; i++) {
    const day = `2025-0${1 + (i % 9)}-${String(10 + i).padStart(2, '0')}`
    note.run(row, `${day} 10:00:00`, `${day} 10:00:00`)
    appt.run(row, `${day}T10:00`)
  }
  for (const day of ['2026-10-02', '2026-10-05', '2026-10-09']) {
    note.run(row, `${day} 10:00:00`, `${day} 10:00:00`)
    appt.run(row, `${day}T10:00`)
  }
})
afterEach(() => cleanupTestDb(t))

describe('Report builder caps (F-021)', () => {
  it('a date range on the note date is applied before the cap', () => {
    const r = runReport(gridId, { source: 'activities', dateRange: { field: 'act:date', preset: 'this_month' } }, NOW)
    expect(r.rows).toEqual([{ v0: 3 }])
    expect(r.truncated).toBeNull()
  })

  it('a date range on the appointment date is applied before the cap', () => {
    const r = runReport(gridId, { source: 'appointments', dateRange: { field: 'appt:date', from: '2026-10-01', to: '2026-10-31' } }, NOW)
    expect(r.rows).toEqual([{ v0: 3 }])
    expect(r.truncated).toBeNull()
  })

  it('past the cap, the latest are kept, still listed oldest first, and the report says so', () => {
    const notes = runReport(gridId, { source: 'activities', columns: ['act:date'] }, NOW)
    expect(notes.rows).toHaveLength(10)
    expect(notes.rows.at(-1)).toEqual({ 'act:date': '2026-10-09' })
    expect(notes.rows.map(x => x['act:date'])).toEqual([...notes.rows.map(x => x['act:date'])].sort())
    expect(notes.truncated).toBe('Only the latest 10 were counted.')
    const appts = runReport(gridId, { source: 'appointments', columns: ['appt:date'] }, NOW)
    expect(appts.rows.at(-1)).toEqual({ 'appt:date': '2026-10-09' })
    expect(appts.truncated).toBe('Only the latest 10 were counted.')
  })
})
