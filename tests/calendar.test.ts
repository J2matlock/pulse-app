/** Calendar layers besides appointments (W07 commit 4), and the grid date math. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'

let t: TestDb
vi.mock('../src/main/database', () => ({ getDb: () => t.db, cachedStmt: (_k: string, sql: string) => t.db.prepare(sql) }))

import { calendarItems, deadlineOptionsForDay, noteSnippet } from '../src/main/calendar'
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

describe('deadline for a record (calendar-flexibility plan, Part 2)', () => {
  function setup() {
    const g = seedGrid(t.db, { name: 'Clients', rowCount: 1, columnCount: 9, columnTypes: ['text', 'date', 'date', 'date', 'date', 'date', 'number', 'number', 'date'] })
    const row = g.rowIds[0]!
    const [, review, quarterly, fromIntake, intake, workday, reading, lastReading, service] = g.columnIds as number[]
    const rule = (name: string, fields: Record<string, unknown>) => Number(t.db.prepare(
      'INSERT INTO alert_rules (name, thresholds, interval_days, interval_months, end_of_month, kind, rule_config, business_days) VALUES (?, \'[]\', ?, ?, ?, ?, ?, ?)',
    ).run(name, fields.days ?? null, fields.months ?? null, fields.eom ?? 0, fields.kind ?? 'interval', fields.config ? JSON.stringify(fields.config) : null, fields.business ?? 0).lastInsertRowid)
    const link = (col: number, name: string, ruleId: number) => t.db.prepare('UPDATE columns SET name = ?, config = ? WHERE id = ?').run(name, JSON.stringify({ alert_rule_id: ruleId }), col)
    link(review!, 'Care plan review', rule('6 months', { months: 6 }))
    link(quarterly!, 'Quarterly report', rule('Quarterly', { kind: 'calendar', config: { kind: 'calendar', months: [1, 4, 7, 10], day: 15 } }))
    link(fromIntake!, 'First visit', rule('45 days after intake', { kind: 'relative', config: { kind: 'relative', anchorColumnId: intake, offset: { days: 45, direction: 'after' } } }))
    t.db.prepare("UPDATE columns SET name = 'Intake date' WHERE id = ?").run(intake)
    link(workday!, 'Phone check', rule('30 working', { days: 30, business: 1 }))
    link(service!, 'Oil change', rule('Every 5,000 miles', { kind: 'meter', config: { kind: 'meter', readingColumnId: reading, lastServiceReadingColumnId: lastReading, every: 5000, unit: 'miles' } }))
    t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(row, review, '2026-01-10')
    return { row, review: review!, gridId: g.gridId }
  }

  it('works out the date to store for each deadline column, or says why not', () => {
    const { row } = setup()
    const byName = Object.fromEntries(deadlineOptionsForDay(row, '2026-10-15')!.map(o => [o.columnName, o]))
    expect(Object.keys(byName)).toEqual(['Care plan review', 'Quarterly report', 'First visit', 'Phone check', 'Oil change'])
    expect(byName['Care plan review']).toMatchObject({ value: '2026-04-15', current: '2026-01-10', reason: null })
    expect(byName['Quarterly report']).toMatchObject({ value: '2026-07-15', reason: null })
    expect(byName['First visit']).toMatchObject({ value: null, reason: 'It\'s worked out from “Intake date”. Change that date instead.' })
    // Thursday Oct 15, 2026 is a working day
    expect(byName['Phone check']).toMatchObject({ value: '2026-09-15' })
    expect(byName['Oil change']).toMatchObject({ value: null, reason: 'It\'s worked out from miles readings, so it can\'t be set from a date.' })
  })

  it('names the nearest days that work when the chosen one can\'t', () => {
    const { row } = setup()
    const byName = Object.fromEntries(deadlineOptionsForDay(row, '2026-10-17')!.map(o => [o.columnName, o]))
    expect(byName['Quarterly report']).toMatchObject({ value: null, reason: 'This deadline is only due on its scheduled dates.', nearest: ['2026-10-15', '2027-01-15'] })
    // A Saturday, with the usual weekend
    expect(byName['Phone check']).toMatchObject({ value: null, nearest: ['2026-10-16', '2026-10-19'] })
    expect(byName['Phone check']!.reason).toMatch(/day off/)
    // Days off come from Settings: with only Sunday off, Saturday works
    t.db.prepare("INSERT INTO settings (key, value) VALUES ('workspace_weekend', '[0]')").run()
    expect(deadlineOptionsForDay(row, '2026-10-17')!.find(o => o.columnName === 'Phone check')).toMatchObject({ value: '2026-09-17', reason: null })
  })

  it('has nothing for a record in the Trash', () => {
    const { row } = setup()
    t.db.prepare("UPDATE rows SET is_active = 0, deleted_at = datetime('now') WHERE id = ?").run(row)
    expect(deadlineOptionsForDay(row, '2026-10-15')).toBeNull()
    expect(deadlineOptionsForDay(999_999, '2026-10-15')).toBeNull()
  })
})
