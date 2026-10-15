import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, existsSync, statSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createTestDb, cleanupTestDb, seedGrid, setDbFeatures, type TestDb } from './helpers'
import { localDateFromToday } from '../src/shared/dates'
import { featuresForExistingInstall } from '../src/shared/features'

let testDb: TestDb
vi.mock('../src/main/database', () => ({ getDb: () => testDb.db }))
vi.mock('electron', () => ({ app: { getPath: () => tmpdir(), isPackaged: false } }))

import { loadPlannerRows, exportWeeklyPlanner, loadDueRows, exportWhatsDue, daysLeftText, dueRangeText } from '../src/main/export-planner'
import { jsPDF } from '../src/main/export-shared'

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

type Doc = Record<string, (...a: unknown[]) => unknown>
type Hook = [string, (this: Doc) => void]

/** Record what every new PDF draws: its text colours, font sizes and text */
function recordPdfCalls() {
  const colors: unknown[][] = [], sizes: number[] = [], texts: string[] = []
  const events = (jsPDF.API as unknown as { events: Hook[] }).events
  const hook: Hook = ['initialized', function (this: Doc) {
    const wrap = (name: string, log: (args: unknown[]) => void) => {
      const original = this[name]!
      this[name] = (...args: unknown[]) => { log(args); return original.apply(this, args) }
    }
    wrap('setTextColor', a => colors.push(a))
    wrap('setFontSize', a => sizes.push(Number(a[0])))
    wrap('text', a => texts.push(...(Array.isArray(a[0]) ? a[0].map(String) : [String(a[0])])))
  }]
  events.push(hook)
  return { colors, sizes, texts, stop: () => { events.splice(events.indexOf(hook), 1) } }
}

describe("print what's due (persona study R7)", () => {
  // A fresh list: a deadline 7 days out, a checklist item 13 days out, an overdue task,
  // and a rule worked out from another column, due in 19 days
  let gridId: number
  beforeEach(() => {
    const db = testDb.db
    db.prepare('DELETE FROM caseload_tasks').run()
    db.prepare('DELETE FROM cells').run()
    setDbFeatures(db)
    const g = seedGrid(db, { name: 'Veterans', columnTypes: ['text', 'date', 'date', 'date'], rowCount: 3 })
    gridId = g.gridId
    const [nameCol, review, decision, appeal] = g.columnIds as [number, number, number, number]
    const names = ['Tyrone', 'Dolores', 'Walt']
    g.rowIds.forEach((id, i) => db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(id, nameCol, names[i]))
    const monthly = db.prepare("INSERT INTO alert_rules (name, interval_days, thresholds) VALUES ('Monthly', 30, '[]')").run().lastInsertRowid
    db.prepare("UPDATE columns SET name = 'Review', config = ? WHERE id = ?").run(JSON.stringify({ alert_rule_id: monthly }), review)
    db.prepare("UPDATE columns SET name = 'Decision date' WHERE id = ?").run(decision)
    const rel = db.prepare("INSERT INTO alert_rules (name, thresholds, kind, rule_config) VALUES ('Appeal window', '[]', 'relative', ?)")
      .run(JSON.stringify({ kind: 'relative', anchorColumnId: decision, offset: { days: 34, direction: 'after' } })).lastInsertRowid
    db.prepare("UPDATE columns SET name = 'Appeal filed', column_type = 'deadline', config = ? WHERE id = ?").run(JSON.stringify({ alert_rule_id: rel }), appeal)
    const cell = db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
    cell.run(g.rowIds[0], review, localDateFromToday(-23)) // due in 7 days
    cell.run(g.rowIds[2], decision, localDateFromToday(-15)) // appeal due in 19 days
    db.prepare("INSERT INTO checklist_items (row_id, title, due_date, is_completed, position) VALUES (?, 'Evidence letter', ?, 0, 0)").run(g.rowIds[1], localDateFromToday(13))
    db.prepare("INSERT INTO caseload_tasks (title, due_date, is_completed, position, created_at, updated_at) VALUES ('Call VA', ?, 0, 0, datetime('now'), datetime('now'))").run(localDateFromToday(-12))
    db.prepare("INSERT INTO caseload_tasks (title, due_date, snoozed_until, is_completed, position, created_at, updated_at) VALUES ('Snoozed', ?, ?, 0, 0, datetime('now'), datetime('now'))").run(localDateFromToday(2), localDateFromToday(5))
  })

  it('lists every kind, late first, then the soonest, named like the dashboard', () => {
    const rows = loadDueRows(30)
    expect(rows.map(r => [r.what, r.kind, r.daysUntil, r.late])).toEqual([
      ['Call VA', 'Task', -12, true],
      ['Review', 'Deadline', 7, false],
      ['Evidence letter', 'Checklist', 13, false],
      ['Appeal window', 'Deadline', 19, false],
    ])
    expect(rows.map(r => r.client)).toEqual(['', 'Tyrone', 'Dolores', 'Walt'])
    // The next 7 days stops at 7; what's late is always there
    expect(loadDueRows(7).map(r => r.what)).toEqual(['Call VA', 'Review'])
  })

  it('leaves out what the dashboard leaves out: switched-off features and lists in the Trash', () => {
    setDbFeatures(testDb.db, { ...featuresForExistingInstall({ trackTime: false, trackMileage: false }), tasks: false, checklists: false })
    expect(loadDueRows(30).map(r => r.what)).toEqual(['Review', 'Appeal window'])
    testDb.db.prepare('UPDATE grids SET is_active = 0 WHERE id = ?').run(gridId)
    expect(loadDueRows(30)).toEqual([])
  })

  it('says how far away each one is, and the range in the title', () => {
    expect([-12, -1, 0, 1, 7].map(n => daysLeftText({ daysUntil: n, late: n < 0 }))).toEqual(['12 days late', '1 day late', 'Today', 'Tomorrow', 'in 7 days'])
    expect(daysLeftText({ daysUntil: 4, late: true })).toBe('Now')
    expect(dueRangeText('2026-10-15', '2026-11-14')).toBe('Oct 15 – Nov 14, 2026')
    expect(dueRangeText('2026-12-20', '2027-01-19')).toBe('Dec 20, 2026 – Jan 19, 2027')
  })

  it('prints 12 pt and up, black only, the range in the title, and says so when nothing is due', async () => {
    const rec = recordPdfCalls()
    const dir = mkdtempSync(join(tmpdir(), 'due-'))
    try {
      expect(await exportWhatsDue(30, join(dir, 'due.pdf'), 'Bobby')).toBe(4)
      const black = (c: unknown[]) => c.every(v => v === 0 || v === '0' || v === undefined || v === '#000000' || (Array.isArray(v) && v.every(x => x === 0)))
      expect(rec.colors.length).toBeGreaterThan(0)
      expect(rec.colors.filter(c => !black(c))).toEqual([])
      expect(Math.min(...rec.sizes)).toBeGreaterThanOrEqual(12)
      expect(rec.texts.some(s => s.startsWith("What's due: next 30 days ("))).toBe(true)
      expect(rec.texts).toEqual(expect.arrayContaining(['12 days late', 'Appeal window', 'Done', 'Days left']))
      testDb.db.prepare('DELETE FROM caseload_tasks').run()
      testDb.db.prepare('DELETE FROM cells').run()
      testDb.db.prepare('DELETE FROM checklist_items').run()
      rec.texts.length = 0
      expect(await exportWhatsDue(7, join(dir, 'none.pdf'))).toBe(0)
      expect(rec.texts, rec.texts.join(' | ')).toContain('Nothing is overdue or due in the next 7 days.')
    } finally {
      rec.stop()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
