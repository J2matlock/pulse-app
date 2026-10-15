import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, statSync, readFileSync } from 'fs'
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
import { loadDeadlines } from '../src/main/deadlines'

let gridId: number
let rows: number[]
let dateCol: number
const utc = (local: string) => (testDb.db.prepare("SELECT datetime(?, 'utc') AS t").get(local) as { t: string }).t

beforeEach(() => {
  // March 2026 is a past month in these checks, whatever day the suite runs (AUDIT-184)
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 4, 15, 12, 0, 0) })
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
afterEach(() => { vi.useRealTimers(); cleanupTestDb(testDb) })

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

  it('lists a ruled date Pulse can\'t read under Missing information (AUDIT-026)', () => {
    testDb.db.prepare('UPDATE cells SET value = ? WHERE row_id = ? AND column_id = ?').run('TBD', rows[0], dateCol)
    const [g] = getComplianceSummary('2026-03').grids
    expect(g!.missingInfo).toEqual({ clients: 1, exceptions: [{ clientName: 'Ana', missing: ['Last Visit: not a date'] }] })
  })

  it('runs the real rule for each kind as of month end (D-03)', () => {
    const db = testDb.db
    const addCol = (name: string, type: string, ruleId: number | bigint, pos: number) =>
      Number(db.prepare('INSERT INTO columns (grid_id, name, column_type, position, config) VALUES (?, ?, ?, ?, ?)').run(gridId, name, type, pos, JSON.stringify({ alert_rule_id: Number(ruleId) })).lastInsertRowid)
    const put = db.prepare("INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, ?, datetime('now'))")
    // A calendar rule on Mar 15: the column holds the day it was last done
    const quarterly = db.prepare("INSERT INTO alert_rules (name, thresholds, kind, rule_config) VALUES ('Quarterly', '[]', 'calendar', ?)")
      .run(JSON.stringify({ kind: 'calendar', months: [3, 6, 9, 12], day: 15 })).lastInsertRowid
    const qCol = addCol('Quarterly check', 'date', quarterly, 5)
    put.run(rows[0], qCol, '2026-03-15')  // done for March: not an exception
    put.run(rows[1], qCol, '2025-12-10')  // never done for March: overdue
    // Hidden by "only when Status is Open" for Cy (Closed)
    const status = Number(db.prepare("INSERT INTO columns (grid_id, name, column_type, position, config) VALUES (?, 'Status', 'text', 6, '{}')").run(gridId).lastInsertRowid)
    for (const [i, v] of ['Open', 'Open', 'Closed'].entries()) put.run(rows[i], status, v)
    db.prepare("UPDATE alert_rules SET rule_condition = ? WHERE id = ?").run(JSON.stringify({ columnId: status, op: 'is', values: ['Open'], whenFalse: 'hide' }), quarterly)
    put.run(rows[2], qCol, '2025-01-01')
    // A sequence on a Deadline column, extended past month end for Ana
    const seq = db.prepare("INSERT INTO alert_rules (name, thresholds, kind, rule_config) VALUES ('Intake steps', '[]', 'sequence', ?)")
      .run(JSON.stringify({ kind: 'sequence', anchorColumnId: dateCol, steps: [{ label: 'Plan', offset: { days: 5 } }] })).lastInsertRowid
    const sCol = addCol('Plan due', 'deadline', seq, 7)
    db.prepare("INSERT INTO deadline_extensions (row_id, column_id, step, original_due, new_due, reason, anchor_value, created_at) VALUES (?, ?, 0, '2026-03-25', '2026-04-15', 'Family away', '2026-03-20', ?)")
      .run(rows[0], sCol, utc('2026-03-26 09:00:00'))

    const [g] = getComplianceSummary('2026-03').grids
    const ex = g!.deadlines.exceptions.map(e => `${e.clientName}|${e.column}`)
    expect(ex).toContain('Ben|Quarterly check')
    expect(ex).not.toContain('Ana|Quarterly check')
    expect(ex).not.toContain('Cy|Quarterly check')
    // Deadline columns count; Ana's step was extended, Ben's (Feb 15) and Cy's (Jan 10) are late
    expect(ex).not.toContain('Ana|Plan due')
    expect(ex).toContain('Ben|Plan due')
    expect(ex).toContain('Cy|Plan due')
    // 3 Last Visit + 2 quarterly (Cy hidden) + 3 plan
    expect(g!.deadlines.total).toBe(8)
  })

  it('counts a late calendar completion the way the dashboard does (AUDIT-074)', () => {
    vi.setSystemTime(new Date(2026, 6, 15, 12, 0, 0))
    const db = testDb.db
    const quarterly = db.prepare("INSERT INTO alert_rules (name, thresholds, kind, rule_config) VALUES ('Quarterly', '[]', 'calendar', ?)")
      .run(JSON.stringify({ kind: 'calendar', months: [3, 6, 9, 12], day: 15 })).lastInsertRowid
    const qCol = Number(db.prepare('INSERT INTO columns (grid_id, name, column_type, position, config) VALUES (?, ?, ?, ?, ?)')
      .run(gridId, 'Quarterly check', 'date', 5, JSON.stringify({ alert_rule_id: Number(quarterly) })).lastInsertRowid)
    // Ana's March check was done late, on May 20: it pays March, so June 15 is still owed
    const cell = db.prepare("INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, '2026-05-20', datetime('now'))").run(rows[0], qCol).lastInsertRowid
    const hist = db.prepare('INSERT INTO cell_history (cell_id, row_id, column_id, old_value, new_value, changed_at) VALUES (?, ?, ?, ?, ?, ?)')
    hist.run(cell, rows[0], qCol, '2025-12-15', '2026-05-20', utc('2026-05-20 10:00:00'))
    // A change after the cutoff doesn't decide what June looked like
    hist.run(cell, rows[0], qCol, '2026-05-20', '2026-05-20', utc('2026-07-02 10:00:00'))

    const [g] = getComplianceSummary('2026-06').grids
    const row = g!.deadlines.exceptions.find(e => e.clientName === 'Ana' && e.column === 'Quarterly check')
    expect(row).toEqual({ clientName: 'Ana', column: 'Quarterly check', due: '2026-06-15', daysOverdue: 15 })

    // Before the second change the dashboard, as of June 30, agreed
    db.prepare('DELETE FROM cell_history WHERE changed_at > ?').run(utc('2026-06-30 23:59:59'))
    const dash = loadDeadlines({ today: '2026-06-30', gridId }).find(d => d.row_id === rows[0] && d.column_id === qCol)
    expect(dash).toMatchObject({ due: '2026-06-15', state: 'overdue', daysUntil: -15 })
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

describe('the monthly summary, proofread (persona study R7)', () => {
  const pdfText = async () => {
    const dest = join(testDb.tmpDir, 'summary.pdf')
    await exportComplianceSummary('2026-03', undefined, dest)
    return readFileSync(dest, 'latin1')
  }

  it('says "4 counseling sessions a month" and wraps a long requirement line inside the page', async () => {
    saveRequirements(gridId, [
      { label: 'Counseling session', note_types: ['visit'], per_month: 4 },
      { label: 'Face-to-face visit', note_types: ['visit'], per_month: 1 },
      { label: 'Parent check-in', note_types: ['visit'], per_month: 2 },
    ])
    const labels = getComplianceSummary('2026-03').grids[0]!.contacts!.requirementLabels
    expect(labels.map(l => l.replace(/ \(.*\)$/, ''))).toEqual(['4 counseling sessions a month', '1 face-to-face visit a month', '2 parent check-ins a month'])
    const pdf = await pdfText()
    // The whole line no longer goes out as one string: it's split onto lines that fit
    expect(pdf).not.toContain(`required: ${labels.join(', ')})`)
    // (PDF text escapes its brackets) the first line stops where the page does
    expect(pdf).toContain('(0%  \\(0 of 3 records; required: 4 counseling sessions a month \\(March) Tj')
  })

  it('adds the minutes per record when time on notes is on', async () => {
    testDb.db.prepare("INSERT INTO case_log (row_id, content, log_type, minutes, occurred_at, created_at, updated_at) VALUES (?, 'x', 'visit', ?, ?, ?, datetime('now'))")
      .run(rows[1], 50, utc('2026-03-10 10:00:00'), utc('2026-03-10 10:00:00'))
    setDbFeatures(testDb.db, { requirements: true, timeTracking: false })
    expect(await pdfText()).not.toContain('Minutes this month')
    setDbFeatures(testDb.db, { requirements: true, timeTracking: true })
    const pdf = await pdfText()
    expect(pdf).toContain('(Minutes this month)')
    expect(pdf).toContain('(50 \\(50 min\\))')
    expect(pdf).toContain('(Ben)')
  })
})
