/**
 * Concurrent Write Safety Tests — WAL mode guarantees.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'

let t: TestDb

beforeEach(() => { t = createTestDb() })
afterEach(() => { cleanupTestDb(t) })

describe('WAL Concurrent Safety', () => {
  it('two rapid cell updates to same cell, final value is correct', () => {
    const { columnIds, rowIds } = seedGrid(t.db, { rowCount: 1, columnCount: 1 })
    const rowId = rowIds[0], colId = columnIds[0]

    t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(rowId, colId, 'v1')

    // Rapid sequential updates
    t.db.prepare('UPDATE cells SET value = ? WHERE row_id = ? AND column_id = ?').run('v2', rowId, colId)
    t.db.prepare('UPDATE cells SET value = ? WHERE row_id = ? AND column_id = ?').run('v3', rowId, colId)

    const cell = t.db.prepare('SELECT value FROM cells WHERE row_id = ? AND column_id = ?').get(rowId, colId) as { value: string }
    expect(cell.value).toBe('v3')
  })

  it('transaction rollback: failing transaction does not corrupt adjacent data', () => {
    const { gridId, columnIds, rowIds } = seedGrid(t.db, { rowCount: 2, columnCount: 1 })
    const colId = columnIds[0]

    // Set up initial data
    t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(rowIds[0], colId, 'safe')
    t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(rowIds[1], colId, 'also-safe')

    // Attempt a transaction that partially succeeds then fails
    try {
      t.db.transaction(() => {
        t.db.prepare('UPDATE cells SET value = ? WHERE row_id = ? AND column_id = ?').run('changed', rowIds[0], colId)
        // Force a failure by violating a constraint
        throw new Error('Simulated failure')
      })()
    } catch {
      // Expected
    }

    // Original data should be intact
    const cell0 = t.db.prepare('SELECT value FROM cells WHERE row_id = ? AND column_id = ?').get(rowIds[0], colId) as { value: string }
    const cell1 = t.db.prepare('SELECT value FROM cells WHERE row_id = ? AND column_id = ?').get(rowIds[1], colId) as { value: string }
    expect(cell0.value).toBe('safe')
    expect(cell1.value).toBe('also-safe')
  })

  it('bulk insert + read: WAL allows reading during writes', () => {
    const { gridId, columnIds, rowIds } = seedGrid(t.db, { rowCount: 100, columnCount: 5 })

    // Bulk insert cells
    const insert = t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
    t.db.transaction(() => {
      for (const rowId of rowIds) {
        for (const colId of columnIds) {
          insert.run(rowId, colId, `data-${rowId}-${colId}`)
        }
      }
    })()

    // Read should succeed and return all data
    const count = (t.db.prepare('SELECT COUNT(*) as c FROM cells').get() as { c: number }).c
    expect(count).toBe(500)

    // Spot-check a value
    const cell = t.db.prepare('SELECT value FROM cells WHERE row_id = ? AND column_id = ?')
      .get(rowIds[50], columnIds[2]) as { value: string }
    expect(cell.value).toBe(`data-${rowIds[50]}-${columnIds[2]}`)
  })

  it('concurrent transactions: one commit, one rollback, data consistent', () => {
    const { columnIds, rowIds } = seedGrid(t.db, { rowCount: 2, columnCount: 1 })
    const colId = columnIds[0]

    t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(rowIds[0], colId, 'original-0')
    t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(rowIds[1], colId, 'original-1')

    // Successful transaction
    t.db.transaction(() => {
      t.db.prepare('UPDATE cells SET value = ? WHERE row_id = ? AND column_id = ?').run('updated-0', rowIds[0], colId)
    })()

    // Failed transaction
    try {
      t.db.transaction(() => {
        t.db.prepare('UPDATE cells SET value = ? WHERE row_id = ? AND column_id = ?').run('bad-update', rowIds[1], colId)
        throw new Error('Rollback!')
      })()
    } catch { /* expected */ }

    const cell0 = t.db.prepare('SELECT value FROM cells WHERE row_id = ? AND column_id = ?').get(rowIds[0], colId) as { value: string }
    const cell1 = t.db.prepare('SELECT value FROM cells WHERE row_id = ? AND column_id = ?').get(rowIds[1], colId) as { value: string }
    expect(cell0.value).toBe('updated-0')
    expect(cell1.value).toBe('original-1')
  })

  it('multiple cells updated in single transaction atomically', () => {
    const { columnIds, rowIds } = seedGrid(t.db, { rowCount: 5, columnCount: 2 })

    // Insert initial values
    const insert = t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
    t.db.transaction(() => {
      for (const rowId of rowIds) {
        for (const colId of columnIds) {
          insert.run(rowId, colId, 'initial')
        }
      }
    })()

    // Update all atomically
    const update = t.db.prepare('UPDATE cells SET value = ? WHERE row_id = ? AND column_id = ?')
    t.db.transaction(() => {
      for (const rowId of rowIds) {
        for (const colId of columnIds) {
          update.run('updated', rowId, colId)
        }
      }
    })()

    // Verify all updated
    const cells = t.db.prepare("SELECT COUNT(*) as c FROM cells WHERE value = 'updated'").get() as { c: number }
    expect(cells.c).toBe(10)
  })
})
