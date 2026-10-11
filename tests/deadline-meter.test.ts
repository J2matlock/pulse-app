/** Meter deadlines (W05 §3.4): every N miles or a time limit, whichever is first. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'
import { evaluate, engineRuleFrom, meterRate, referencedColumns, meterHistoryColumn, implausibleReading } from '../src/shared/deadlineEngine'

let t: TestDb
vi.mock('../src/main/database', () => ({ getDb: () => t.db, cachedStmt: (_k: string, sql: string) => t.db.prepare(sql) }))

import { loadDeadlines, loadGridDeadlineContext } from '../src/main/deadlines'
import { markMeterDone } from '../src/main/deadline-actions'
import { localDateString, localDateFromToday } from '../src/shared/dates'

const oil = (extra: object = {}) => engineRuleFrom({ id: 1, kind: 'meter', rule_config: JSON.stringify({
  kind: 'meter', readingColumnId: 2, lastServiceReadingColumnId: 3, every: 5000, unit: 'mi', timeFallback: { months: 6 }, ...extra,
}) })

describe('meter rate', () => {
  it('needs two readings a week apart, and ignores a corrected (lower) odometer', () => {
    expect(meterRate([{ at: '2026-09-01', value: 1000 }], '2026-10-01')).toBeNull()
    expect(meterRate([{ at: '2026-09-28', value: 1000 }, { at: '2026-10-01', value: 1100 }], '2026-10-01')).toBeNull()
    expect(meterRate([{ at: '2026-09-01', value: 1000 }, { at: '2026-10-01', value: 2000 }], '2026-10-01')).toBeCloseTo(33.33, 1)
    expect(meterRate([{ at: '2026-08-01', value: 9000 }, { at: '2026-09-01', value: 1000 }, { at: '2026-10-01', value: 2000 }], '2026-10-01')).toBeCloseTo(33.33, 1)
    expect(meterRate([{ at: '2025-01-01', value: 0 }, { at: '2025-02-01', value: 900 }], '2026-10-01')).toBeNull() // too old
  })
})

describe('meter rules', () => {
  const values = { 2: '40000', 3: '37000' } // 2,000 mi left
  const history = [{ at: '2026-09-01', value: 39000 }]   // 1,000 mi in 31 days with today's reading

  it('estimate the date from how fast the readings grow', () => {
    const res = evaluate(oil(), { today: '2026-10-02', columnDate: '2026-09-01', values, meterHistory: history })
    expect(res).toMatchObject({ due: '2026-12-03', estimated: true, label: '2,000 mi left' })
    expect(res.detail).toBe('2,000 mi left (about Dec 3, 2026) or by Mar 1, 2027, whichever is first')
  })

  it('use the time limit when it comes first', () => {
    const res = evaluate(oil(), { today: '2026-10-02', columnDate: '2026-04-15', values, meterHistory: history })
    expect(res).toMatchObject({ due: '2026-10-15', estimated: false })
  })

  it('fall back to a typical rate, then to time only', () => {
    expect(evaluate(oil({ typicalPerDay: 100 }), { today: '2026-10-02', columnDate: '2026-09-01', values }).due).toBe('2026-10-22')
    expect(evaluate(oil(), { today: '2026-10-02', columnDate: '2026-09-01', values }).due).toBe('2027-03-01')
  })

  it('are due now when past the mileage', () => {
    const res = evaluate(oil(), { today: '2026-10-02', columnDate: '2026-09-01', values: { 2: '43000', 3: '37000' } })
    expect(res).toMatchObject({ due: '2026-10-02', state: 'due' })
    expect(res.detail).toMatch(/^1,000 mi over/)
  })

  it('refer to both reading columns and read history from the current one', () => {
    expect(referencedColumns(oil()).sort()).toEqual([2, 3])
    expect(meterHistoryColumn(oil())).toBe(2)
  })
})

describe('meter rules in main', () => {
  let gridId: number, rowId: number, serviced: number, odo: number, lastOdo: number
  beforeEach(() => {
    t = createTestDb()
    const g = seedGrid(t.db, { columnTypes: ['text', 'date', 'number', 'number'], rowCount: 1 })
    gridId = g.gridId; rowId = g.rowIds[0]!
    ;[, serviced, odo, lastOdo] = g.columnIds as [number, number, number, number]
    const rule = Number(t.db.prepare("INSERT INTO alert_rules (name, thresholds, kind, rule_config) VALUES ('Oil', '[]', 'meter', ?)")
      .run(JSON.stringify({ kind: 'meter', readingColumnId: odo, lastServiceReadingColumnId: lastOdo, every: 5000, unit: 'mi', timeFallback: { months: 6 } })).lastInsertRowid)
    t.db.prepare("UPDATE columns SET name = 'Oil change', config = ? WHERE id = ?").run(JSON.stringify({ alert_rule_id: rule }), serviced)
    const cell = (c: number, v: string) => Number(t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(rowId, c, v).lastInsertRowid)
    cell(serviced, localDateFromToday(-31)); cell(lastOdo, '37000')
    const odoCell = cell(odo, '40000')
    t.db.prepare("INSERT INTO cell_history (cell_id, row_id, column_id, old_value, new_value, changed_at) VALUES (?, ?, ?, NULL, '39000', datetime('now', '-31 days'))").run(odoCell, rowId, odo)
  })
  afterEach(() => cleanupTestDb(t))

  it('loads readings and lists the estimated deadline', () => {
    const [d] = loadDeadlines({ gridId })
    expect(d).toMatchObject({ rule_kind: 'meter', estimated: true, label: '2,000 mi left', column_name: 'Oil change' })
    expect(loadGridDeadlineContext(gridId).meter[`${rowId}:${odo}`]).toHaveLength(1)
  })

  it('marks done with a reading: date today, readings updated, history and timeline written', () => {
    const res = markMeterDone(rowId, serviced, 41250)
    expect(res.previous).toEqual({ [serviced]: localDateFromToday(-31), [lastOdo]: '37000', [odo]: '40000' })
    const value = (c: number) => (t.db.prepare('SELECT value FROM cells WHERE row_id = ? AND column_id = ?').get(rowId, c) as { value: string }).value
    expect([value(serviced), value(lastOdo), value(odo)]).toEqual([localDateString(), '41250', '41250'])
    expect((t.db.prepare('SELECT content FROM case_log WHERE id = ?').get(res.sysLogId) as { content: string }).content).toMatch(/Oil change done .* at 41,250 mi/)
    expect((t.db.prepare('SELECT COUNT(*) AS n FROM cell_history WHERE row_id = ?').get(rowId) as { n: number }).n).toBe(4)
  })

  it('uses the reading on file before the first change, so two readings give a forecast (D-32)', () => {
    t.db.prepare("UPDATE rows SET created_at = datetime('now', '-60 days') WHERE id = ?").run(rowId)
    t.db.prepare("UPDATE cell_history SET old_value = '38000' WHERE row_id = ?").run(rowId)
    const points = loadGridDeadlineContext(gridId).meter[`${rowId}:${odo}`]!
    expect(points).toHaveLength(2)
    expect(points[0]!.value).toBe(38000)
    expect(points[0]!.at).toBe(localDateFromToday(-60))
  })

  it('tells the dialog the unit and the readings on file (D-31)', () => {
    const [d] = loadDeadlines({ gridId })
    expect(d!.meter).toEqual({ unit: 'mi', every: 5000, current: 40000, lastService: 37000 })
    const info = d!.meter!
    expect(implausibleReading(4521, info)).toMatch(/lower than the reading at the last service/)
    expect(implausibleReading(41000, info)).toBeNull()
    expect(implausibleReading(400000, info)).toMatch(/more than the reading on file/)
  })

  it('can be marked done on an earlier day, but not a future one (audit 1.22)', () => {
    const res = markMeterDone(rowId, serviced, 41250, localDateFromToday(-3))
    expect((t.db.prepare('SELECT value FROM cells WHERE row_id = ? AND column_id = ?').get(rowId, serviced) as { value: string }).value).toBe(localDateFromToday(-3))
    expect(res.sysLogId).toBeGreaterThan(0)
    expect(() => markMeterDone(rowId, serviced, 41300, localDateFromToday(2))).toThrow(/hasn't happened yet/)
  })

  it('refuses rules without readings and bad numbers', () => {
    expect(() => markMeterDone(rowId, serviced, -5)).toThrow(/number/)
    t.db.prepare("UPDATE alert_rules SET kind = 'interval', rule_config = NULL").run()
    expect(() => markMeterDone(rowId, serviced, 100)).toThrow(/reading/)
  })
})
