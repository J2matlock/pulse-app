/**
 * W05 parity (§8): the engine-based loader must give the same deadlines as
 * the SQL it replaces. The old queries are kept here, verbatim, as the
 * reference; the fixture is the human-services sample caseload plus
 * calendar-month and end-of-month rules (A3).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { createTestDb, cleanupTestDb, type TestDb } from './helpers'
import { effectiveDateSql } from './legacyDeadlineSql'

let t: TestDb
vi.mock('../src/main/database', () => ({ getDb: () => t.db, cachedStmt: (_k: string, sql: string) => t.db.prepare(sql) }))
vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => '/tmp' } }))
vi.mock('../src/main/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { loadDeadlines, deadlineCounts } from '../src/main/deadlines'
import { loadPlannerRows } from '../src/main/export-planner'
import { loadIcsItems } from '../src/main/export-ics'
import { localDateFromToday } from '../src/shared/dates'
import { createSampleCaseload } from '../src/main/sample-data'
import { localDateString } from '../src/shared/dates'

const OLD_DEADLINES = `
  SELECT r.id AS row_id, r.grid_id, g.name AS grid_name, col.id AS column_id, col.name AS column_name,
         col.config AS column_config, c.value AS date_value, r.display_name AS client_name,
         ar.interval_days, ar.interval_months, ar.end_of_month, ar.thresholds AS alert_thresholds,
         ${effectiveDateSql('c.value', 'ar')} AS effective_date
  FROM cells c
  JOIN rows r   ON r.id = c.row_id AND r.is_active = 1 AND r.deleted_at IS NULL
  JOIN grids g  ON g.id = r.grid_id AND g.is_active = 1
  JOIN columns col ON col.id = c.column_id AND col.column_type = 'date'
    AND json_extract(col.config, '$.alert_rule_id') IS NOT NULL
  LEFT JOIN alert_rules ar ON ar.id = CAST(json_extract(col.config, '$.alert_rule_id') AS INTEGER)
  WHERE c.value IS NOT NULL AND c.value != ''
  ORDER BY effective_date IS NULL, effective_date ASC`

const OLD_BRIEFING = `
  WITH d AS (
    SELECT ${effectiveDateSql('c.value', 'ar')} AS due
    FROM cells c
    JOIN rows r   ON r.id = c.row_id AND r.is_active = 1 AND r.deleted_at IS NULL
    JOIN grids g  ON g.id = r.grid_id AND g.is_active = 1
    JOIN columns col ON col.id = c.column_id AND col.column_type = 'date'
      AND json_extract(col.config, '$.alert_rule_id') IS NOT NULL
    LEFT JOIN alert_rules ar ON ar.id = CAST(json_extract(col.config, '$.alert_rule_id') AS INTEGER)
    WHERE c.value IS NOT NULL AND c.value != ''
  )
  SELECT COALESCE(SUM(due < date('now', 'localtime')), 0) AS overdue,
         COALESCE(SUM(due = date('now', 'localtime')), 0) AS dueToday,
         COALESCE(SUM(due > date('now', 'localtime') AND due <= date('now', 'localtime', '+7 days')), 0) AS dueThisWeek
  FROM d WHERE due IS NOT NULL`

beforeAll(() => {
  t = createTestDb()
  createSampleCaseload()
  const db = t.db
  // A3 rules: calendar months with and without end of month, and a list using them
  const g = Number(db.prepare("INSERT INTO grids (name, position) VALUES ('Reviews', 9)").run().lastInsertRowid)
  const rule = (name: string, months: number, eom: number) =>
    Number(db.prepare("INSERT INTO alert_rules (name, thresholds, interval_months, end_of_month) VALUES (?, '[]', ?, ?)").run(name, months, eom).lastInsertRowid)
  const cols = [rule('Quarterly', 3, 0), rule('Monthly by end', 1, 1), rule('Annual', 12, 0)].map((id, i) =>
    Number(db.prepare("INSERT INTO columns (grid_id, name, column_type, position, config) VALUES (?, ?, 'date', ?, ?)").run(g, `Due ${i}`, i, JSON.stringify({ alert_rule_id: id })).lastInsertRowid))
  for (let i = 0; i < 40; i++) {
    const r = Number(db.prepare('INSERT INTO rows (grid_id, position) VALUES (?, ?)').run(g, i).lastInsertRowid)
    const day = new Date(2025, (i * 5) % 12, 1 + ((i * 7) % 31))
    cols.forEach((c, j) => db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(r, c, localDateString(new Date(day.getFullYear(), day.getMonth(), day.getDate() + j * 11))))
  }
  // A column linked to a rule that no longer exists still shows its date as the deadline
  db.prepare("INSERT INTO columns (grid_id, name, column_type, position, config) VALUES (?, 'Orphan', 'date', 9, '{\"alert_rule_id\":99999}')").run(g)
})
afterAll(() => cleanupTestDb(t))

const key = (d: { effective_date: string | null; row_id: number; column_id: number }) => `${d.effective_date}|${d.row_id}|${d.column_id}`

describe('loader parity with the old SQL', () => {
  it('lists the same deadlines with the same fields and due dates', () => {
    const old = (t.db.prepare(OLD_DEADLINES).all() as Array<Record<string, unknown> & { effective_date: string | null; row_id: number; column_id: number }>)
      .filter(d => d.effective_date !== null)
    const now = loadDeadlines()
    expect(now.length).toBe(old.length)
    expect(now.length).toBeGreaterThan(100)
    const oldByKey = new Map(old.map(d => [key(d), d]))
    for (const d of now) {
      const o = oldByKey.get(key(d))
      expect(o, key(d)).toBeDefined()
      for (const field of Object.keys(o!)) expect((d as unknown as Record<string, unknown>)[field], `${key(d)} ${field}`).toEqual(o![field])
    }
    // and in the same order (soonest first)
    expect(now.map(d => d.effective_date)).toEqual([...old.map(d => d.effective_date)].sort())
  })

  it('gives the same briefing counts', () => {
    expect(deadlineCounts()).toEqual(t.db.prepare(OLD_BRIEFING).get())
  })

  it('the planner lists the same deadlines on the same days', () => {
    const end = localDateFromToday(6)
    const oldDeadlines = (t.db.prepare(`SELECT * FROM (${OLD_DEADLINES.replace(/ORDER BY[^]*$/, '')}) WHERE effective_date IS NOT NULL AND effective_date <= ?`).all(end) as Array<{ effective_date: string; column_name: string }>)
      .map(d => `${d.effective_date}|${d.column_name}`).sort()
    const { week, overdue } = loadPlannerRows(localDateFromToday(0), end)
    const nowDeadlines = [...week, ...overdue].filter(r => r.kind === 'Deadline').map(r => `${r.due}|${r.what}`).sort()
    expect(nowDeadlines).toEqual(oldDeadlines)
    // still one list in date order
    const all = [...overdue, ...week].map(r => r.due)
    expect(all).toEqual([...all].sort())
  })

  it('the calendar export has the same deadline events', () => {
    const from = localDateFromToday(-30), to = localDateFromToday(180)
    const old = (t.db.prepare(`SELECT * FROM (${OLD_DEADLINES.replace(/ORDER BY[^]*$/, '')}) WHERE effective_date BETWEEN ? AND ?`).all(from, to) as Array<{ row_id: number; column_id: number; effective_date: string }>)
      .map(d => `deadline-${d.row_id}-${d.column_id}@pulse|${d.effective_date}`).sort()
    const now = loadIcsItems().filter(i => i.uid.startsWith('deadline-')).map(i => `${i.uid}|${i.date}`).sort()
    expect(now).toEqual(old)
  })

  it('applies the dashboard limit to the soonest', () => {
    const all = loadDeadlines()
    expect(loadDeadlines({ limit: 25 })).toEqual(all.slice(0, 25))
  })

  it('filters by list, records and range', () => {
    const g = (t.db.prepare("SELECT id FROM grids WHERE name = 'Reviews'").get() as { id: number }).id
    expect(loadDeadlines({ gridId: g }).every(d => d.grid_id === g)).toBe(true)
    const some = loadDeadlines({ gridId: g }).slice(0, 3).map(d => d.row_id)
    expect(new Set(loadDeadlines({ rowIds: some }).map(d => d.row_id))).toEqual(new Set(some))
    const ranged = loadDeadlines({ from: '2026-01-01', to: '2026-03-31' })
    expect(ranged.every(d => d.due! >= '2026-01-01' && d.due! <= '2026-03-31')).toBe(true)
  })

  it('handles 2,000 records × 5 rule columns quickly', () => {
    const db = t.db
    const g = Number(db.prepare("INSERT INTO grids (name, position) VALUES ('Big', 10)").run().lastInsertRowid)
    const ruleId = Number(db.prepare("INSERT INTO alert_rules (name, thresholds, interval_days) VALUES ('Big rule', '[]', 30)").run().lastInsertRowid)
    const cols = Array.from({ length: 5 }, (_, i) => Number(db.prepare("INSERT INTO columns (grid_id, name, column_type, position, config) VALUES (?, ?, 'date', ?, ?)").run(g, `D${i}`, i, JSON.stringify({ alert_rule_id: ruleId })).lastInsertRowid))
    db.transaction(() => {
      const insRow = db.prepare('INSERT INTO rows (grid_id, position) VALUES (?, ?)')
      const insCell = db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
      for (let i = 0; i < 2000; i++) {
        const r = Number(insRow.run(g, i).lastInsertRowid)
        for (const c of cols) insCell.run(r, c, `2026-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`)
      }
    })()
    // Best of three, so a busy test machine doesn't decide the result
    let ms = Infinity
    let items = loadDeadlines({ gridId: g })
    for (let i = 0; i < 3; i++) {
      const start = performance.now()
      items = loadDeadlines({ gridId: g })
      ms = Math.min(ms, performance.now() - start)
    }
    expect(items).toHaveLength(10_000)
    // Spec target 200 ms; measured about 120 ms. Some headroom for slower test machines
    expect(ms).toBeLessThan(400)
  })
})
