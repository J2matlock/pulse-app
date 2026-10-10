/**
 * Case notes that update date columns (A1).
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

import { applyNoteDateUpdates, revertNoteDates, occurredTimestamp } from '../src/main/note-date-updates'

let rowId: number
let visitCol: number
let phoneCol: number
let plainCol: number
const cell = (col: number) => (testDb.db.prepare('SELECT value FROM cells WHERE row_id = ? AND column_id = ?').get(rowId, col) as { value: string } | undefined)?.value

beforeEach(() => {
  testDb = createTestDb()
  const g = seedGrid(testDb.db, { columnTypes: ['text', 'date', 'date', 'date'], columnCount: 4, rowCount: 1 })
  rowId = g.rowIds[0]!
  ;[, visitCol, phoneCol, plainCol] = g.columnIds as [number, number, number, number]
  const setCfg = testDb.db.prepare('UPDATE columns SET config = ? WHERE id = ?')
  setCfg.run(JSON.stringify({ note_updates: ['visit'] }), visitCol)
  setCfg.run(JSON.stringify({ note_updates: ['phone', 'visit'] }), phoneCol)
})
afterEach(() => cleanupTestDb(testDb))

describe('applyNoteDateUpdates', () => {
  it('works with people\'s own note types', () => {
    testDb.db.prepare("INSERT INTO activity_types (key, label, position) VALUES ('session', 'Session', 9)").run()
    testDb.db.prepare('UPDATE columns SET config = ? WHERE id = ?').run(JSON.stringify({ note_updates: ['session'] }), plainCol)
    applyNoteDateUpdates(rowId, 'session', '2027-03-10')
    expect(cell(plainCol)).toBe('2027-03-10')
    expect(cell(visitCol)).toBeUndefined()
  })

  it('sets every date column that follows the note type', () => {
    const updates = applyNoteDateUpdates(rowId, 'visit', '2027-03-10')
    expect(updates.map(u => u.column_id).sort()).toEqual([visitCol, phoneCol].sort())
    expect(cell(visitCol)).toBe('2027-03-10')
    expect(cell(phoneCol)).toBe('2027-03-10')
    expect(cell(plainCol)).toBeUndefined()
  })

  it('only touches columns that follow that type', () => {
    applyNoteDateUpdates(rowId, 'phone', '2027-03-10')
    expect(cell(visitCol)).toBeUndefined()
    expect(cell(phoneCol)).toBe('2027-03-10')
  })

  it('never moves a date backward and records history with the old value', () => {
    testDb.db.prepare("INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, '2027-05-01', datetime('now'))").run(rowId, visitCol)
    testDb.db.prepare("INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, '2027-01-01', datetime('now'))").run(rowId, phoneCol)
    const updates = applyNoteDateUpdates(rowId, 'visit', '2027-03-10')
    expect(updates).toEqual([{ column_id: phoneCol, column_name: expect.any(String), old_value: '2027-01-01', new_value: '2027-03-10' }])
    expect(cell(visitCol)).toBe('2027-05-01')
    const hist = testDb.db.prepare('SELECT old_value, new_value FROM cell_history WHERE column_id = ?').get(phoneCol)
    expect(hist).toEqual({ old_value: '2027-01-01', new_value: '2027-03-10' })
  })

  it('ignores system entries', () => {
    expect(applyNoteDateUpdates(rowId, 'system', '2027-03-10')).toEqual([])
    expect(cell(phoneCol)).toBeUndefined()
  })
})

describe('voiding or deleting a note puts its dates back (audit 1.23)', () => {
  const addNote = (type: string, day: string) => {
    const id = Number(testDb.db.prepare("INSERT INTO case_log (row_id, content, log_type, occurred_at) VALUES (?, 'x', ?, ?)").run(rowId, type, occurredTimestamp(day)).lastInsertRowid)
    applyNoteDateUpdates(rowId, type, day, id)
    return id
  }
  const voidNote = (id: number) => { testDb.db.prepare("UPDATE case_log SET voided_at = datetime('now') WHERE id = ?").run(id); return revertNoteDates(id) }
  const setCell = (col: number, v: string) => testDb.db.prepare(`INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(row_id, column_id) DO UPDATE SET value = excluded.value`).run(rowId, col, v)

  it('the only note: back to what the date held before, with history', () => {
    setCell(visitCol, '2027-01-01')
    const id = addNote('visit', '2027-03-10')
    expect(cell(visitCol)).toBe('2027-03-10')
    const reverted = voidNote(id)
    expect(cell(visitCol)).toBe('2027-01-01')
    expect(reverted).toEqual(expect.arrayContaining([{ row_id: rowId, column_id: visitCol, column_name: expect.any(String), old_value: '2027-03-10', new_value: '2027-01-01' }]))
    expect(testDb.db.prepare('SELECT old_value, new_value FROM cell_history WHERE column_id = ? ORDER BY id DESC LIMIT 1').get(visitCol))
      .toEqual({ old_value: '2027-03-10', new_value: '2027-01-01' })
  })

  it('an empty date goes back to empty', () => {
    const id = addNote('visit', '2027-03-10')
    voidNote(id)
    expect(cell(visitCol) ?? null).toBeNull()
  })

  it('the latest of two notes: back to the earlier note\'s day', () => {
    addNote('visit', '2027-03-01')
    const later = addNote('visit', '2027-03-08')
    voidNote(later)
    expect(cell(visitCol)).toBe('2027-03-01')
  })

  it('counts a remaining note that came in later but was dated earlier', () => {
    const first = addNote('visit', '2027-03-08')
    addNote('visit', '2027-03-05')       // a late write-up: didn't move the date (earlier than Mar 8)
    voidNote(first)
    expect(cell(visitCol)).toBe('2027-03-05')
  })

  it('never undoes a date someone typed since', () => {
    const id = addNote('visit', '2027-03-10')
    setCell(visitCol, '2027-04-02')
    expect(voidNote(id).filter(r => r.column_id === visitCol)).toEqual([])
    expect(cell(visitCol)).toBe('2027-04-02')
  })

  it('an earlier note voided after a later one moved the date: the later one no longer goes back to it', () => {
    setCell(visitCol, '2027-01-01')
    const a = addNote('visit', '2027-03-01')
    const b = addNote('visit', '2027-03-05')
    voidNote(a)
    expect(cell(visitCol)).toBe('2027-03-05')
    voidNote(b)
    expect(cell(visitCol)).toBe('2027-01-01')
  })

  it('a note that moved nothing changes nothing', () => {
    const id = addNote('note', '2027-03-10')
    expect(voidNote(id)).toEqual([])
  })
})
