/** Calendar layers besides appointments (W07 commit 4), and the grid date math. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'

let t: TestDb
vi.mock('../src/main/database', () => ({ getDb: () => t.db, cachedStmt: (_k: string, sql: string) => t.db.prepare(sql) }))

import { calendarItems } from '../src/main/calendar'
import { monthGrid, startOfWeek, formatTime } from '../src/shared/calendar'
import { localDateFromToday } from '../src/shared/dates'

beforeEach(() => { t = createTestDb() })
afterEach(() => cleanupTestDb(t))

describe('calendar grid', () => {
  it('starts weeks on the chosen day and covers the month in six rows', () => {
    expect(startOfWeek('2026-10-07', 'sunday')).toBe('2026-10-04')
    expect(startOfWeek('2026-10-07', 'monday')).toBe('2026-10-05')
    const g = monthGrid('2026-10-15', 'monday')
    expect(g).toHaveLength(6)
    expect(g[0]![0]).toBe('2026-09-28')
    expect(g.flat()).toContain('2026-10-31')
    expect(formatTime('2026-10-06T15:05', '12h')).toBe('3:05 pm')
    expect(formatTime('2026-10-06T00:30', '12h')).toBe('12:30 am')
    expect(formatTime('2026-10-06T15:05', '24h')).toBe('15:05')
  })
})

describe('calendar items', () => {
  it('gathers deadlines, follow-ups and tasks in range', () => {
    const g = seedGrid(t.db, { rowCount: 1, columnCount: 2 })
    t.db.prepare("UPDATE rows SET display_name = 'Pat' WHERE id = ?").run(g.rowIds[0])
    const rule = Number(t.db.prepare("INSERT INTO alert_rules (name, thresholds) VALUES ('Due', '[]')").run().lastInsertRowid)
    t.db.prepare("UPDATE columns SET name = 'Review', column_type = 'date', config = ? WHERE id = ?").run(JSON.stringify({ alert_rule_id: rule }), g.columnIds[1])
    t.db.prepare("UPDATE rows SET display_name = 'Pat' WHERE id = ?").run(g.rowIds[0])
    t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(g.rowIds[0], g.columnIds[1], localDateFromToday(-2))
    t.db.prepare("INSERT INTO case_log (row_id, content, log_type, follow_up_date) VALUES (?, 'Call back', 'note', ?)").run(g.rowIds[0], localDateFromToday(3))
    t.db.prepare("INSERT INTO caseload_tasks (title, due_date) VALUES ('Order forms', ?)").run(localDateFromToday(5))
    const items = calendarItems(localDateFromToday(-7), localDateFromToday(7))
    expect(items.map(i => [i.kind, i.title, i.recordName ?? null])).toEqual([
      ['deadline', 'Review', 'Pat'], ['followup', 'Follow-up', 'Pat'], ['task', 'Order forms', null],
    ])
    expect(items[0]).toMatchObject({ state: 'overdue', rowId: g.rowIds[0] })
    expect(calendarItems(localDateFromToday(10), localDateFromToday(20))).toEqual([])
  })
})
