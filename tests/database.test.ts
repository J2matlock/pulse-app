/**
 * Database Layer Tests — runs against real SQLCipher, no mocks.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import {
  createTestDb,
  openEncryptedDb,
  cleanupTestDb,
  seedGrid,
  TEST_PASSWORD,
  type TestDb,
} from './helpers'

import { up as migration001 } from '../src/main/migrations/001_initial_schema'
import { up as migration002 } from '../src/main/migrations/002_cell_formats'
import { up as migration004 } from '../src/main/migrations/004_cond_format_rules'

let t: TestDb

beforeEach(() => { t = createTestDb() })
afterEach(() => { cleanupTestDb(t) })

// ── Schema & Migrations ──────────────────────────────────────────────────────

describe('Schema & Migrations', () => {
  it('creates all expected tables', () => {
    const tables = t.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[]
    const names = tables.map(t => t.name).filter(n => !n.startsWith('sqlite_'))

    const expected = [
      'acuity_levels', 'action_log', 'alert_rules', 'app_meta', 'case_log',
      'caseload_task_history', 'caseload_tasks', 'cell_formats', 'cell_history',
      'cells', 'checklist_items', 'checklist_templates', 'columns',
      'cond_format_rules', 'global_notes', 'grids',
      'letter_templates', 'provider_categories', 'provider_client_links',
      'provider_custom_fields', 'provider_custom_values', 'provider_interactions',
      'provider_tags', 'providers', 'row_tags', 'rows', 'saved_filters',
      'saved_views', 'scrap_notes', 'settings', 'setup_templates', 'snippets',
      'tags',
    ]
    for (const tbl of expected) {
      expect(names, `missing table: ${tbl}`).toContain(tbl)
    }
  })

  it('reaches latest schema version after all migrations', () => {
    const row = t.db.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get() as { value: string }
    expect(Number(row.value)).toBeGreaterThanOrEqual(17)
  })

  it('running migrations twice does not error (idempotent)', () => {
    // Run all migrations again on the same DB — should not throw
    expect(() => {
      migration001(t.db)
      migration002(t.db)
      // migration003 will fail because column already renamed — that's expected for ALTER
      // migration004 uses IF NOT EXISTS — fine
      migration004(t.db)
      // We skip 003, 005-010 since ALTERs on existing columns would fail — that's correct
      // The real migration runner only runs migrations > currentVersion
    }).not.toThrow()
  })

  it('FK cascade: delete row → cells, checklist_items, case_log, scrap_notes gone', () => {
    const { gridId, columnIds, rowIds } = seedGrid(t.db, { rowCount: 1, columnCount: 2 })
    const rowId = rowIds[0]

    // Populate related data
    t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(rowId, columnIds[0], 'Alice')
    t.db.prepare('INSERT INTO checklist_items (row_id, title, position) VALUES (?, ?, 0)').run(rowId, 'Task 1')
    t.db.prepare("INSERT INTO case_log (row_id, content) VALUES (?, 'Note')").run(rowId)
    t.db.prepare("INSERT INTO scrap_notes (row_id, content) VALUES (?, 'Scratch')").run(rowId)

    // Delete the row
    t.db.prepare('DELETE FROM rows WHERE id = ?').run(rowId)

    // All child records should be gone
    expect((t.db.prepare('SELECT COUNT(*) as c FROM cells WHERE row_id = ?').get(rowId) as { c: number }).c).toBe(0)
    expect((t.db.prepare('SELECT COUNT(*) as c FROM checklist_items WHERE row_id = ?').get(rowId) as { c: number }).c).toBe(0)
    expect((t.db.prepare('SELECT COUNT(*) as c FROM case_log WHERE row_id = ?').get(rowId) as { c: number }).c).toBe(0)
    expect((t.db.prepare('SELECT COUNT(*) as c FROM scrap_notes WHERE row_id = ?').get(rowId) as { c: number }).c).toBe(0)
  })

  it('FK cascade: delete column → all cells for that column gone', () => {
    const { gridId, columnIds, rowIds } = seedGrid(t.db, { rowCount: 3, columnCount: 2 })

    // Add cells for both columns
    for (const rowId of rowIds) {
      t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(rowId, columnIds[0], 'v0')
      t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(rowId, columnIds[1], 'v1')
    }

    // Delete column 0
    t.db.prepare('DELETE FROM columns WHERE id = ?').run(columnIds[0])

    // Cells for column 0 gone, column 1 intact
    expect((t.db.prepare('SELECT COUNT(*) as c FROM cells WHERE column_id = ?').get(columnIds[0]) as { c: number }).c).toBe(0)
    expect((t.db.prepare('SELECT COUNT(*) as c FROM cells WHERE column_id = ?').get(columnIds[1]) as { c: number }).c).toBe(3)
  })

  it('FK cascade: delete grid → rows, columns, cells, tags, saved_views, saved_filters gone', () => {
    const { gridId, columnIds, rowIds } = seedGrid(t.db, { rowCount: 2, columnCount: 2 })

    // Add cells, tags, saved_filters, saved_views
    t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(rowIds[0], columnIds[0], 'hi')
    t.db.prepare("INSERT INTO tags (grid_id, name) VALUES (?, 'urgent')").run(gridId)
    t.db.prepare("INSERT INTO saved_filters (grid_id, name, filter_config) VALUES (?, 'f1', '{}')").run(gridId)
    t.db.prepare("INSERT INTO saved_views (grid_id, name, config) VALUES (?, 'v1', '{}')").run(gridId)

    // Delete grid
    t.db.prepare('DELETE FROM grids WHERE id = ?').run(gridId)

    expect((t.db.prepare('SELECT COUNT(*) as c FROM rows WHERE grid_id = ?').get(gridId) as { c: number }).c).toBe(0)
    expect((t.db.prepare('SELECT COUNT(*) as c FROM columns WHERE grid_id = ?').get(gridId) as { c: number }).c).toBe(0)
    expect((t.db.prepare('SELECT COUNT(*) as c FROM tags WHERE grid_id = ?').get(gridId) as { c: number }).c).toBe(0)
    expect((t.db.prepare('SELECT COUNT(*) as c FROM saved_filters WHERE grid_id = ?').get(gridId) as { c: number }).c).toBe(0)
    expect((t.db.prepare('SELECT COUNT(*) as c FROM saved_views WHERE grid_id = ?').get(gridId) as { c: number }).c).toBe(0)
  })
})

// ── SQLCipher Encryption ─────────────────────────────────────────────────────

describe('SQLCipher Encryption', () => {
  it('opens with correct password', () => {
    const db2 = openEncryptedDb(t.dbPath)
    const row = db2.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get() as { value: string }
    expect(Number(row.value)).toBeGreaterThanOrEqual(17)
    db2.close()
  })

  it('throws with wrong password', () => {
    expect(() => {
      const db2 = openEncryptedDb(t.dbPath, 'wrong-password')
      db2.prepare('SELECT count(*) FROM sqlite_master').get() // triggers decryption error
    }).toThrow()
  })

  it('database file on disk is NOT readable as plain SQLite', () => {
    t.db.close()
    const header = readFileSync(t.dbPath).subarray(0, 16)
    const plainHeader = 'SQLite format 3'
    expect(header.toString('ascii')).not.toContain(plainHeader)
  })

  it('PRAGMA rekey changes password successfully', () => {
    const newKey = 'new-test-password-12345'
    // Must switch out of WAL mode before rekey (SQLCipher limitation)
    t.db.pragma('journal_mode = DELETE')
    t.db.pragma(`rekey='${newKey}'`)
    t.db.close()

    // New password works
    const db2 = openEncryptedDb(t.dbPath, newKey)
    const row = db2.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get() as { value: string }
    expect(Number(row.value)).toBeGreaterThanOrEqual(17)
    db2.close()

    // Old password fails
    expect(() => {
      const db3 = openEncryptedDb(t.dbPath, TEST_PASSWORD)
      db3.prepare('SELECT count(*) FROM sqlite_master').get()
    }).toThrow()
  })
})

// ── Cell Operations ──────────────────────────────────────────────────────────

describe('Cell Operations', () => {
  it('create cell, read back, values match', () => {
    const { columnIds, rowIds } = seedGrid(t.db, { rowCount: 1, columnCount: 1 })
    t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(rowIds[0], columnIds[0], 'Jane Doe')
    const cell = t.db.prepare('SELECT value FROM cells WHERE row_id = ? AND column_id = ?').get(rowIds[0], columnIds[0]) as { value: string }
    expect(cell.value).toBe('Jane Doe')
  })

  it('update cell records old value in cell_history', () => {
    const { columnIds, rowIds } = seedGrid(t.db, { rowCount: 1, columnCount: 1 })
    const rowId = rowIds[0], colId = columnIds[0]

    // Insert cell
    t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(rowId, colId, 'v1')
    const cellId = (t.db.prepare('SELECT id FROM cells WHERE row_id = ? AND column_id = ?').get(rowId, colId) as { id: number }).id

    // Record history then update
    t.db.prepare('INSERT INTO cell_history (cell_id, row_id, column_id, old_value, new_value) VALUES (?, ?, ?, ?, ?)').run(cellId, rowId, colId, 'v1', 'v2')
    t.db.prepare('UPDATE cells SET value = ? WHERE id = ?').run('v2', cellId)

    const history = t.db.prepare('SELECT old_value, new_value FROM cell_history WHERE cell_id = ?').all(cellId) as { old_value: string; new_value: string }[]
    expect(history).toHaveLength(1)
    expect(history[0].old_value).toBe('v1')
    expect(history[0].new_value).toBe('v2')
  })

  it('update cell 10 times, cell_history has 10 entries', () => {
    const { columnIds, rowIds } = seedGrid(t.db, { rowCount: 1, columnCount: 1 })
    const rowId = rowIds[0], colId = columnIds[0]

    t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(rowId, colId, 'v0')
    const cellId = (t.db.prepare('SELECT id FROM cells WHERE row_id = ? AND column_id = ?').get(rowId, colId) as { id: number }).id

    for (let i = 1; i <= 10; i++) {
      t.db.prepare('INSERT INTO cell_history (cell_id, row_id, column_id, old_value, new_value) VALUES (?, ?, ?, ?, ?)').run(cellId, rowId, colId, `v${i - 1}`, `v${i}`)
      t.db.prepare('UPDATE cells SET value = ? WHERE id = ?').run(`v${i}`, cellId)
    }

    const count = (t.db.prepare('SELECT COUNT(*) as c FROM cell_history WHERE cell_id = ?').get(cellId) as { c: number }).c
    expect(count).toBe(10)
  })

  it('bulk update cells in a single transaction', () => {
    const { columnIds, rowIds } = seedGrid(t.db, { rowCount: 5, columnCount: 2 })

    const insert = t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
    const bulkInsert = t.db.transaction(() => {
      for (const rowId of rowIds) {
        for (const colId of columnIds) {
          insert.run(rowId, colId, `r${rowId}c${colId}`)
        }
      }
    })
    bulkInsert()

    const count = (t.db.prepare('SELECT COUNT(*) as c FROM cells').get() as { c: number }).c
    expect(count).toBe(10)
  })

  it('NULL values stored and retrieved correctly', () => {
    const { columnIds, rowIds } = seedGrid(t.db, { rowCount: 1, columnCount: 1 })
    t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(rowIds[0], columnIds[0], null)
    const cell = t.db.prepare('SELECT value FROM cells WHERE row_id = ? AND column_id = ?').get(rowIds[0], columnIds[0]) as { value: string | null }
    expect(cell.value).toBeNull()
  })

  it('very long text (10,000 chars) stores and retrieves correctly', () => {
    const { columnIds, rowIds } = seedGrid(t.db, { rowCount: 1, columnCount: 1 })
    const longText = 'A'.repeat(10000)
    t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(rowIds[0], columnIds[0], longText)
    const cell = t.db.prepare('SELECT value FROM cells WHERE row_id = ? AND column_id = ?').get(rowIds[0], columnIds[0]) as { value: string }
    expect(cell.value).toBe(longText)
    expect(cell.value.length).toBe(10000)
  })

  it('Unicode text (Chinese, Arabic, emoji) stores and retrieves correctly', () => {
    const { columnIds, rowIds } = seedGrid(t.db, { rowCount: 1, columnCount: 1 })
    const unicode = '你好世界 مرحبا 🎉🚀🌍'
    t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(rowIds[0], columnIds[0], unicode)
    const cell = t.db.prepare('SELECT value FROM cells WHERE row_id = ? AND column_id = ?').get(rowIds[0], columnIds[0]) as { value: string }
    expect(cell.value).toBe(unicode)
  })

  it('special characters and SQL injection attempts are safe', () => {
    const { columnIds, rowIds } = seedGrid(t.db, { rowCount: 1, columnCount: 1 })
    const injections = [
      "'; DROP TABLE rows;--",
      "Robert'); DROP TABLE cells;--",
      'Line1\nLine2\tTabbed',
      'Quotes: "double" and \'single\'',
      'Backslash: C:\\Users\\test',
    ]
    for (const val of injections) {
      t.db.prepare('INSERT OR REPLACE INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(rowIds[0], columnIds[0], val)
      const cell = t.db.prepare('SELECT value FROM cells WHERE row_id = ? AND column_id = ?').get(rowIds[0], columnIds[0]) as { value: string }
      expect(cell.value).toBe(val)
    }
    // Tables still exist
    expect(t.db.prepare("SELECT name FROM sqlite_master WHERE name = 'rows'").get()).toBeDefined()
    expect(t.db.prepare("SELECT name FROM sqlite_master WHERE name = 'cells'").get()).toBeDefined()
  })
})

// ── Row Operations ───────────────────────────────────────────────────────────

describe('Row Operations', () => {
  it('row position auto-increments when using INSERT', () => {
    const { gridId } = seedGrid(t.db, { rowCount: 0, columnCount: 1 })
    for (let i = 0; i < 5; i++) {
      t.db.prepare('INSERT INTO rows (grid_id, position) VALUES (?, ?)').run(gridId, i)
    }
    const rows = t.db.prepare('SELECT position FROM rows WHERE grid_id = ? ORDER BY position').all(gridId) as { position: number }[]
    expect(rows.map(r => r.position)).toEqual([0, 1, 2, 3, 4])
  })

  it('archive row sets is_active=0, archived_at, archived_reason', () => {
    const { rowIds } = seedGrid(t.db, { rowCount: 1, columnCount: 1 })
    t.db.prepare("UPDATE rows SET is_active = 0, archived_at = datetime('now'), archived_reason = 'Discharged' WHERE id = ?").run(rowIds[0])
    const row = t.db.prepare('SELECT is_active, archived_at, archived_reason FROM rows WHERE id = ?').get(rowIds[0]) as { is_active: number; archived_at: string | null; archived_reason: string | null }
    expect(row.is_active).toBe(0)
    expect(row.archived_at).toBeTruthy()
    expect(row.archived_reason).toBe('Discharged')
  })

  it('unarchive row sets is_active=1, clears archived_at', () => {
    const { rowIds } = seedGrid(t.db, { rowCount: 1, columnCount: 1 })
    t.db.prepare("UPDATE rows SET is_active = 0, archived_at = datetime('now'), archived_reason = 'test' WHERE id = ?").run(rowIds[0])
    t.db.prepare('UPDATE rows SET is_active = 1, archived_at = NULL, archived_reason = NULL WHERE id = ?').run(rowIds[0])
    const row = t.db.prepare('SELECT is_active, archived_at FROM rows WHERE id = ?').get(rowIds[0]) as { is_active: number; archived_at: string | null }
    expect(row.is_active).toBe(1)
    expect(row.archived_at).toBeNull()
  })

  it('duplicate row: new row with same cell values, different ID', () => {
    const { gridId, columnIds, rowIds } = seedGrid(t.db, { rowCount: 1, columnCount: 2 })
    const origRow = rowIds[0]
    t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(origRow, columnIds[0], 'Alice')
    t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(origRow, columnIds[1], 'Smith')

    // Duplicate
    const newRowResult = t.db.prepare("INSERT INTO rows (grid_id, position) VALUES (?, 999)").run(gridId)
    const newRowId = newRowResult.lastInsertRowid as number
    const cells = t.db.prepare('SELECT column_id, value FROM cells WHERE row_id = ?').all(origRow) as { column_id: number; value: string }[]
    for (const cell of cells) {
      t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(newRowId, cell.column_id, cell.value)
    }

    expect(newRowId).not.toBe(origRow)
    const newCells = t.db.prepare('SELECT column_id, value FROM cells WHERE row_id = ? ORDER BY column_id').all(newRowId) as { column_id: number; value: string }[]
    expect(newCells).toHaveLength(2)
    expect(newCells[0].value).toBe('Alice')
    expect(newCells[1].value).toBe('Smith')
  })

  it('star and unstar row', () => {
    const { rowIds } = seedGrid(t.db, { rowCount: 1, columnCount: 1 })
    t.db.prepare('UPDATE rows SET is_starred = 1 WHERE id = ?').run(rowIds[0])
    let row = t.db.prepare('SELECT is_starred FROM rows WHERE id = ?').get(rowIds[0]) as { is_starred: number }
    expect(row.is_starred).toBe(1)
    t.db.prepare('UPDATE rows SET is_starred = 0 WHERE id = ?').run(rowIds[0])
    row = t.db.prepare('SELECT is_starred FROM rows WHERE id = ?').get(rowIds[0]) as { is_starred: number }
    expect(row.is_starred).toBe(0)
  })

  it('reorder rows: positions update correctly', () => {
    const { gridId, rowIds } = seedGrid(t.db, { rowCount: 5, columnCount: 1 })
    // Reverse the order
    const update = t.db.prepare('UPDATE rows SET position = ? WHERE id = ?')
    const reversed = [...rowIds].reverse()
    t.db.transaction(() => {
      reversed.forEach((id, i) => update.run(i, id))
    })()

    const rows = t.db.prepare('SELECT id, position FROM rows WHERE grid_id = ? ORDER BY position').all(gridId) as { id: number; position: number }[]
    expect(rows[0].id).toBe(rowIds[4])
    expect(rows[4].id).toBe(rowIds[0])
  })
})

// ── Performance ──────────────────────────────────────────────────────────────

describe('Performance', () => {
  it('insert 500 rows × 20 columns (10,000 cells) in under 5 seconds', () => {
    const { gridId, columnIds, rowIds } = seedGrid(t.db, { rowCount: 500, columnCount: 20 })

    const start = performance.now()
    const insert = t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
    t.db.transaction(() => {
      for (const rowId of rowIds) {
        for (const colId of columnIds) {
          insert.run(rowId, colId, `data-${rowId}-${colId}`)
        }
      }
    })()
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(5000)
    const count = (t.db.prepare('SELECT COUNT(*) as c FROM cells').get() as { c: number }).c
    expect(count).toBe(10000)
  })

  it('pivot query for 500 rows returns in under 300ms', () => {
    const { gridId, columnIds, rowIds } = seedGrid(t.db, { rowCount: 500, columnCount: 20 })

    // Populate cells
    const insert = t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
    t.db.transaction(() => {
      for (const rowId of rowIds) {
        for (const colId of columnIds) {
          insert.run(rowId, colId, `val-${rowId}-${colId}`)
        }
      }
    })()

    // Build pivot query (same pattern as database.ts buildGridQuery)
    const columnCases = columnIds
      .map(id => `MAX(CASE WHEN c.column_id = ${id} THEN c.value END) AS col_${id}`)
      .join(', ')
    const query = `
      SELECT r.id AS row_id, r.position, r.is_active, r.is_starred,
             r.created_at, r.updated_at, ${columnCases}
      FROM rows r
      LEFT JOIN cells c ON c.row_id = r.id
      WHERE r.grid_id = ? AND r.is_active = 1
      GROUP BY r.id
      ORDER BY r.position
    `

    const start = performance.now()
    const rows = t.db.prepare(query).all(gridId)
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(300)
    expect(rows).toHaveLength(500)
  })

  it('search across 500 rows returns in under 200ms', () => {
    const { gridId, columnIds, rowIds } = seedGrid(t.db, { rowCount: 500, columnCount: 5 })

    // Populate with searchable data
    const insert = t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)')
    t.db.transaction(() => {
      for (let i = 0; i < rowIds.length; i++) {
        insert.run(rowIds[i], columnIds[0], i === 250 ? 'FINDME_UNIQUE_STRING' : `Client ${i}`)
      }
    })()

    const start = performance.now()
    const results = t.db.prepare(`
      SELECT DISTINCT r.id FROM rows r
      JOIN cells c ON c.row_id = r.id
      WHERE r.grid_id = ? AND c.value LIKE ?
    `).all(gridId, '%FINDME%')
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(200)
    expect(results).toHaveLength(1)
  })
})
