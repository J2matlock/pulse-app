/** Extensions (W05 §4): a new date with a reason, tied to the cycle it extends. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'
import { evaluate, engineRuleFrom, applyExtension, matchExtension, extensionAnchor } from '../src/shared/deadlineEngine'

let t: TestDb
vi.mock('../src/main/database', () => ({ getDb: () => t.db, cachedStmt: (_k: string, sql: string) => t.db.prepare(sql) }))

import { loadDeadlines, loadGridDeadlineContext } from '../src/main/deadlines'
import { extendDeadline, revokeExtension, setExtensionActive } from '../src/main/deadline-actions'
import { getComplianceSummary } from '../src/main/compliance'
import { localDateFromToday } from '../src/shared/dates'

describe('extensions in the engine', () => {
  it('move a due date and say where it came from', () => {
    const res = evaluate(engineRuleFrom({ id: 1, interval_days: 30 }), { today: '2026-10-02', columnDate: '2026-09-01' })
    const moved = applyExtension(res, { newDue: '2026-10-20', reason: 'Waiting on report' }, '2026-10-02')
    expect(moved).toMatchObject({ due: '2026-10-20', daysUntil: 18, extended: { from: '2026-10-01', reason: 'Waiting on report' } })
    expect(moved.detail).toBe('Extended to Oct 20, 2026 (was Oct 1, 2026): Waiting on report')
  })

  it('apply only to the same date and step', () => {
    const exts = [{ id: 1, newDue: '2026-10-20', reason: 'x', anchor: '2026-09-01', step: null }]
    expect(matchExtension(exts, '2026-09-01', undefined)?.id).toBe(1)
    expect(matchExtension(exts, '2026-10-01', undefined)).toBeUndefined()
    expect(matchExtension([{ ...exts[0]!, step: 1 }], '2026-09-01', 0)).toBeUndefined()
  })

  const quota = engineRuleFrom({ id: 2, kind: 'quota', rule_config: JSON.stringify({
    kind: 'quota', activityTypes: ['session'], startColumnId: 2, endColumnId: 3, limit: 12, warnRemaining: 2, warnDaysBeforeEnd: 14,
  }) })

  it('tie a quota extension to the authorization end date, so a renewal drops it', () => {
    const before = extensionAnchor(quota, null, { 2: '2026-01-01', 3: '2026-10-31' })
    expect(before).toBe('2026-10-31')
    const exts = [{ id: 1, newDue: '2026-11-30', reason: 'x', anchor: before, step: null }]
    const renewed = extensionAnchor(quota, null, { 2: '2026-11-01', 3: '2027-04-30' })
    expect(matchExtension(exts, renewed, undefined)).toBeUndefined()
  })

  it('keep a used-up quota overdue when it is extended', () => {
    const res = evaluate(quota, { today: '2026-10-02', columnDate: null, values: { 2: '2026-01-01', 3: '2026-10-31' }, activityCount: 12 })
    const moved = applyExtension(res, { newDue: '2026-11-30', reason: 'Waiting on renewal' }, '2026-10-02')
    expect(moved).toMatchObject({ due: '2026-11-30', state: 'overdue', label: 'All 12 used', daysUntil: 0 })
  })
})

describe('extensions in main', () => {
  let gridId: number, rowId: number, col: number
  beforeEach(() => {
    t = createTestDb()
    const g = seedGrid(t.db, { columnTypes: ['text', 'date'], rowCount: 1 })
    gridId = g.gridId; rowId = g.rowIds[0]!; col = g.columnIds[1]!
    const rule = Number(t.db.prepare("INSERT INTO alert_rules (name, thresholds, interval_days) VALUES ('Monthly', '[]', 30)").run().lastInsertRowid)
    t.db.prepare("UPDATE columns SET name = 'Annual review', config = ? WHERE id = ?").run(JSON.stringify({ alert_rule_id: rule }), col)
    t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(rowId, col, localDateFromToday(-31))
  })
  afterEach(() => cleanupTestDb(t))

  it('extend with a reason, show it everywhere, log it, and remove it', () => {
    const newDue = localDateFromToday(10)
    const { id, sysLogId } = extendDeadline(rowId, col, newDue, "  Waiting on the doctor's report ")
    const [d] = loadDeadlines({ gridId })
    expect(d).toMatchObject({ due: newDue, extension_id: id, extended: { reason: "Waiting on the doctor's report" } })
    expect(loadGridDeadlineContext(gridId).extensions[`${rowId}:${col}`]![0]!.newDue).toBe(newDue)
    expect((t.db.prepare('SELECT content FROM case_log WHERE id = ?').get(sysLogId) as { content: string }).content)
      .toMatch(/^Annual review extended to .* \(was .*\): Waiting on the doctor's report$/)

    revokeExtension(id)
    expect(loadDeadlines({ gridId })[0]!.due).toBe(localDateFromToday(-1))
    expect(() => revokeExtension(id)).toThrow(/already removed/)
    setExtensionActive(id, true)
    expect(loadDeadlines({ gridId })[0]!.due).toBe(newDue)
  })

  it('a new date starts a new cycle and the extension stops applying', () => {
    extendDeadline(rowId, col, localDateFromToday(10), 'Late paperwork')
    t.db.prepare('UPDATE cells SET value = ? WHERE row_id = ? AND column_id = ?').run(localDateFromToday(0), rowId, col)
    const [d] = loadDeadlines({ gridId })
    expect(d!.due).toBe(localDateFromToday(30))
    expect(d!.extended).toBeUndefined()
  })

  it('a second extension replaces the first and keeps the original date', () => {
    const first = extendDeadline(rowId, col, localDateFromToday(10), 'One')
    extendDeadline(rowId, col, localDateFromToday(20), 'Two')
    expect(t.db.prepare('SELECT revoked_at IS NOT NULL AS gone FROM deadline_extensions WHERE id = ?').get(first.id)).toEqual({ gone: 1 })
    expect(t.db.prepare('SELECT original_due FROM deadline_extensions WHERE revoked_at IS NULL').get()).toEqual({ original_due: localDateFromToday(-1) })
  })

  it('needs a date, a reason and something due', () => {
    expect(() => extendDeadline(rowId, col, 'soon', 'x')).toThrow(/new date/)
    expect(() => extendDeadline(rowId, col, localDateFromToday(5), '   ')).toThrow(/why/)
    expect(() => extendDeadline(rowId, col, localDateFromToday(-1), 'same')).toThrow(/already the due date/)
    t.db.prepare('DELETE FROM cells WHERE column_id = ?').run(col)
    expect(() => extendDeadline(rowId, col, localDateFromToday(5), 'x')).toThrow(/nothing due/)
  })

  it('counts extensions given this month in the summary report', () => {
    extendDeadline(rowId, col, localDateFromToday(10), 'One')
    const month = localDateFromToday(0).slice(0, 7)
    expect(getComplianceSummary(month, gridId).grids[0]!.deadlines.extended).toBe(1)
  })
})
