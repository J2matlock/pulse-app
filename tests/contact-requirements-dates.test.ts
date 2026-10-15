/**
 * A date column that follows notes ("Last Contact") counts toward contact
 * requirements, once per day (persona study R4: an imported caseload read
 * "0 of 80" on day one, and every contact was entered twice).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'

let testDb: TestDb
vi.mock('../src/main/database', () => ({
  getDb: () => testDb.db,
  cachedStmt: (_key: string, sql: string) => testDb.db.prepare(sql),
  upsertCell: (rowId: number, columnId: number, value: string | null) => testDb.db.prepare(`
    INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(row_id, column_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(rowId, columnId, value),
}))

import { saveRequirements, getRequirementStatus } from '../src/main/contact-requirements'
import { applyNoteDateUpdates } from '../src/main/note-date-updates'

let gridId: number
let rowIds: number[]
let lastContact: number
let plainDate: number
const set = (rowId: number, col: number, value: string) => testDb.db.prepare(`
  INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)
  ON CONFLICT(row_id, column_id) DO UPDATE SET value = excluded.value
`).run(rowId, col, value)
/** A note at local noon on a day, so the local day is the same in every time zone */
const note = (rowId: number, type: string, day: string) => testDb.db.prepare(`
  INSERT INTO case_log (row_id, content, log_type, occurred_at, created_at, updated_at)
  VALUES (?, 'x', ?, datetime(? || ' 12:00:00', 'utc'), datetime('now'), datetime('now'))
`).run(rowId, type, day)
const counts = (rowId: number, ref = '2026-10-20') => getRequirementStatus(ref)[0]!.clients.find(c => c.rowId === rowId)!.counts

beforeEach(() => {
  testDb = createTestDb()
  const g = seedGrid(testDb.db, { columnTypes: ['text', 'date', 'date'], columnCount: 3, rowCount: 3 })
  gridId = g.gridId
  rowIds = g.rowIds
  ;[, lastContact, plainDate] = g.columnIds as [number, number, number]
  testDb.db.prepare('UPDATE columns SET config = ? WHERE id = ?').run(JSON.stringify({ note_updates: ['visit', 'phone', 'email'] }), lastContact)
  saveRequirements(gridId, [
    { label: 'Face-to-face', note_types: ['visit'], per_month: 1 },
    { label: 'Any contact', note_types: ['visit', 'phone'], per_month: 2 },
    { label: 'Letters', note_types: ['email'], per_month: 1, period: 'week' },
  ])
})
afterEach(() => cleanupTestDb(testDb))

describe('a date that follows notes counts as a contact', () => {
  it('an imported Last Contact of Oct 5 counts 1 for October, toward every requirement it matches', () => {
    set(rowIds[0]!, lastContact, '2026-10-05')
    set(rowIds[1]!, lastContact, '2026-09-28')   // last month
    set(rowIds[2]!, plainDate, '2026-10-05')     // a column that doesn't follow notes
    expect(counts(rowIds[0]!)).toEqual([1, 1, 0])  // the week of Oct 20 doesn't hold Oct 5
    expect(counts(rowIds[0]!, '2026-10-06')).toEqual([1, 1, 1])
    expect(counts(rowIds[1]!)).toEqual([0, 0, 0])
    expect(counts(rowIds[2]!)).toEqual([0, 0, 0])
  })

  it('a Visit note on Oct 5 plus Last Contact Oct 5 counts 1, not 2', () => {
    set(rowIds[0]!, lastContact, '2026-10-05')
    note(rowIds[0]!, 'visit', '2026-10-05')
    expect(counts(rowIds[0]!)).toEqual([1, 1, 0])
  })

  it('a Phone note on Oct 12 moves Last Contact to Oct 12 and counts 1 more', () => {
    set(rowIds[0]!, lastContact, '2026-10-05')
    note(rowIds[0]!, 'phone', '2026-10-12')
    applyNoteDateUpdates(rowIds[0]!, 'phone', '2026-10-12')
    expect((testDb.db.prepare('SELECT value FROM cells WHERE row_id = ? AND column_id = ?').get(rowIds[0], lastContact) as { value: string }).value).toBe('2026-10-12')
    // The Oct 5 date is gone (moved), the phone note counts once, and Oct 12 isn't counted again
    expect(counts(rowIds[0]!)).toEqual([0, 1, 0])
  })

  it('a note of another type that day doesn\'t hide it, and a note type it doesn\'t follow isn\'t counted from it', () => {
    set(rowIds[0]!, lastContact, '2026-10-05')
    note(rowIds[0]!, 'meeting', '2026-10-05')
    expect(counts(rowIds[0]!)).toEqual([1, 1, 0])
    testDb.db.prepare('UPDATE columns SET config = ? WHERE id = ?').run(JSON.stringify({ note_updates: ['email'] }), lastContact)
    expect(counts(rowIds[0]!)).toEqual([0, 0, 0])
  })

  it('leaves out trashed and archived records, and voided notes don\'t hide the date', () => {
    set(rowIds[0]!, lastContact, '2026-10-05')
    set(rowIds[1]!, lastContact, '2026-10-05')
    testDb.db.prepare("UPDATE rows SET is_active = 0, deleted_at = datetime('now') WHERE id = ?").run(rowIds[1])
    expect(getRequirementStatus('2026-10-20')[0]!.clients.map(c => c.rowId)).not.toContain(rowIds[1])
    note(rowIds[0]!, 'visit', '2026-10-05')
    testDb.db.prepare("UPDATE case_log SET voided_at = datetime('now') WHERE row_id = ?").run(rowIds[0])
    expect(counts(rowIds[0]!)).toEqual([1, 1, 0])
  })

  it('a date with a time, or that isn\'t a date, is read by its day or left out', () => {
    set(rowIds[0]!, lastContact, '2026-10-05T09:30')
    set(rowIds[1]!, lastContact, 'soon')
    expect(counts(rowIds[0]!)).toEqual([1, 1, 0])
    expect(counts(rowIds[1]!)).toEqual([0, 0, 0])
  })
})
