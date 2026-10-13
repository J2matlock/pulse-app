/** Calendar layers besides appointments (W07 commit 4), and the grid date math. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'

let t: TestDb
vi.mock('../src/main/database', () => ({ getDb: () => t.db, cachedStmt: (_k: string, sql: string) => t.db.prepare(sql) }))

import { calendarItems, noteSnippet } from '../src/main/calendar'
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
    // A follow-up shows the first words of its note; a task knows which it is (audit S-28)
    expect(items.map(i => [i.kind, i.title, i.recordName ?? null])).toEqual([
      ['deadline', 'Review', 'Pat'], ['followup', 'Call back', 'Pat'], ['task', 'Order forms', null],
    ])
    expect(items[2]!.taskId).toBeTypeOf('number')
    expect(items[0]).toMatchObject({ state: 'overdue', rowId: g.rowIds[0] })
    expect(calendarItems(localDateFromToday(10), localDateFromToday(20))).toEqual([])
  })
})

describe('one list on the calendar (audit S-32)', () => {
  it('shows only that list\'s deadlines, follow-ups and tasks', () => {
    const a = seedGrid(t.db, { name: 'Clients', rowCount: 1, columnCount: 1 })
    const b = seedGrid(t.db, { name: 'Staff', rowCount: 1, columnCount: 1 })
    t.db.prepare("INSERT INTO case_log (row_id, content, log_type, follow_up_date) VALUES (?, 'Client call', 'note', ?)").run(a.rowIds[0], localDateFromToday(3))
    t.db.prepare("INSERT INTO case_log (row_id, content, log_type, follow_up_date) VALUES (?, 'Staff call', 'note', ?)").run(b.rowIds[0], localDateFromToday(3))
    t.db.prepare("INSERT INTO caseload_tasks (title, due_date, grid_id) VALUES ('Staff task', ?, ?)").run(localDateFromToday(4), b.gridId)
    const all = calendarItems(localDateFromToday(0), localDateFromToday(7))
    expect(all.map(i => i.title).sort()).toEqual(['Client call', 'Staff call', 'Staff task'])
    expect(calendarItems(localDateFromToday(0), localDateFromToday(7), a.gridId).map(i => i.title)).toEqual(['Client call'])
  })

  it('cuts note text to its first words, without formatting', () => {
    const cut = noteSnippet('<p>Call the <b>pharmacy</b> about the refill and the new insurance card</p>')
    expect(cut).toMatch(/^Call the pharmacy about the refill/)
    expect(cut.endsWith('…') && cut.length <= 40).toBe(true)
    expect(noteSnippet('')).toBe('')
  })
})

describe('choosing deadline columns (calendar-flexibility plan, Part 1)', () => {
  function twoColumns() {
    const g = seedGrid(t.db, { rowCount: 1, columnCount: 2 })
    t.db.prepare("UPDATE rows SET display_name = 'Pat' WHERE id = ?").run(g.rowIds[0])
    const rule = Number(t.db.prepare("INSERT INTO alert_rules (name, thresholds) VALUES ('Due', '[]')").run().lastInsertRowid)
    g.columnIds.forEach((id, i) => {
      t.db.prepare("UPDATE columns SET name = ?, column_type = 'date', config = ? WHERE id = ?").run(i ? 'Care plan review' : 'Phone contact', JSON.stringify({ alert_rule_id: rule }), id)
      t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(g.rowIds[0], id, localDateFromToday(1))
    })
    return g
  }
  const titles = () => calendarItems(localDateFromToday(-7), localDateFromToday(7)).map(i => i.title).sort()

  it('shows every deadline column when nothing has been chosen (existing settings carry over)', () => {
    twoColumns()
    expect(titles()).toEqual(['Care plan review', 'Phone contact'])
    // An unreadable setting is the same as none
    t.db.prepare("INSERT INTO settings (key, value) VALUES ('calendar_hidden_deadline_columns', 'oops')").run()
    expect(titles()).toEqual(['Care plan review', 'Phone contact'])
  })

  it('leaves hidden columns out in main, and new columns show', () => {
    const g = twoColumns()
    t.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('calendar_hidden_deadline_columns', ?)").run(JSON.stringify([g.columnIds[0]]))
    expect(titles()).toEqual(['Care plan review'])
    // Follow-ups and tasks aren't affected
    t.db.prepare("INSERT INTO caseload_tasks (title, due_date) VALUES ('Order forms', ?)").run(localDateFromToday(2))
    expect(titles()).toEqual(['Care plan review', 'Order forms'])
    t.db.prepare("UPDATE settings SET value = '[]' WHERE key = 'calendar_hidden_deadline_columns'").run()
    expect(titles()).toEqual(['Care plan review', 'Order forms', 'Phone contact'])
  })
})
