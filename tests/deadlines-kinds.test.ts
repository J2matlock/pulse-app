/**
 * Loader with rule kinds beyond intervals (W05): relative rules are due with
 * their own cell empty, read other columns, use the workspace's days off,
 * and drop out once done.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'

let t: TestDb
vi.mock('../src/main/database', () => ({ getDb: () => t.db, cachedStmt: (_k: string, sql: string) => t.db.prepare(sql) }))

import { loadDeadlines } from '../src/main/deadlines'

let gridId: number, rowIds: number[], eligibility: number, planned: number
beforeEach(() => {
  t = createTestDb()
  const g = seedGrid(t.db, { columnTypes: ['text', 'date', 'date'], rowCount: 3 })
  ;({ gridId, rowIds } = g)
  ;[, eligibility, planned] = g.columnIds as [number, number, number]
  const rule = Number(t.db.prepare("INSERT INTO alert_rules (name, thresholds, kind, rule_config) VALUES ('Plan due', '[]', 'relative', ?)")
    .run(JSON.stringify({ kind: 'relative', anchorColumnId: eligibility, offset: { days: 90, direction: 'after' } })).lastInsertRowid)
  t.db.prepare('UPDATE columns SET name = ?, config = ? WHERE id = ?').run('Plan written', JSON.stringify({ alert_rule_id: rule }), planned)
  t.db.prepare("UPDATE columns SET name = 'Eligibility' WHERE id = ?").run(eligibility)
  const cell = t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
  cell.run(rowIds[0], eligibility, '2026-09-01')                     // due Nov 30, not done
  cell.run(rowIds[1], eligibility, '2026-09-01'); cell.run(rowIds[1], planned, '2026-09-15') // done
  // rowIds[2]: no eligibility date → nothing due
})
afterEach(() => cleanupTestDb(t))

describe('relative rules in the loader', () => {
  it('lists records whose own date is empty, worked out from the other column', () => {
    const items = loadDeadlines({ today: '2026-10-02' })
    expect(items.map(d => [d.row_id, d.due, d.state])).toEqual([[rowIds[0], '2026-11-30', 'ok']])
    expect(items[0]).toMatchObject({ column_name: 'Plan written', date_value: '' })
  })

  it('can include the done ones', () => {
    const items = loadDeadlines({ today: '2026-10-02', includeDone: true })
    expect(items.find(d => d.row_id === rowIds[1])!.state).toBe('done')
  })

  it('uses the days off saved in the workspace', () => {
    t.db.prepare("UPDATE alert_rules SET rule_config = ? WHERE name = 'Plan due'")
      .run(JSON.stringify({ kind: 'relative', anchorColumnId: eligibility, offset: { businessDays: 3, direction: 'after' } }))
    t.db.prepare("INSERT INTO settings (key, value) VALUES ('workspace_holidays', '[\"2026-09-02\"]')").run()
    // Tue Sep 1 + 3 working days, skipping the Sep 2 holiday and the weekend: Sep 3, 4, 7
    expect(loadDeadlines({ today: '2026-08-01', gridId })[0]!.due).toBe('2026-09-07')
  })

  it('filters by records', () => {
    expect(loadDeadlines({ today: '2026-10-02', rowIds: [rowIds[2]!] })).toEqual([])
  })
})

describe('calendar rules on a deadline column', () => {
  it('lists every record with no date typed in', () => {
    const rule = Number(t.db.prepare("INSERT INTO alert_rules (name, thresholds, kind, rule_config) VALUES ('Estimates', '[]', 'calendar', ?)")
      .run(JSON.stringify({ kind: 'calendar', months: [1, 4, 6, 9], day: 15 })).lastInsertRowid)
    const col = Number(t.db.prepare("INSERT INTO columns (grid_id, name, column_type, position, config) VALUES (?, 'Estimated tax', 'deadline', 9, ?)")
      .run(gridId, JSON.stringify({ alert_rule_id: rule })).lastInsertRowid)
    t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(rowIds[0], col, '2026-09-15') // done for September
    const items = loadDeadlines({ today: '2026-10-02', gridId }).filter(d => d.column_id === col)
    expect(items.map(d => [d.row_id, d.due])).toEqual([[rowIds[0], '2027-01-15'], [rowIds[1], '2027-01-15'], [rowIds[2], '2027-01-15']])
  })
})
