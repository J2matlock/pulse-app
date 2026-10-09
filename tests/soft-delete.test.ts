/**
 * Soft-Delete / Trash System Tests — tests against real SQLCipher DB.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'

let t: TestDb

beforeEach(() => { t = createTestDb() })
afterEach(() => { cleanupTestDb(t) })

describe('Soft-Delete', () => {
  it('soft-delete sets deleted_at and is_active=0', () => {
    const { rowIds } = seedGrid(t.db, { rowCount: 1, columnCount: 1 })
    t.db.prepare("UPDATE rows SET deleted_at = datetime('now'), is_active = 0 WHERE id = ?").run(rowIds[0])

    const row = t.db.prepare('SELECT deleted_at, is_active FROM rows WHERE id = ?').get(rowIds[0]) as { deleted_at: string | null; is_active: number }
    expect(row.deleted_at).toBeTruthy()
    expect(row.is_active).toBe(0)
  })

  it('soft-deleted rows excluded from active query (deleted_at IS NULL filter)', () => {
    const { gridId, rowIds } = seedGrid(t.db, { rowCount: 5, columnCount: 1 })

    // Soft-delete 2 rows
    t.db.prepare("UPDATE rows SET deleted_at = datetime('now'), is_active = 0 WHERE id = ?").run(rowIds[0])
    t.db.prepare("UPDATE rows SET deleted_at = datetime('now'), is_active = 0 WHERE id = ?").run(rowIds[1])

    const activeRows = t.db.prepare(
      'SELECT id FROM rows WHERE grid_id = ? AND is_active = 1 AND deleted_at IS NULL'
    ).all(gridId) as { id: number }[]
    expect(activeRows).toHaveLength(3)
    expect(activeRows.map(r => r.id)).not.toContain(rowIds[0])
    expect(activeRows.map(r => r.id)).not.toContain(rowIds[1])
  })

  it('restore: clear deleted_at, set is_active=1', () => {
    const { rowIds } = seedGrid(t.db, { rowCount: 1, columnCount: 1 })
    t.db.prepare("UPDATE rows SET deleted_at = datetime('now'), is_active = 0 WHERE id = ?").run(rowIds[0])
    t.db.prepare('UPDATE rows SET deleted_at = NULL, is_active = 1 WHERE id = ?').run(rowIds[0])

    const row = t.db.prepare('SELECT deleted_at, is_active FROM rows WHERE id = ?').get(rowIds[0]) as { deleted_at: string | null; is_active: number }
    expect(row.deleted_at).toBeNull()
    expect(row.is_active).toBe(1)
  })

  it('purge: hard-delete a soft-deleted row, FK cascade cleans up cells', () => {
    const { columnIds, rowIds } = seedGrid(t.db, { rowCount: 1, columnCount: 2 })
    const rowId = rowIds[0]
    t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(rowId, columnIds[0], 'Alice')
    t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(rowId, columnIds[1], 'Smith')

    // Soft-delete then hard-delete
    t.db.prepare("UPDATE rows SET deleted_at = datetime('now'), is_active = 0 WHERE id = ?").run(rowId)
    t.db.prepare('DELETE FROM rows WHERE id = ?').run(rowId)

    expect(t.db.prepare('SELECT COUNT(*) as c FROM rows WHERE id = ?').get(rowId) as { c: number }).toEqual({ c: 0 })
    expect(t.db.prepare('SELECT COUNT(*) as c FROM cells WHERE row_id = ?').get(rowId) as { c: number }).toEqual({ c: 0 })
  })

  it('auto-purge: row with deleted_at > 30 days ago gets purged', () => {
    const { gridId, rowIds } = seedGrid(t.db, { rowCount: 1, columnCount: 1 })
    // Set deleted_at to 31 days ago
    t.db.prepare("UPDATE rows SET deleted_at = datetime('now', '-31 days'), is_active = 0 WHERE id = ?").run(rowIds[0])

    // Run purge query
    t.db.prepare("DELETE FROM rows WHERE deleted_at IS NOT NULL AND deleted_at < datetime('now', '-30 days')").run()

    const count = (t.db.prepare('SELECT COUNT(*) as c FROM rows WHERE id = ?').get(rowIds[0]) as { c: number }).c
    expect(count).toBe(0)
  })

  it('auto-purge: row with deleted_at < 30 days ago is NOT purged', () => {
    const { rowIds } = seedGrid(t.db, { rowCount: 1, columnCount: 1 })
    // Set deleted_at to 10 days ago
    t.db.prepare("UPDATE rows SET deleted_at = datetime('now', '-10 days'), is_active = 0 WHERE id = ?").run(rowIds[0])

    // Run purge query
    t.db.prepare("DELETE FROM rows WHERE deleted_at IS NOT NULL AND deleted_at < datetime('now', '-30 days')").run()

    const count = (t.db.prepare('SELECT COUNT(*) as c FROM rows WHERE id = ?').get(rowIds[0]) as { c: number }).c
    expect(count).toBe(1)
  })

  it('get deleted rows: returns only soft-deleted with relevant data', () => {
    const { gridId, columnIds, rowIds } = seedGrid(t.db, { rowCount: 3, columnCount: 1 })
    // Set client names
    t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(rowIds[0], columnIds[0], 'Alice')
    t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(rowIds[1], columnIds[0], 'Bob')
    t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(rowIds[2], columnIds[0], 'Carol')

    // Soft-delete Alice
    t.db.prepare("UPDATE rows SET deleted_at = datetime('now'), is_active = 0 WHERE id = ?").run(rowIds[0])

    const deleted = t.db.prepare(
      'SELECT id FROM rows WHERE grid_id = ? AND deleted_at IS NOT NULL'
    ).all(gridId) as { id: number }[]
    expect(deleted).toHaveLength(1)
    expect(deleted[0].id).toBe(rowIds[0])
  })

  it('soft-deleted rows do not appear in standard getRow-like queries', () => {
    const { gridId, columnIds, rowIds } = seedGrid(t.db, { rowCount: 2, columnCount: 1 })
    t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(rowIds[0], columnIds[0], 'Alice')

    // Soft-delete
    t.db.prepare("UPDATE rows SET deleted_at = datetime('now'), is_active = 0 WHERE id = ?").run(rowIds[0])

    // Query like getRow does (with deleted_at IS NULL filter)
    const row = t.db.prepare(
      'SELECT * FROM rows WHERE id = ? AND deleted_at IS NULL'
    ).get(rowIds[0])
    expect(row).toBeUndefined()
  })
})
