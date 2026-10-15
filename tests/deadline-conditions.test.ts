/** "Only while Status is Active" (W05 §3.7): conditions hide or pause a deadline. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'
import { evaluate, engineRuleFrom, conditionHolds, conditionBlank, lastDoneInFuture, referencedColumns } from '../src/shared/deadlineEngine'

let t: TestDb
vi.mock('../src/main/database', () => ({ getDb: () => t.db, cachedStmt: (_k: string, sql: string) => t.db.prepare(sql) }))

import { loadDeadlines, deadlineCounts } from '../src/main/deadlines'

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

  it('count a deadline whose condition column is blank, and say why (persona study R4)', () => {
    const base = { today: '2026-10-02', columnDate: '2026-09-20' }
    for (const whenFalse of ['hide', 'pause'] as const) {
      const named = { ...rule(whenFalse), conditionColumnName: 'Status' }
      for (const values of [{ 5: '' }, { 5: '   ' }, { 5: null }, {}]) {
        const res = evaluate(named, { ...base, values })
        expect(res).toMatchObject({ due: '2026-10-20', state: 'ok', daysUntil: 18 })
        expect(res.detail).toMatch(/ · Counted because Status is blank$/)
      }
    }
    // Without a name the words still make sense
    expect(evaluate(rule('hide'), { ...base, values: {} }).detail).toMatch(/Counted because the column it depends on is blank$/)
    // Overdue stays overdue
    expect(evaluate(rule('hide'), { today: '2026-10-02', columnDate: '2024-01-01', values: {} }).state).toBe('overdue')
    // No date: nothing to count, and nothing to explain
    expect(evaluate(rule('hide'), { today: '2026-10-02', columnDate: null, values: {} })).toMatchObject({ due: null, state: 'none', detail: '' })
  })

  it('still hide or pause on a value that is there and does not match', () => {
    const base = { today: '2026-10-02', columnDate: '2026-09-20' }
    expect(evaluate(rule('hide'), { ...base, values: { 5: 'No' } })).toMatchObject({ due: null, state: 'none' })
    expect(evaluate(rule('pause'), { ...base, values: { 5: 'No' } })).toMatchObject({ state: 'paused' })
  })

  it('treat "filled in" like "is" for a blank, and leave "empty" and "is not" alone', () => {
    const base = { today: '2026-10-02', columnDate: '2026-09-20' }
    const withOp = (op: 'empty' | 'not_empty' | 'is_not', whenFalse: 'hide' | 'pause' = 'hide') => engineRuleFrom({
      id: 1, interval_days: 30, rule_condition: JSON.stringify({ columnId: 5, op, ...(op === 'is_not' ? { values: ['Closed'] } : {}), whenFalse }),
    })
    expect(evaluate(withOp('not_empty'), { ...base, values: {} }).state).toBe('ok')
    // Blank already satisfies "empty" and "is not Closed"
    expect(evaluate(withOp('empty'), { ...base, values: {} })).toMatchObject({ state: 'ok', detail: expect.not.stringMatching(/Counted because/) })
    expect(evaluate(withOp('is_not'), { ...base, values: {} })).toMatchObject({ state: 'ok', detail: expect.not.stringMatching(/Counted because/) })
    // ...and a filled-in value still fails them
    expect(evaluate(withOp('empty'), { ...base, values: { 5: 'x' } }).state).toBe('none')
    expect(evaluate(withOp('is_not', 'pause'), { ...base, values: { 5: 'Closed' } }).state).toBe('paused')
    expect(conditionBlank({ columnId: 5, op: 'is', values: ['Yes'], whenFalse: 'hide' }, {})).toBe(true)
    expect(conditionBlank({ columnId: 5, op: 'is', values: ['Yes'], whenFalse: 'hide' }, { 5: 'No' })).toBe(false)
    expect(conditionBlank({ columnId: 5, op: 'empty', whenFalse: 'hide' }, { 5: 'x' })).toBe(false)
    expect(conditionBlank(null, {})).toBe(false)
  })

  it('lastDoneInFuture: a repeating rule\'s own date after today (persona study R4)', () => {
    const yearly = { kind: 'interval' as const, interval: { days: 0, months: 12, endOfMonth: false } }
    expect(lastDoneInFuture('2026-12-04', yearly, '2026-10-15')).toBe(true)
    expect(lastDoneInFuture('2026-10-15', yearly, '2026-10-15')).toBe(false)
    expect(lastDoneInFuture('2025-12-04', yearly, '2026-10-15')).toBe(false)
    expect(lastDoneInFuture('2026-12-04T09:00:00', yearly, '2026-10-15')).toBe(true)
    expect(lastDoneInFuture('2026-12-04', { kind: 'calendar', interval: yearly.interval }, '2026-10-15')).toBe(true)
    // A one-off date is the due date, and other kinds don't store a done date
    expect(lastDoneInFuture('2026-12-04', { kind: 'interval', interval: { days: 0, months: 0, endOfMonth: false } }, '2026-10-15')).toBe(false)
    expect(lastDoneInFuture('2026-12-04', { kind: 'relative', interval: yearly.interval }, '2026-10-15')).toBe(false)
    expect(lastDoneInFuture(null, yearly, '2026-10-15')).toBe(false)
    expect(lastDoneInFuture('soon', yearly, '2026-10-15')).toBe(false)
  })

  it('keep business days and extensions on a blank-condition deadline', () => {
    const r = engineRuleFrom({ id: 1, interval_days: 30, business_days: 1, rule_condition: JSON.stringify({ columnId: 5, op: 'is', values: ['Yes'], whenFalse: 'hide' }) })
    // 2026-10-03 + 30 = Nov 2 (a Monday); from Sep 4: Oct 4 is a Sunday, back to Friday Oct 2
    const res = evaluate(r, { today: '2026-09-20', columnDate: '2026-09-04', values: {} })
    expect(res.due).toBe('2026-10-02')
    expect(res.detail).toMatch(/working day before.*Counted because/)
    const ext = evaluate(r, { today: '2026-09-20', columnDate: '2026-09-04', values: {}, extension: { newDue: '2026-11-01', reason: 'Waiting on court' } })
    expect(ext.due).toBe('2026-11-01')
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

  it('lists a blank-condition deadline, named, and counts it as overdue (persona study R4)', () => {
    const [, date, status] = t.db.prepare('SELECT id FROM columns WHERE grid_id = ? ORDER BY position').all(gridId).map(c => (c as { id: number }).id) as [number, number, number]
    t.db.prepare("UPDATE columns SET name = 'Needs check' WHERE id = ?").run(status)
    const row = Number(t.db.prepare("INSERT INTO rows (grid_id, position, display_name) VALUES (?, 9, 'Ernest')").run(gridId).lastInsertRowid)
    t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(row, date, '2024-01-01')
    const ernest = loadDeadlines({ gridId, today: '2026-10-02' }).find(d => d.row_id === row)!
    expect(ernest).toMatchObject({ state: 'overdue' })
    expect(ernest.detail).toMatch(/Counted because Needs check is blank$/)
    expect(deadlineCounts('2026-10-02').overdue).toBe(1)
  })

  it('lists only deadlines whose condition holds, unless paused ones are asked for', () => {
    expect(loadDeadlines({ gridId, today: '2026-10-02' }).map(d => d.row_id)).toEqual([rowIds[0]])
    const all = loadDeadlines({ gridId, today: '2026-10-02', includePaused: true })
    expect(all.find(d => d.row_id === rowIds[1])!.state).toBe('paused')
  })
})
