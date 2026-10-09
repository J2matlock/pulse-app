import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'
import { localDateFromToday } from '../src/shared/dates'

let testDb: TestDb
vi.mock('../src/main/database', () => ({ getDb: () => testDb.db }))
vi.mock('electron', () => ({ app: { getPath: () => '/tmp', isPackaged: false } }))

import { initials, loadIcsItems, buildIcs } from '../src/main/export-ics'

beforeEach(() => {
  testDb = createTestDb()
  const g = seedGrid(testDb.db, { columnTypes: ['text', 'date'], columnCount: 2, rowCount: 1 })
  const db = testDb.db
  const rule = db.prepare("INSERT INTO alert_rules (name, thresholds, interval_days, created_at) VALUES ('Monthly', '[]', 30, datetime('now'))").run().lastInsertRowid
  db.prepare('UPDATE columns SET name = ?, config = ? WHERE id = ?').run('Home Visit', JSON.stringify({ alert_rule_id: rule }), g.columnIds[1])
  db.prepare("INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, 'Jane Smith', datetime('now'))").run(g.rowIds[0], g.columnIds[0])
  db.prepare("INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, ?, datetime('now'))").run(g.rowIds[0], g.columnIds[1], localDateFromToday(-20))
  db.prepare("INSERT INTO case_log (row_id, content, log_type, follow_up_date, created_at, updated_at) VALUES (?, 'Private details', 'phone', ?, datetime('now'), datetime('now'))").run(g.rowIds[0], localDateFromToday(3))
  db.prepare("INSERT INTO caseload_tasks (title, due_date, is_completed, position, created_at, updated_at) VALUES ('Call Jane about housing', ?, 0, 0, datetime('now'), datetime('now'))").run(localDateFromToday(5))
})
afterEach(() => cleanupTestDb(testDb))

describe('calendar export', () => {
  it('makes initials from either name order', () => {
    expect(initials('Jane Smith')).toBe('J.S.')
    expect(initials('Smith, Jane')).toBe('J.S.')
    expect(initials('  ')).toBe('?')
  })

  it('uses initials, never note text, and leaves out task titles by default', () => {
    const items = loadIcsItems()
    expect(items.map(i => i.summary)).toEqual(['J.S.: follow-up', 'J.S.: Home Visit'])
    expect(items[1]!.date).toBe(localDateFromToday(10))
    const ics = buildIcs(items)
    expect(ics).not.toContain('Private details')
    expect(ics).not.toContain('Jane')
  })

  it('shows things and jobs by name; only people get initials', () => {
    testDb.db.prepare("UPDATE grids SET record_kind = 'thing'").run()
    expect(loadIcsItems().map(i => i.summary)).toEqual(['Jane Smith: follow-up', 'Jane Smith: Home Visit'])
  })

  it('includes full names and task titles when asked', () => {
    const summaries = loadIcsItems({ fullNames: true }).map(i => i.summary)
    expect(summaries).toContain('Jane Smith: Home Visit')
    expect(summaries).toContain('Task: Call Jane about housing')
  })

  it('writes valid all-day events with escaping, reminders and folded lines', () => {
    const ics = buildIcs([{ uid: 'x@pulse', date: '2026-03-31', summary: 'A, B; C ' + 'long '.repeat(20) }], new Date('2026-03-01T12:00:00Z'))
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(ics).toContain('DTSTART;VALUE=DATE:20260331\r\nDTEND;VALUE=DATE:20260401')
    expect(ics).toContain('SUMMARY:A\\, B\; C')
    expect(ics).toContain('TRIGGER:-PT15H')
    expect(ics.split('\r\n').every(l => Buffer.byteLength(l) <= 75)).toBe(true)
  })
})

describe('appointments in the calendar file (W07 §7)', () => {
  it('are timed events in floating local time, named by initials unless full names are on', () => {
    const g = seedGrid(testDb.db, { rowCount: 1, columnCount: 1 })
    testDb.db.prepare("UPDATE rows SET display_name = 'Jane Smith' WHERE id = ?").run(g.rowIds[0])
    testDb.db.prepare("INSERT INTO settings (key, value) VALUES ('workspace_features', ?)").run(JSON.stringify({ appointments: true }))
    const day = localDateFromToday(3)
    testDb.db.prepare("INSERT INTO appointments (row_id, title, start_at, end_at) VALUES (?, 'Session about divorce', ?, ?)").run(g.rowIds[0], `${day}T15:00`, `${day}T15:50`)
    testDb.db.prepare("INSERT INTO appointments (title, start_at, status) VALUES ('Cancelled one', ?, 'cancelled')").run(`${day}T09:00`)
    const items = loadIcsItems().filter(i => i.uid.startsWith('appointment-'))
    expect(items).toEqual([expect.objectContaining({ summary: 'Appointment with J.S.', start: `${day}T15:00`, end: `${day}T15:50` })])
    expect(loadIcsItems({ fullNames: true }).find(i => i.uid.startsWith('appointment-'))!.summary).toBe('Session about divorce (Jane Smith)')
    const ics = buildIcs(items)
    const compact = day.replace(/-/g, '')
    expect(ics).toContain(`DTSTART:${compact}T150000\r\n`)
    expect(ics).toContain(`DTEND:${compact}T155000\r\n`)
    expect(ics).toContain('TRIGGER:-PT30M')
    expect(ics).not.toMatch(/divorce/)
  })
})
