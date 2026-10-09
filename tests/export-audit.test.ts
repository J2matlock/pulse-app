import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, existsSync, statSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createTestDb, cleanupTestDb, seedGrid, setDbWords, type TestDb } from './helpers'

let testDb: TestDb
vi.mock('../src/main/database', () => ({ getDb: () => testDb.db }))
vi.mock('electron', () => ({ app: { getPath: () => tmpdir(), isPackaged: false } }))

import { loadAuditTrail, exportAuditReport } from '../src/main/export-audit'

let gridId: number
let rowA: number
let rowB: number
// Stored timestamps are UTC; write them from local times so ranges are predictable
const utc = (local: string) => (testDb.db.prepare("SELECT datetime(?, 'utc') AS t").get(local) as { t: string }).t

beforeEach(() => {
  testDb = createTestDb()
  setDbWords(testDb.db)
  const g = seedGrid(testDb.db, { columnTypes: ['text', 'date'], rowCount: 2 })
  gridId = g.gridId
  ;[rowA, rowB] = g.rowIds as [number, number]
  const db = testDb.db
  db.prepare('UPDATE rows SET created_at = ?, display_name = ? WHERE id = ?').run(utc('2027-01-02 09:00:00'), 'Ana Bell', rowA)
  db.prepare('UPDATE rows SET created_at = ?, display_name = ? WHERE id = ?').run(utc('2027-01-02 09:00:00'), 'Cal Diaz', rowB)
  const cell = db.prepare("INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, '2027-03-01', datetime('now'))").run(rowA, g.columnIds[1]).lastInsertRowid
  db.prepare('INSERT INTO cell_history (cell_id, row_id, column_id, old_value, new_value, changed_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(cell, rowA, g.columnIds[1], '2027-02-01', '2027-03-01', utc('2027-03-01 10:00:00'))
  const note = db.prepare("INSERT INTO case_log (row_id, content, log_type, created_at, updated_at) VALUES (?, 'Visited at home', 'visit', ?, ?)")
    .run(rowA, utc('2027-03-01 11:00:00'), utc('2027-03-01 11:00:00')).lastInsertRowid
  db.prepare('INSERT INTO case_log_edits (case_log_id, content, replaced_at) VALUES (?, ?, ?)').run(note, 'Visted at hme', utc('2027-03-01 11:05:00'))
  db.prepare("INSERT INTO case_log (row_id, content, log_type, created_at, updated_at, voided_at, voided_reason) VALUES (?, 'Wrong client', 'phone', ?, ?, ?, 'Undone')")
    .run(rowA, utc('2027-03-02 08:00:00'), utc('2027-03-02 08:00:00'), utc('2027-03-02 08:10:00'))
  db.prepare("INSERT INTO checklist_items (row_id, title, position, is_completed, completed_at, created_at) VALUES (?, 'Sign plan', 0, 1, ?, datetime('now'))")
    .run(rowA, utc('2027-03-03 14:00:00'))
})
afterEach(() => cleanupTestDb(testDb))

describe('audit trail', () => {
  it('names notes by their type\'s current label, without doubling "note"', () => {
    testDb.db.prepare("UPDATE activity_types SET label = 'Home visit' WHERE key = 'visit'").run()
    testDb.db.prepare("UPDATE activity_types SET label = 'Phone note' WHERE key = 'phone'").run()
    const [a] = loadAuditTrail({ rowId: rowA })
    const whats = a!.events.map(e => e.what)
    expect(whats).toContain('Home visit note')
    expect(whats).toContain('Phone note')
  })

  it('lists every recorded change for a client in time order', () => {
    const [a] = loadAuditTrail({ rowId: rowA })
    expect(a!.clientName).toBe('Ana Bell')
    expect(a!.events.map(e => e.what)).toEqual([
      'Client added', 'Column 2 changed', 'Visit note', 'Note edited', 'Phone note', 'Note voided', 'Checklist item done',
    ])
    expect(a!.events[1]!.details).toBe('From Feb 1, 2027 to Mar 1, 2027')
    expect(a!.events[3]!.details).toBe('Before the edit: Visted at hme')
    expect(a!.events[5]!.details).toContain('Reason: Undone')
  })

  it('filters by local date range, inclusive', () => {
    const [a] = loadAuditTrail({ rowId: rowA, from: '2027-03-02', to: '2027-03-02' })
    expect(a!.events.map(e => e.what)).toEqual(['Phone note', 'Note voided'])
  })

  it('covers a whole caseload', () => {
    const all = loadAuditTrail({ gridId })
    expect(all.map(c => c.clientName)).toEqual(['Ana Bell', 'Cal Diaz'])
    expect(all[1]!.events.map(e => e.what)).toEqual(['Client added'])
  })

  it("uses each list's own record word", () => {
    testDb.db.prepare('UPDATE grids SET vocab = ? WHERE id = ?').run(JSON.stringify({ record: { one: 'vehicle', many: 'vehicles', article: 'a' } }), gridId)
    const all = loadAuditTrail({ gridId })
    expect(all[1]!.events.map(e => e.what)).toEqual(['Vehicle added'])
  })

  it('writes a PDF and reports the totals', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'audit-'))
    const dest = join(dir, 'audit.pdf')
    const summary = await exportAuditReport({ gridId, from: '2027-03-01' }, dest, 'Test Caseload')
    expect(summary).toEqual({ clients: 1, events: 6 })
    expect(existsSync(dest) && statSync(dest).size > 1000).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })
})
