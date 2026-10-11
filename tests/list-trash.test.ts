/** Deleted lists and columns wait in the Trash and come back whole (audit 5.2, Decision D1). */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'

let t: TestDb
vi.mock('../src/main/database', () => ({ getDb: () => t.db, cachedStmt: (_k: string, sql: string) => t.db.prepare(sql) }))

import { trashColumn, restoreColumn, listDeletedColumns, purgeDeletedColumn, trashList, restoreList, listDeletedLists, purgeList } from '../src/main/list-trash'

beforeEach(() => { t = createTestDb() })
afterEach(() => cleanupTestDb(t))

const count = (sql: string, ...args: unknown[]) => (t.db.prepare(sql).get(...args) as { n: number }).n

describe('a deleted column', () => {
  it('comes back with its values, their history, formats and deadline steps', () => {
    const g = seedGrid(t.db, { rowCount: 2, columnCount: 2, columnTypes: ['text', 'date'] })
    const col = g.columnIds[1]!
    const cellId = Number(t.db.prepare("INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, '2026-10-06')").run(g.rowIds[0], col).lastInsertRowid)
    t.db.prepare("INSERT INTO cell_history (cell_id, row_id, column_id, old_value, new_value) VALUES (?, ?, ?, NULL, '2026-10-06')").run(cellId, g.rowIds[0], col)
    t.db.prepare("INSERT INTO cell_formats (row_id, column_id, rules) VALUES (?, ?, '[]')").run(g.rowIds[1], col)
    t.db.prepare("INSERT INTO deadline_progress (row_id, column_id, step, done_at) VALUES (?, ?, 0, '2026-01-01')").run(g.rowIds[0], col)

    const deletedId = t.db.transaction(() => { const id = trashColumn(col); t.db.prepare('DELETE FROM columns WHERE id = ?').run(col); return id })()
    expect(count('SELECT COUNT(*) AS n FROM cells WHERE column_id = ?', col)).toBe(0)
    expect(listDeletedColumns(g.gridId)).toEqual([expect.objectContaining({ id: deletedId, column_id: col, name: 'Column 2', column_type: 'date', values: 1 })])

    expect(restoreColumn(deletedId)).toEqual({ columnId: col, gridId: g.gridId })
    expect(t.db.prepare('SELECT value FROM cells WHERE id = ?').get(cellId)).toEqual({ value: '2026-10-06' })
    expect(count('SELECT COUNT(*) AS n FROM cell_history WHERE cell_id = ?', cellId)).toBe(1)
    expect(count('SELECT COUNT(*) AS n FROM cell_formats WHERE column_id = ?', col)).toBe(1)
    expect(count('SELECT COUNT(*) AS n FROM deadline_progress WHERE column_id = ?', col)).toBe(1)
    expect(listDeletedColumns(g.gridId)).toEqual([])
  })

  it('leaves out values of records removed for good since, and can be removed for good itself', () => {
    const g = seedGrid(t.db, { rowCount: 2, columnCount: 2 })
    const col = g.columnIds[1]!
    t.db.prepare("INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, 'a'), (?, ?, 'b')").run(g.rowIds[0], col, g.rowIds[1], col)
    const deletedId = t.db.transaction(() => { const id = trashColumn(col); t.db.prepare('DELETE FROM columns WHERE id = ?').run(col); return id })()
    t.db.prepare('DELETE FROM rows WHERE id = ?').run(g.rowIds[1])
    restoreColumn(deletedId)
    expect(t.db.prepare('SELECT value FROM cells WHERE column_id = ?').all(col)).toEqual([{ value: 'a' }])
    const again = t.db.transaction(() => { const id = trashColumn(col); t.db.prepare('DELETE FROM columns WHERE id = ?').run(col); return id })()
    expect(purgeDeletedColumn(again)).toBe(true)
    expect(() => restoreColumn(again)).toThrow(/no longer in the Trash/)
  })
})

describe('a deleted list', () => {
  it('waits in the Trash with its records and links, and comes back with them', () => {
    const cars = seedGrid(t.db, { name: 'Vehicles', rowCount: 1, columnCount: 1 })
    const people = seedGrid(t.db, { name: 'Customers', rowCount: 1, columnCount: 1 })
    const typeId = Number(t.db.prepare("INSERT INTO link_types (from_grid_id, to_grid_id, label_forward, label_backward, cardinality) VALUES (?, ?, 'Owner', 'Vehicles', 'many_to_one')").run(cars.gridId, people.gridId).lastInsertRowid)
    const linkCol = Number(t.db.prepare("INSERT INTO columns (grid_id, name, column_type, position, config) VALUES (?, 'Vehicles', 'link', 5, ?)").run(people.gridId, JSON.stringify({ link_type_id: typeId, direction: 'backward' })).lastInsertRowid)
    t.db.prepare('INSERT INTO record_links (link_type_id, from_row_id, to_row_id) VALUES (?, ?, ?)').run(typeId, cars.rowIds[0], people.rowIds[0])

    trashList(cars.gridId)
    expect(t.db.prepare('SELECT is_active FROM grids WHERE id = ?').get(cars.gridId)).toEqual({ is_active: 0 })
    expect(count('SELECT COUNT(*) AS n FROM link_types')).toBe(0)
    expect(count('SELECT COUNT(*) AS n FROM columns WHERE id = ?', linkCol)).toBe(0)
    expect(listDeletedLists()).toEqual([expect.objectContaining({ id: cars.gridId, name: 'Vehicles', records: 1 })])

    restoreList(cars.gridId)
    expect(t.db.prepare('SELECT is_active, deleted_at FROM grids WHERE id = ?').get(cars.gridId)).toEqual({ is_active: 1, deleted_at: null })
    expect(count('SELECT COUNT(*) AS n FROM link_types WHERE id = ?', typeId)).toBe(1)
    expect(count('SELECT COUNT(*) AS n FROM columns WHERE id = ?', linkCol)).toBe(1)
    expect(count('SELECT COUNT(*) AS n FROM record_links WHERE link_type_id = ?', typeId)).toBe(1)
    expect(listDeletedLists()).toEqual([])
  })

  it('can be removed for good, records and all, only from the Trash', () => {
    const g = seedGrid(t.db, { rowCount: 2, columnCount: 1 })
    expect(purgeList(g.gridId)).toBe(false)
    trashList(g.gridId)
    expect(purgeList(g.gridId)).toBe(true)
    expect(count('SELECT COUNT(*) AS n FROM rows WHERE grid_id = ?', g.gridId)).toBe(0)
  })
})
