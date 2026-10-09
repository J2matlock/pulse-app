/** Quota deadlines (W05 §3.5): a limited number of visits between two dates. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'
import { evaluate, engineRuleFrom, parseRuleConfig, referencedColumns } from '../src/shared/deadlineEngine'

let t: TestDb
vi.mock('../src/main/database', () => ({ getDb: () => t.db, cachedStmt: (_k: string, sql: string) => t.db.prepare(sql) }))

import { loadDeadlines, loadGridDeadlineContext } from '../src/main/deadlines'

const auth = (extra: object = {}) => engineRuleFrom({ id: 1, kind: 'quota', rule_config: JSON.stringify({
  kind: 'quota', activityTypes: ['session'], startColumnId: 2, endColumnId: 3, limit: 12, warnRemaining: 2, warnDaysBeforeEnd: 14, ...extra,
}) })
const values = { 2: '2026-07-01', 3: '2026-12-31' }

describe('quota rules', () => {
  it('count what is left until the end date', () => {
    expect(evaluate(auth(), { today: '2026-10-02', columnDate: null, values, activityCount: 5 }))
      .toMatchObject({ due: '2026-12-31', state: 'ok', label: '5 of 12 used', detail: '7 of 12 left until Dec 31, 2026 (Jul 1, 2026 – Dec 31, 2026)' })
  })

  it('warn when few are left or the end is near', () => {
    expect(evaluate(auth(), { today: '2026-10-02', columnDate: null, values, activityCount: 10 }).state).toBe('soon')
    expect(evaluate(auth(), { today: '2026-12-20', columnDate: null, values, activityCount: 1 }).state).toBe('soon')
  })

  it('are late when all are used or the end has passed', () => {
    const out = evaluate(auth(), { today: '2026-10-02', columnDate: null, values, activityCount: 12 })
    expect(out).toMatchObject({ state: 'overdue', daysUntil: 0, detail: 'All 12 used (Jul 1, 2026 – Dec 31, 2026)' })
    expect(evaluate(auth(), { today: '2027-01-05', columnDate: null, values, activityCount: 3 })).toMatchObject({ state: 'overdue', daysUntil: -5 })
  })

  it('can take the limit from a column, and need start, end and a limit', () => {
    const fromCol = auth({ limit: undefined, limitColumnId: 4 })
    expect(referencedColumns(fromCol).sort()).toEqual([2, 3, 4])
    expect(evaluate(fromCol, { today: '2026-10-02', columnDate: null, values: { ...values, 4: '20' }, activityCount: 5 }).label).toBe('5 of 20 used')
    expect(evaluate(fromCol, { today: '2026-10-02', columnDate: null, values, activityCount: 5 }).state).toBe('none')
    expect(parseRuleConfig('quota', { kind: 'quota', activityTypes: ['session'], startColumnId: 2, endColumnId: 3 }).ok).toBe(false)
  })
})

describe('quota rules in main', () => {
  let gridId: number, rowIds: number[], ruleCol: number
  beforeEach(() => {
    t = createTestDb()
    const g = seedGrid(t.db, { columnTypes: ['text', 'date', 'date', 'deadline'], rowCount: 2 })
    gridId = g.gridId; rowIds = g.rowIds
    const [, start, end, col] = g.columnIds as [number, number, number, number]
    ruleCol = col
    t.db.prepare("INSERT INTO activity_types (key, label, position) VALUES ('session', 'Session', 9)").run()
    const rule = Number(t.db.prepare("INSERT INTO alert_rules (name, thresholds, kind, rule_config) VALUES ('Authorization', '[]', 'quota', ?)")
      .run(JSON.stringify({ kind: 'quota', activityTypes: ['session'], startColumnId: start, endColumnId: end, limit: 3, warnRemaining: 1, warnDaysBeforeEnd: 0 })).lastInsertRowid)
    t.db.prepare("UPDATE columns SET name = 'Visits left', config = ? WHERE id = ?").run(JSON.stringify({ alert_rule_id: rule }), col)
    const cell = t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
    for (const r of rowIds) { cell.run(r, start, '2026-07-01'); cell.run(r, end, '2026-12-31') }
    const note = t.db.prepare("INSERT INTO case_log (row_id, content, log_type, created_at, voided_at) VALUES (?, 'x', ?, datetime(?, 'utc'), ?)")
    note.run(rowIds[0], 'session', '2026-07-10 10:00:00', null)
    note.run(rowIds[0], 'session', '2026-08-10 10:00:00', null)
    note.run(rowIds[0], 'session', '2026-08-11 10:00:00', '2026-08-12')   // voided
    note.run(rowIds[0], 'phone', '2026-08-12 10:00:00', null)             // other kind
    note.run(rowIds[0], 'session', '2026-06-30 10:00:00', null)           // before the start
  })
  afterEach(() => cleanupTestDb(t))

  it('counts only the chosen kinds inside each record\'s own dates', () => {
    const items = loadDeadlines({ gridId, today: '2026-10-02' })
    const byRow = new Map(items.map(d => [d.row_id, d]))
    expect(byRow.get(rowIds[0]!)).toMatchObject({ label: '2 of 3 used', state: 'soon', rule_kind: 'quota' })
    expect(byRow.get(rowIds[1]!)).toMatchObject({ label: '0 of 3 used', state: 'ok' })
    expect(loadGridDeadlineContext(gridId).quota).toEqual({ [`${rowIds[0]}:${ruleCol}`]: 2 })
  })
})
