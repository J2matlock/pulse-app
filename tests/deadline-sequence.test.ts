/** Sequence deadlines (W05 §3.6): steps from one anchor date, checked off in order. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'
import { evaluate, engineRuleFrom, referencedColumns } from '../src/shared/deadlineEngine'

let t: TestDb
vi.mock('../src/main/database', () => ({ getDb: () => t.db, cachedStmt: (_k: string, sql: string) => t.db.prepare(sql) }))

import { loadDeadlines, loadGridDeadlineContext } from '../src/main/deadlines'
import { markStepDone, undoStep } from '../src/main/deadline-actions'

const ei = (extra: object = {}) => engineRuleFrom({ id: 1, kind: 'sequence', rule_config: JSON.stringify({
  kind: 'sequence', anchorColumnId: 2,
  steps: [{ label: 'IFSP meeting', offset: { days: 45 } }, { label: '6-month review', offset: { months: 6 } }, { label: 'Annual IFSP', offset: { months: 12 } }],
  ...extra,
}) })
const ctx = (progress: number[] = [], today = '2026-03-01') => ({ today, columnDate: null, values: { 2: '2026-01-10' }, progress })

describe('sequence rules', () => {
  it('are due at the first step not done', () => {
    expect(evaluate(ei(), ctx())).toMatchObject({ due: '2026-02-24', state: 'overdue', step: 0, label: 'IFSP meeting (step 1 of 3)' })
    expect(evaluate(ei(), ctx([0]))).toMatchObject({ due: '2026-07-10', step: 1, label: '6-month review (step 2 of 3)' })
    expect(evaluate(ei(), ctx([0, 1]))).toMatchObject({ due: '2027-01-10', step: 2 })
  })

  it('are done after the last step, or repeat it when set to', () => {
    expect(evaluate(ei(), ctx([0, 1, 2]))).toMatchObject({ state: 'done', due: null, label: 'All 3 steps done' })
    const forever = ei({ repeatLast: { months: 12 } })
    expect(evaluate(forever, ctx([0, 1, 2]))).toMatchObject({ due: '2028-01-10', step: 3, label: 'Annual IFSP (repeat 1)' })
    expect(evaluate(forever, ctx([0, 1, 2, 3])).due).toBe('2029-01-10')
  })

  it('need the anchor date', () => {
    expect(evaluate(ei(), { today: '2026-03-01', columnDate: null, values: { 2: null } }).state).toBe('none')
    expect(referencedColumns(ei())).toEqual([2])
  })
})

describe('sequence rules in main', () => {
  let gridId: number, rowId: number, referral: number, col: number
  beforeEach(() => {
    t = createTestDb()
    const g = seedGrid(t.db, { columnTypes: ['text', 'date', 'deadline'], rowCount: 1 })
    gridId = g.gridId; rowId = g.rowIds[0]!
    ;[, referral, col] = g.columnIds as [number, number, number]
    const rule = Number(t.db.prepare("INSERT INTO alert_rules (name, thresholds, kind, rule_config) VALUES ('Early intervention', '[]', 'sequence', ?)")
      .run(JSON.stringify({ kind: 'sequence', anchorColumnId: referral, steps: [{ label: 'IFSP meeting', offset: { days: 45 } }, { label: 'Review', offset: { months: 6 } }] })).lastInsertRowid)
    t.db.prepare("UPDATE columns SET name = 'Plan steps', config = ? WHERE id = ?").run(JSON.stringify({ alert_rule_id: rule }), col)
    t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(rowId, referral, '2026-01-10')
  })
  afterEach(() => cleanupTestDb(t))

  it('checks off a step for the current anchor date, logs it, and undoes', () => {
    expect(loadDeadlines({ gridId, today: '2026-03-01' })[0]).toMatchObject({ step: 0, rule_kind: 'sequence' })
    const { sysLogId } = markStepDone(rowId, col, 0)
    expect((t.db.prepare('SELECT content FROM case_log WHERE id = ?').get(sysLogId) as { content: string }).content).toBe('Plan steps: IFSP meeting done (step 1 of 2)')
    expect(loadDeadlines({ gridId, today: '2026-03-01' })[0]).toMatchObject({ step: 1, due: '2026-07-10' })
    expect(loadGridDeadlineContext(gridId).progress[`${rowId}:${col}`]).toEqual([{ step: 0, anchor: '2026-01-10' }])
    undoStep(rowId, col, 0)
    expect(loadDeadlines({ gridId, today: '2026-03-01' })[0]!.step).toBe(0)
  })

  it('records the day a step was really done (audit 1.22)', () => {
    const { sysLogId } = markStepDone(rowId, col, 0, '2026-01-20')
    expect(t.db.prepare('SELECT done_at FROM deadline_progress WHERE row_id = ? AND column_id = ?').get(rowId, col)).toEqual({ done_at: '2026-01-20' })
    expect((t.db.prepare('SELECT content FROM case_log WHERE id = ?').get(sysLogId) as { content: string }).content).toMatch(/IFSP meeting done on Jan 20, 2026 \(step 1 of 2\)/)
  })

  it('starts over when the anchor date changes', () => {
    markStepDone(rowId, col, 0)
    t.db.prepare('UPDATE cells SET value = ? WHERE row_id = ? AND column_id = ?').run('2026-05-01', rowId, referral)
    expect(loadDeadlines({ gridId, today: '2026-05-02' })[0]).toMatchObject({ step: 0, due: '2026-06-15' })
  })

  it('needs the anchor date and a real step', () => {
    t.db.prepare('DELETE FROM cells WHERE column_id = ?').run(referral)
    expect(() => markStepDone(rowId, col, 0)).toThrow(/count from/)
    expect(() => markStepDone(rowId, col, -1)).toThrow(/step/)
  })
})
