import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, statSync } from 'fs'
import { join } from 'path'
import { createTestDb, cleanupTestDb, seedGrid, setDbFeatures, type TestDb } from './helpers'

let testDb: TestDb
vi.mock('../src/main/database', () => ({
  getDb: () => testDb.db,
  cachedStmt: (_key: string, sql: string) => testDb.db.prepare(sql),
  upsertCell: () => {},
}))
vi.mock('electron', () => ({ app: { getPath: () => '/tmp', isPackaged: false } }))

import { getComplianceSummary, exportComplianceSummary, monthAsOf } from '../src/main/compliance'
import { saveRequirements } from '../src/main/contact-requirements'

let gridId: number
let rows: number[]
let dateCol: number
const utc = (local: string) => (testDb.db.prepare("SELECT datetime(?, 'utc') AS t").get(local) as { t: string }).t

beforeEach(() => {
  testDb = createTestDb()
  setDbFeatures(testDb.db)
  const g = seedGrid(testDb.db, { columnTypes: ['text', 'date'], columnCount: 2, rowCount: 3 })
  gridId = g.gridId; rows = g.rowIds; dateCol = g.columnIds[1]!
  const db = testDb.db
  const rule = db.prepare("INSERT INTO alert_rules (name, thresholds, interval_days, created_at) VALUES ('Every 30 days', '[]', 30, datetime('now'))").run().lastInsertRowid
  db.prepare('UPDATE columns SET name = ?, config = ? WHERE id = ?').run('Last Visit', JSON.stringify({ alert_rule_id: rule }), dateCol)
  // After the column rename: renaming a column recomputes display names
  ;['Ana', 'Ben', 'Cy'].forEach((n, i) => db.prepare('UPDATE rows SET display_name = ?, created_at = ? WHERE id = ?').run(n, utc('2026-01-01 08:00:00'), rows[i]))
  const put = db.prepare("INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, ?, datetime('now'))")
  put.run(rows[0], dateCol, '2026-03-20')  // due Apr 19: on time at Mar 31
  put.run(rows[1], dateCol, '2026-02-10')  // due Mar 12: overdue at Mar 31
  // Cy: today's value is recent, but on Mar 31 it was Jan 5 (changed in April)
  const cyCell = put.run(rows[2], dateCol, '2026-04-10').lastInsertRowid
  db.prepare('INSERT INTO cell_history (cell_id, row_id, column_id, old_value, new_value, changed_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(cyCell, rows[2], dateCol, '2026-01-05', '2026-04-10', utc('2026-04-10 09:00:00'))
  saveRequirements(gridId, [{ label: 'Visit', note_types: ['visit'], per_month: 1 }])
  db.prepare("INSERT INTO case_log (row_id, content, log_type, created_at, updated_at) VALUES (?, 'x', 'visit', ?, datetime('now'))").run(rows[0], utc('2026-03-15 10:00:00'))
})
afterEach(() => cleanupTestDb(testDb))

describe('compliance summary', () => {
  it('uses month end for past months', () => {
    expect(monthAsOf('2026-03')).toBe('2026-03-31')
  })

  it('reports contacts and deadlines as they stood at month end', () => {
    const [g] = getComplianceSummary('2026-03').grids
    expect(g!.contacts).toMatchObject({ total: 3, met: 1 })
    expect(g!.contacts!.exceptions.map(e => e.clientName)).toEqual(['Ben', 'Cy'])
    expect(g!.deadlines.total).toBe(3)
    expect(g!.deadlines.onTime).toBe(1)
    expect(g!.deadlines.exceptions).toEqual([
      { clientName: 'Ben', column: 'Last Visit', due: '2026-03-12', daysOverdue: 19 },
      { clientName: 'Cy', column: 'Last Visit', due: '2026-02-04', daysOverdue: 55 },
    ])
  })

  it('leaves requirements out while the feature is switched off', () => {
    setDbFeatures(testDb.db, { requirements: false })
    const s = getComplianceSummary('2026-03')
    expect(s.requirementsOn).toBe(false)
    expect(s.grids[0]!.contacts).toBeNull()
  })

  it('writes a PDF', async () => {
    const dest = join(testDb.tmpDir, 'compliance.pdf')
    await exportComplianceSummary('2026-03', undefined, dest, 'Jordan')
    expect(existsSync(dest) && statSync(dest).size > 1000).toBe(true)
  })
})
