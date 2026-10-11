/** "Done" for one-off dates and one-step Done (Decision E1, audit 5.3: D-06, D-23, L-25). */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, cleanupTestDb, seedGrid, createEmptyEncryptedDb, allMigrations, type TestDb } from './helpers'
import { evaluate, engineRuleFrom } from '../src/shared/deadlineEngine'
import { localDateString } from '../src/shared/dates'

let t: TestDb
vi.mock('../src/main/database', () => ({ getDb: () => t.db, cachedStmt: (_k: string, sql: string) => t.db.prepare(sql) }))

import { loadDeadlines, loadGridDeadlineContext } from '../src/main/deadlines'
import { markDone, undoMarkDone } from '../src/main/deadline-actions'
import { up as migration046 } from '../src/main/migrations/046_deadline_done'

describe('the engine', () => {
  it('shows a one-off date marked Finished as done, and a new date as due again', () => {
    const due = engineRuleFrom({ id: 1 })
    expect(evaluate(due, { today: '2026-10-10', columnDate: '2026-09-01', finishedFor: ['2026-09-01'] })).toMatchObject({ state: 'done', due: '2026-09-01' })
    expect(evaluate(due, { today: '2026-10-10', columnDate: '2026-12-01', finishedFor: ['2026-09-01'] })).toMatchObject({ state: 'ok', due: '2026-12-01' })
    // A repeating rule ignores the flag
    expect(evaluate(engineRuleFrom({ id: 1, interval_months: 12 }), { today: '2026-10-10', columnDate: '2026-09-01', finishedFor: ['2026-09-01'] }).state).toBe('ok')
  })
})

describe('marking done in main', () => {
  let rowId: number, oneOff: number, yearly: number, gridId: number
  beforeEach(() => {
    t = createTestDb()
    const g = seedGrid(t.db, { columnTypes: ['text', 'date', 'date'], rowCount: 1 })
    gridId = g.gridId; rowId = g.rowIds[0]!
    ;[, oneOff, yearly] = g.columnIds as [number, number, number]
    const rule = (months: number | null) => Number(t.db.prepare("INSERT INTO alert_rules (name, thresholds, interval_months) VALUES ('R', '[]', ?)").run(months).lastInsertRowid)
    t.db.prepare("UPDATE columns SET name = 'License', config = ? WHERE id = ?").run(JSON.stringify({ alert_rule_id: rule(null) }), oneOff)
    t.db.prepare("UPDATE columns SET name = 'Review', config = ? WHERE id = ?").run(JSON.stringify({ alert_rule_id: rule(12) }), yearly)
    const cell = t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
    cell.run(rowId, oneOff, '2026-09-01'); cell.run(rowId, yearly, '2025-09-01')
    t.db.prepare("INSERT INTO checklist_templates (name, items) VALUES ('After review', '[\"Call family\"]')").run()
  })
  afterEach(() => cleanupTestDb(t))
  const value = (c: number) => (t.db.prepare('SELECT value FROM cells WHERE row_id = ? AND column_id = ?').get(rowId, c) as { value: string }).value
  const note = (id: number) => (t.db.prepare('SELECT content FROM case_log WHERE id = ?').get(id) as { content: string }).content

  it('Finished keeps the date and drops it from the lists; undo brings it back', () => {
    expect(loadDeadlines({ gridId }).some(d => d.column_id === oneOff)).toBe(true)
    const res = markDone(rowId, oneOff, { kind: 'finished' })
    expect(value(oneOff)).toBe('2026-09-01')
    expect(note(res.sysLogId)).toMatch(/License finished \(was due Sep 1, 2026\)/)
    expect(loadDeadlines({ gridId }).some(d => d.column_id === oneOff)).toBe(false)
    expect(loadDeadlines({ gridId, includeDone: true }).find(d => d.column_id === oneOff)!.state).toBe('done')
    expect(loadGridDeadlineContext(gridId).finished).toEqual({ [`${rowId}:${oneOff}`]: ['2026-09-01'] })
    undoMarkDone(rowId, oneOff, res)
    expect(loadDeadlines({ gridId }).some(d => d.column_id === oneOff)).toBe(true)
  })

  it('Renewed sets the new date', () => {
    const res = markDone(rowId, oneOff, { kind: 'renewed', newDate: '2027-09-01' })
    expect(value(oneOff)).toBe('2027-09-01')
    expect(note(res.sysLogId)).toMatch(/renewed: now due Sep 1, 2027 \(was Sep 1, 2026\)/)
    undoMarkDone(rowId, oneOff, res)
    expect(value(oneOff)).toBe('2026-09-01')
  })

  it('a repeating date starts again today, with its note and checklist in the same step (L-25)', () => {
    const tpl = (t.db.prepare('SELECT id FROM checklist_templates LIMIT 1').get() as { id: number }).id
    const res = markDone(rowId, yearly, { kind: 'repeat' }, tpl)
    expect(value(yearly)).toBe(localDateString())
    expect(note(res.sysLogId)).toMatch(/Review done .*; next due/)
    expect(res.checklistItemIds).toHaveLength(1)
    undoMarkDone(rowId, yearly, res)
    expect(value(yearly)).toBe('2025-09-01')
    expect((t.db.prepare('SELECT COUNT(*) AS n FROM checklist_items').get() as { n: number }).n).toBe(0)
  })

  it('asks the right question for each kind of date', () => {
    expect(() => markDone(rowId, oneOff, { kind: 'repeat' })).toThrow(/renewed or finished/)
    expect(() => markDone(rowId, yearly, { kind: 'finished' })).toThrow(/repeats/)
    expect(() => markDone(rowId, oneOff, { kind: 'renewed', newDate: 'soon' })).toThrow(/new date/)
  })
})

describe('migration 046', () => {
  it('makes Date columns with done-date rules into Deadline columns, keeps the rest, and can run twice', () => {
    const e = createEmptyEncryptedDb()
    for (const m of allMigrations.filter(m => m.version < 46)) m.up(e.db)
    const db = e.db
    const g = Number(db.prepare("INSERT INTO grids (name, position) VALUES ('L', 0)").run().lastInsertRowid)
    const rule = (kind: string, cfg: object | null) => Number(db.prepare("INSERT INTO alert_rules (name, thresholds, kind, rule_config) VALUES ('r', '[]', ?, ?)").run(kind, cfg ? JSON.stringify(cfg) : null).lastInsertRowid)
    const col = (name: string, ruleId: number) => Number(db.prepare("INSERT INTO columns (grid_id, name, column_type, position, config) VALUES (?, ?, 'date', 0, ?)").run(g, name, JSON.stringify({ alert_rule_id: ruleId })).lastInsertRowid)
    const anchor = col('Referral', rule('interval', null))
    const rel = col('Plan written', rule('relative', { kind: 'relative', anchorColumnId: anchor, offset: { days: 45, direction: 'after' } }))
    const self = col('Court date', rule('relative', { kind: 'relative', anchorColumnId: 'self', offset: { businessDays: 10, direction: 'after' } }))
    const cal = col('Estimated tax', rule('calendar', { kind: 'calendar', months: [1, 4, 6, 9], day: 15 }))
    migration046(db); migration046(db)
    const type = (id: number) => (db.prepare('SELECT column_type FROM columns WHERE id = ?').get(id) as { column_type: string }).column_type
    expect([type(anchor), type(rel), type(self), type(cal)]).toEqual(['date', 'deadline', 'date', 'deadline'])
    expect((db.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get() as { value: string }).value).toBe('46')
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'deadline_done'").get()).toBeTruthy()
    cleanupTestDb(e)
  })
})
