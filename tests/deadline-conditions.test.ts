/** "Only while Status is Active" (W05 §3.7): conditions hide or pause a deadline. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'
import { evaluate, engineRuleFrom, conditionHolds, referencedColumns } from '../src/shared/deadlineEngine'

let t: TestDb
vi.mock('../src/main/database', () => ({ getDb: () => t.db, cachedStmt: (_k: string, sql: string) => t.db.prepare(sql) }))

import { loadDeadlines } from '../src/main/deadlines'

const rule = (whenFalse: 'hide' | 'pause') => engineRuleFrom({
  id: 1, interval_days: 30, rule_condition: JSON.stringify({ columnId: 5, op: 'is', values: ['Active'], whenFalse }),
})

describe('conditions', () => {
  it('check is, is not, empty and filled in, ignoring case and spaces', () => {
    expect(conditionHolds({ columnId: 5, op: 'is', values: ['Active'], whenFalse: 'hide' }, { 5: ' active ' })).toBe(true)
    expect(conditionHolds({ columnId: 5, op: 'is_not', values: ['Closed', 'On hold'], whenFalse: 'hide' }, { 5: 'Closed' })).toBe(false)
    expect(conditionHolds({ columnId: 5, op: 'empty', whenFalse: 'hide' }, { 5: '' })).toBe(true)
    expect(conditionHolds({ columnId: 5, op: 'not_empty', whenFalse: 'hide' }, {})).toBe(false)
    expect(conditionHolds(null, {})).toBe(true)
  })

  it('leave the deadline alone when true, hide or pause it when false', () => {
    const base = { today: '2026-10-02', columnDate: '2026-09-20' }
    expect(evaluate(rule('hide'), { ...base, values: { 5: 'Active' } })).toMatchObject({ due: '2026-10-20', state: 'ok' })
    expect(evaluate(rule('hide'), { ...base, values: { 5: 'Closed' } })).toMatchObject({ due: null, state: 'none' })
    const paused = evaluate(rule('pause'), { ...base, values: { 5: 'Closed' } })
    expect(paused).toMatchObject({ due: '2026-10-20', state: 'paused', daysUntil: null })
    expect(paused.detail).toMatch(/^Paused \(only while it's Active\)/)
    expect(referencedColumns(rule('hide'))).toEqual([5])
  })
})

describe('conditions in the loader', () => {
  let gridId: number, rowIds: number[]
  beforeEach(() => {
    t = createTestDb()
    const g = seedGrid(t.db, { columnTypes: ['text', 'date', 'dropdown'], rowCount: 2 })
    gridId = g.gridId; rowIds = g.rowIds
    const [, date, status] = g.columnIds as [number, number, number]
    const r = Number(t.db.prepare("INSERT INTO alert_rules (name, thresholds, interval_days, rule_condition) VALUES ('Monthly while active', '[]', 30, ?)")
      .run(JSON.stringify({ columnId: status, op: 'is', values: ['Active'], whenFalse: 'pause' })).lastInsertRowid)
    t.db.prepare('UPDATE columns SET config = ? WHERE id = ?').run(JSON.stringify({ alert_rule_id: r }), date)
    const cell = t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
    cell.run(rowIds[0], date, '2026-09-20'); cell.run(rowIds[0], status, 'Active')
    cell.run(rowIds[1], date, '2026-09-20'); cell.run(rowIds[1], status, 'On hold')
  })
  afterEach(() => cleanupTestDb(t))

  it('lists only deadlines whose condition holds, unless paused ones are asked for', () => {
    expect(loadDeadlines({ gridId, today: '2026-10-02' }).map(d => d.row_id)).toEqual([rowIds[0]])
    const all = loadDeadlines({ gridId, today: '2026-10-02', includePaused: true })
    expect(all.find(d => d.row_id === rowIds[1])!.state).toBe('paused')
  })
})
