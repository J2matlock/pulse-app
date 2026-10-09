/**
 * IPC Integration Tests — exercises real handler logic against a real SQLite database.
 *
 * These tests bypass Electron's IPC layer and call the same SQL that the IPC handlers
 * execute, against a fully migrated test database. This validates the critical data
 * paths end-to-end: grid CRUD, row lifecycle, soft delete, case log, column operations,
 * sort persistence, and search.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { Database } from 'better-sqlite3'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from '../helpers'

// ---------------------------------------------------------------------------
// Helpers that replicate the core logic from database.ts / IPC handlers
// without requiring Electron imports.
// ---------------------------------------------------------------------------

/** Replicates database.ts buildGridQuery — pivot query for grid loads */
function buildGridQuery(columnIds: number[], includeArchived = false): string {
  const safeIds = columnIds.map(id => {
    const n = Math.trunc(Number(id))
    if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid column ID: ${id}`)
    return n
  })
  const columnCases = safeIds
    .map(id => `MAX(CASE WHEN c.column_id = ${id} THEN c.value END) AS col_${id}`)
    .join(',\n    ')

  const activeFilter = includeArchived
    ? 'AND r.deleted_at IS NULL'
    : 'AND r.is_active = 1 AND r.deleted_at IS NULL'

  return `
    SELECT
      r.id AS row_id,
      r.position,
      r.is_active,
      r.is_starred,
      r.acuity_level_id,
      r.deleted_at,
      r.created_at,
      r.updated_at,
      ${columnCases}
    FROM rows r
    LEFT JOIN cells c ON c.row_id = r.id
    WHERE r.grid_id = ? ${activeFilter}
    GROUP BY r.id
    ORDER BY r.position
  `
}

/** Replicates database.ts upsertCell */
function upsertCell(db: Database, rowId: number, columnId: number, value: string | null): void {
  db.prepare(`
    INSERT INTO cells (row_id, column_id, value, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(row_id, column_id)
    DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(rowId, columnId, value)
}

/** Create a grid (replicates GRID_CREATE handler logic) */
function createGrid(db: Database, name: string): number {
  const result = db.transaction(() => {
    const r = db.prepare(`
      INSERT INTO grids (name, created_at, updated_at)
      VALUES (?, datetime('now'), datetime('now'))
    `).run(name)
    const gridId = r.lastInsertRowid as number
    db.prepare(`
      INSERT INTO columns (grid_id, name, column_type, position, is_name_column, is_identifier, width)
      VALUES (?, 'Name', 'text', 0, 1, 1, 200)
    `).run(gridId)
    return gridId
  })()
  return result
}

/** Add a column (replicates COLUMN_CREATE handler logic) */
function addColumn(db: Database, gridId: number, name: string, columnType: string): number {
  const maxPos = (db.prepare('SELECT MAX(position) as p FROM columns WHERE grid_id = ?').get(gridId) as { p: number | null }).p ?? -1
  const result = db.prepare(`
    INSERT INTO columns (grid_id, name, column_type, position, created_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `).run(gridId, name, columnType, maxPos + 1)
  return result.lastInsertRowid as number
}

/** Add a row (replicates ROW_CREATE handler logic) */
function addRow(db: Database, gridId: number): number {
  return db.transaction(() => {
    const maxPos = (db.prepare('SELECT MAX(position) as p FROM rows WHERE grid_id = ?').get(gridId) as { p: number | null }).p ?? -1
    const result = db.prepare(`
      INSERT INTO rows (grid_id, position, created_at, updated_at)
      VALUES (?, ?, datetime('now'), datetime('now'))
    `).run(gridId, maxPos + 1)
    return result.lastInsertRowid as number
  })()
}

/** Load grid data using the pivot query (replicates GRID_GET handler logic) */
function loadGrid(db: Database, gridId: number, showArchived = false): { columns: any[]; rows: any[] } {
  const columns = db.prepare('SELECT * FROM columns WHERE grid_id = ? ORDER BY position').all(gridId)
  const visibleCols = (columns as any[]).filter(c => c.is_visible !== 0)
  const columnIds = visibleCols.map((c: any) => c.id as number)
  const rows = columnIds.length > 0
    ? db.prepare(buildGridQuery(columnIds, showArchived)).all(gridId)
    : []
  return { columns: visibleCols, rows: rows as any[] }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let t: TestDb

beforeEach(() => { t = createTestDb() })
afterEach(() => { cleanupTestDb(t) })

describe('Grid CRUD', () => {
  it('creates a grid with a default Name column', () => {
    const gridId = createGrid(t.db, 'My Caseload')
    const grid = t.db.prepare('SELECT * FROM grids WHERE id = ?').get(gridId) as any
    expect(grid).toBeDefined()
    expect(grid.name).toBe('My Caseload')

    const cols = t.db.prepare('SELECT * FROM columns WHERE grid_id = ?').all(gridId) as any[]
    expect(cols).toHaveLength(1)
    expect(cols[0].name).toBe('Name')
    expect(cols[0].is_name_column).toBe(1)
    expect(cols[0].column_type).toBe('text')
  })

  it('creates grid → adds columns → adds rows → sets cells → reads back via pivot query', () => {
    const gridId = createGrid(t.db, 'Test Grid')
    const nameColId = (t.db.prepare('SELECT id FROM columns WHERE grid_id = ? AND is_name_column = 1').get(gridId) as any).id
    const dobColId = addColumn(t.db, gridId, 'Date of Birth', 'date')
    const statusColId = addColumn(t.db, gridId, 'Status', 'dropdown')

    const row1 = addRow(t.db, gridId)
    const row2 = addRow(t.db, gridId)

    upsertCell(t.db, row1, nameColId, 'Alice Smith')
    upsertCell(t.db, row1, dobColId, '1990-01-15')
    upsertCell(t.db, row1, statusColId, 'Active')
    upsertCell(t.db, row2, nameColId, 'Bob Jones')
    upsertCell(t.db, row2, statusColId, 'Pending')

    const { columns, rows } = loadGrid(t.db, gridId)
    expect(columns).toHaveLength(3)
    expect(rows).toHaveLength(2)

    const alice = rows.find((r: any) => r[`col_${nameColId}`] === 'Alice Smith')
    expect(alice).toBeDefined()
    expect(alice[`col_${dobColId}`]).toBe('1990-01-15')
    expect(alice[`col_${statusColId}`]).toBe('Active')

    const bob = rows.find((r: any) => r[`col_${nameColId}`] === 'Bob Jones')
    expect(bob).toBeDefined()
    expect(bob[`col_${statusColId}`]).toBe('Pending')
    expect(bob[`col_${dobColId}`]).toBeNull()
  })

  it('updates grid name and description', () => {
    const gridId = createGrid(t.db, 'Original')
    t.db.prepare("UPDATE grids SET name = ?, description = ?, updated_at = datetime('now') WHERE id = ?")
      .run('Renamed', 'A test caseload', gridId)

    const grid = t.db.prepare('SELECT name, description FROM grids WHERE id = ?').get(gridId) as any
    expect(grid.name).toBe('Renamed')
    expect(grid.description).toBe('A test caseload')
  })

  it('soft-deletes a grid (marks inactive)', () => {
    const gridId = createGrid(t.db, 'To Delete')
    t.db.prepare("UPDATE grids SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(gridId)

    const active = t.db.prepare('SELECT * FROM grids WHERE is_active = 1').all() as any[]
    expect(active.find(g => g.id === gridId)).toBeUndefined()
  })
})

describe('Row Lifecycle', () => {
  it('creates rows and assigns incrementing positions', () => {
    const gridId = createGrid(t.db, 'Positions')
    const r1 = addRow(t.db, gridId)
    const r2 = addRow(t.db, gridId)
    const r3 = addRow(t.db, gridId)

    const rows = t.db.prepare('SELECT id, position FROM rows WHERE grid_id = ? ORDER BY position').all(gridId) as any[]
    expect(rows).toHaveLength(3)
    expect(rows[0].position).toBeLessThan(rows[1].position)
    expect(rows[1].position).toBeLessThan(rows[2].position)
  })

  it('archives a row and excludes it from grid query', () => {
    const gridId = createGrid(t.db, 'Archive Test')
    const nameCol = (t.db.prepare('SELECT id FROM columns WHERE grid_id = ?').get(gridId) as any).id
    const rowId = addRow(t.db, gridId)
    upsertCell(t.db, rowId, nameCol, 'Archived Client')

    // Archive
    t.db.prepare(`
      UPDATE rows SET is_active = 0, archived_at = datetime('now'),
      archived_reason = 'Completed', updated_at = datetime('now') WHERE id = ?
    `).run(rowId)

    // Normal query excludes archived
    const { rows } = loadGrid(t.db, gridId, false)
    expect(rows.find((r: any) => r.row_id === rowId)).toBeUndefined()

    // With includeArchived, it shows up
    const { rows: allRows } = loadGrid(t.db, gridId, true)
    expect(allRows.find((r: any) => r.row_id === rowId)).toBeDefined()
  })

  it('unarchives a row and it reappears in grid query', () => {
    const gridId = createGrid(t.db, 'Unarchive Test')
    const rowId = addRow(t.db, gridId)

    // Archive then unarchive
    t.db.prepare("UPDATE rows SET is_active = 0, archived_at = datetime('now') WHERE id = ?").run(rowId)
    t.db.prepare("UPDATE rows SET is_active = 1, archived_at = NULL, archived_reason = NULL, updated_at = datetime('now') WHERE id = ?").run(rowId)

    const { rows } = loadGrid(t.db, gridId)
    expect(rows.find((r: any) => r.row_id === rowId)).toBeDefined()
  })

  it('stars a row', () => {
    const gridId = createGrid(t.db, 'Star Test')
    const rowId = addRow(t.db, gridId)

    t.db.prepare("UPDATE rows SET is_starred = 1, updated_at = datetime('now') WHERE id = ?").run(rowId)

    const { rows } = loadGrid(t.db, gridId)
    const row = rows.find((r: any) => r.row_id === rowId) as any
    expect(row.is_starred).toBe(1)
  })
})

describe('Soft Delete (Trash)', () => {
  it('soft-deletes a row → appears in deleted list → not in grid query', () => {
    const gridId = createGrid(t.db, 'Trash Test')
    const nameCol = (t.db.prepare('SELECT id FROM columns WHERE grid_id = ?').get(gridId) as any).id
    const rowId = addRow(t.db, gridId)
    upsertCell(t.db, rowId, nameCol, 'Deleted Client')

    // Soft delete
    t.db.prepare("UPDATE rows SET is_active = 0, deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(rowId)

    // Not in grid query
    const { rows } = loadGrid(t.db, gridId)
    expect(rows.find((r: any) => r.row_id === rowId)).toBeUndefined()

    // Appears in deleted list
    const deleted = t.db.prepare(`
      SELECT r.id, r.grid_id, r.deleted_at, g.name AS grid_name
      FROM rows r JOIN grids g ON g.id = r.grid_id
      WHERE r.deleted_at IS NOT NULL
    `).all() as any[]
    expect(deleted.find(d => d.id === rowId)).toBeDefined()
  })

  it('restores a soft-deleted row → data intact', () => {
    const gridId = createGrid(t.db, 'Restore Test')
    const nameCol = (t.db.prepare('SELECT id FROM columns WHERE grid_id = ?').get(gridId) as any).id
    const rowId = addRow(t.db, gridId)
    upsertCell(t.db, rowId, nameCol, 'Restorable Client')

    // Soft delete then restore
    t.db.prepare("UPDATE rows SET is_active = 0, deleted_at = datetime('now') WHERE id = ?").run(rowId)
    t.db.prepare("UPDATE rows SET is_active = 1, deleted_at = NULL, updated_at = datetime('now') WHERE id = ?").run(rowId)

    const { rows } = loadGrid(t.db, gridId)
    const row = rows.find((r: any) => r.row_id === rowId) as any
    expect(row).toBeDefined()
    expect(row[`col_${nameCol}`]).toBe('Restorable Client')
  })

  it('purges a soft-deleted row permanently', () => {
    const gridId = createGrid(t.db, 'Purge Test')
    const rowId = addRow(t.db, gridId)

    // Soft delete then purge
    t.db.prepare("UPDATE rows SET is_active = 0, deleted_at = datetime('now') WHERE id = ?").run(rowId)
    t.db.prepare('DELETE FROM rows WHERE id = ? AND deleted_at IS NOT NULL').run(rowId)

    // Gone from everywhere
    const row = t.db.prepare('SELECT id FROM rows WHERE id = ?').get(rowId)
    expect(row).toBeUndefined()
  })

  it('purge cascades to cells and case_log via FK', () => {
    const gridId = createGrid(t.db, 'Purge Cascade')
    const nameCol = (t.db.prepare('SELECT id FROM columns WHERE grid_id = ?').get(gridId) as any).id
    const rowId = addRow(t.db, gridId)
    upsertCell(t.db, rowId, nameCol, 'Cascade Test')
    t.db.prepare("INSERT INTO case_log (row_id, content, log_type, created_at, updated_at) VALUES (?, 'Test note', 'manual', datetime('now'), datetime('now'))").run(rowId)

    // Soft delete + purge
    t.db.prepare("UPDATE rows SET deleted_at = datetime('now') WHERE id = ?").run(rowId)
    t.db.prepare('DELETE FROM rows WHERE id = ?').run(rowId)

    const cells = t.db.prepare('SELECT * FROM cells WHERE row_id = ?').all(rowId)
    expect(cells).toHaveLength(0)

    const logs = t.db.prepare('SELECT * FROM case_log WHERE row_id = ?').all(rowId)
    expect(logs).toHaveLength(0)
  })
})

describe('Case Log', () => {
  let gridId: number
  let rowId: number

  beforeEach(() => {
    gridId = createGrid(t.db, 'Case Log Grid')
    rowId = addRow(t.db, gridId)
  })

  it('creates a case log entry and retrieves it', () => {
    const result = t.db.prepare(`
      INSERT INTO case_log (row_id, content, log_type, created_at, updated_at)
      VALUES (?, 'Called client about appointment', 'phone', datetime('now'), datetime('now'))
    `).run(rowId)

    const entries = t.db.prepare(`
      SELECT id, row_id, content, log_type FROM case_log
      WHERE row_id = ? AND voided_at IS NULL
      ORDER BY created_at DESC
    `).all(rowId) as any[]

    expect(entries).toHaveLength(1)
    expect(entries[0].content).toBe('Called client about appointment')
    expect(entries[0].log_type).toBe('phone')
  })

  it('pins an entry and it appears first', () => {
    t.db.prepare("INSERT INTO case_log (row_id, content, log_type, created_at, updated_at) VALUES (?, 'First entry', 'manual', datetime('now', '-1 hour'), datetime('now'))").run(rowId)
    const second = t.db.prepare("INSERT INTO case_log (row_id, content, log_type, created_at, updated_at) VALUES (?, 'Important note', 'manual', datetime('now'), datetime('now'))").run(rowId)

    // Pin the second entry
    t.db.prepare('UPDATE case_log SET is_pinned = 1 WHERE id = ?').run(second.lastInsertRowid)

    const entries = t.db.prepare(`
      SELECT id, content, is_pinned FROM case_log
      WHERE row_id = ? AND voided_at IS NULL
      ORDER BY is_pinned DESC, created_at DESC
    `).all(rowId) as any[]

    expect(entries[0].content).toBe('Important note')
    expect(entries[0].is_pinned).toBe(1)
  })

  it('voids an entry → excluded from default query → included with includeVoided', () => {
    const result = t.db.prepare("INSERT INTO case_log (row_id, content, log_type, created_at, updated_at) VALUES (?, 'Voided entry', 'manual', datetime('now'), datetime('now'))").run(rowId)
    const entryId = result.lastInsertRowid as number

    // Void it
    t.db.prepare("UPDATE case_log SET voided_at = datetime('now'), voided_reason = 'Error' WHERE id = ?").run(entryId)

    // Default query excludes voided
    const entries = t.db.prepare('SELECT * FROM case_log WHERE row_id = ? AND voided_at IS NULL').all(rowId) as any[]
    expect(entries.find(e => e.id === entryId)).toBeUndefined()

    // Include voided
    const allEntries = t.db.prepare('SELECT * FROM case_log WHERE row_id = ?').all(rowId) as any[]
    const voided = allEntries.find(e => e.id === entryId) as any
    expect(voided).toBeDefined()
    expect(voided.voided_reason).toBe('Error')
  })

  it('unvoids an entry → reappears in default query', () => {
    const result = t.db.prepare("INSERT INTO case_log (row_id, content, log_type, created_at, updated_at) VALUES (?, 'To unvoid', 'manual', datetime('now'), datetime('now'))").run(rowId)
    const entryId = result.lastInsertRowid as number

    t.db.prepare("UPDATE case_log SET voided_at = datetime('now'), voided_reason = 'Mistake' WHERE id = ?").run(entryId)
    t.db.prepare("UPDATE case_log SET voided_at = NULL, voided_reason = NULL WHERE id = ?").run(entryId)

    const entries = t.db.prepare('SELECT * FROM case_log WHERE row_id = ? AND voided_at IS NULL').all(rowId) as any[]
    expect(entries.find(e => e.id === entryId)).toBeDefined()
  })

  it('tracks edit history with original_content', () => {
    const result = t.db.prepare("INSERT INTO case_log (row_id, content, log_type, created_at, updated_at) VALUES (?, 'Original text', 'manual', datetime('now'), datetime('now'))").run(rowId)
    const entryId = result.lastInsertRowid as number

    // Edit
    t.db.prepare(`
      UPDATE case_log
      SET content = 'Updated text',
          updated_at = datetime('now'),
          original_content = COALESCE(original_content, content),
          edited_at = datetime('now')
      WHERE id = ?
    `).run(entryId)

    const entry = t.db.prepare('SELECT content, original_content, edited_at FROM case_log WHERE id = ?').get(entryId) as any
    expect(entry.content).toBe('Updated text')
    expect(entry.original_content).toBe('Original text')
    expect(entry.edited_at).not.toBeNull()
  })
})

describe('Column Operations', () => {
  it('adds a column → renames → verifies', () => {
    const gridId = createGrid(t.db, 'Column Ops')
    const colId = addColumn(t.db, gridId, 'Phone', 'text')

    t.db.prepare('UPDATE columns SET name = ? WHERE id = ?').run('Phone Number', colId)

    const col = t.db.prepare('SELECT name FROM columns WHERE id = ?').get(colId) as any
    expect(col.name).toBe('Phone Number')
  })

  it('reorders columns → verifies position persisted', () => {
    const gridId = createGrid(t.db, 'Column Reorder')
    const col1 = addColumn(t.db, gridId, 'Col A', 'text')
    const col2 = addColumn(t.db, gridId, 'Col B', 'text')
    const col3 = addColumn(t.db, gridId, 'Col C', 'text')

    // Reorder: C, A, B
    const reorder = t.db.transaction(() => {
      t.db.prepare('UPDATE columns SET position = ? WHERE id = ? AND grid_id = ?').run(1, col3, gridId)
      t.db.prepare('UPDATE columns SET position = ? WHERE id = ? AND grid_id = ?').run(2, col1, gridId)
      t.db.prepare('UPDATE columns SET position = ? WHERE id = ? AND grid_id = ?').run(3, col2, gridId)
    })
    reorder()

    const cols = t.db.prepare('SELECT id, name, position FROM columns WHERE grid_id = ? AND id IN (?, ?, ?) ORDER BY position').all(gridId, col1, col2, col3) as any[]
    expect(cols[0].id).toBe(col3)
    expect(cols[1].id).toBe(col1)
    expect(cols[2].id).toBe(col2)
  })

  it('deletes a column → cells cleaned up via FK cascade', () => {
    const gridId = createGrid(t.db, 'Column Delete')
    const nameCol = (t.db.prepare('SELECT id FROM columns WHERE grid_id = ? AND is_name_column = 1').get(gridId) as any).id
    const extraCol = addColumn(t.db, gridId, 'Extra', 'text')
    const rowId = addRow(t.db, gridId)

    upsertCell(t.db, rowId, nameCol, 'Alice')
    upsertCell(t.db, rowId, extraCol, 'some data')

    // Delete the extra column
    t.db.prepare('DELETE FROM columns WHERE id = ?').run(extraCol)

    // Cell for deleted column should be gone (FK cascade)
    const cells = t.db.prepare('SELECT * FROM cells WHERE column_id = ?').all(extraCol)
    expect(cells).toHaveLength(0)

    // Name cell still intact
    const nameCell = t.db.prepare('SELECT value FROM cells WHERE row_id = ? AND column_id = ?').get(rowId, nameCol) as any
    expect(nameCell.value).toBe('Alice')
  })

  it('hides a column → excluded from visible columns but data preserved', () => {
    const gridId = createGrid(t.db, 'Column Hide')
    const extraCol = addColumn(t.db, gridId, 'Hidden Col', 'text')
    const rowId = addRow(t.db, gridId)
    upsertCell(t.db, rowId, extraCol, 'hidden value')

    // Hide the column
    t.db.prepare('UPDATE columns SET is_visible = 0 WHERE id = ?').run(extraCol)

    const allCols = t.db.prepare('SELECT * FROM columns WHERE grid_id = ?').all(gridId) as any[]
    const visibleCols = allCols.filter(c => c.is_visible !== 0)
    expect(visibleCols.find(c => c.id === extraCol)).toBeUndefined()

    // Data still in cells
    const cell = t.db.prepare('SELECT value FROM cells WHERE row_id = ? AND column_id = ?').get(rowId, extraCol) as any
    expect(cell.value).toBe('hidden value')
  })
})

describe('Sort Persistence', () => {
  it('saves sort config → reloads → config is intact', () => {
    const gridId = createGrid(t.db, 'Sort Test')
    const sortConfig = JSON.stringify([{ columnId: 1, direction: 'asc' }, { columnId: 2, direction: 'desc' }])

    t.db.prepare("UPDATE grids SET sort_config = ? WHERE id = ?").run(sortConfig, gridId)

    const grid = t.db.prepare('SELECT sort_config FROM grids WHERE id = ?').get(gridId) as any
    const parsed = JSON.parse(grid.sort_config)
    expect(parsed).toHaveLength(2)
    expect(parsed[0].direction).toBe('asc')
    expect(parsed[1].direction).toBe('desc')
  })

  it('clears sort config', () => {
    const gridId = createGrid(t.db, 'Sort Clear')
    t.db.prepare("UPDATE grids SET sort_config = '[]' WHERE id = ?").run(gridId)

    const grid = t.db.prepare('SELECT sort_config FROM grids WHERE id = ?').get(gridId) as any
    expect(JSON.parse(grid.sort_config)).toEqual([])
  })
})

describe('Search (display_name filtering)', () => {
  it('finds rows by display_name LIKE match', () => {
    const gridId = createGrid(t.db, 'Search Test')
    const nameCol = (t.db.prepare('SELECT id FROM columns WHERE grid_id = ? AND is_name_column = 1').get(gridId) as any).id

    const r1 = addRow(t.db, gridId)
    const r2 = addRow(t.db, gridId)
    const r3 = addRow(t.db, gridId)

    upsertCell(t.db, r1, nameCol, 'Alice Johnson')
    upsertCell(t.db, r2, nameCol, 'Bob Smith')
    upsertCell(t.db, r3, nameCol, 'Alice Williams')

    // Manually set display_name (normally done by trigger, but trigger may not fire in test insert path)
    t.db.prepare('UPDATE rows SET display_name = ? WHERE id = ?').run('Alice Johnson', r1)
    t.db.prepare('UPDATE rows SET display_name = ? WHERE id = ?').run('Bob Smith', r2)
    t.db.prepare('UPDATE rows SET display_name = ? WHERE id = ?').run('Alice Williams', r3)

    // Search for "Alice"
    const results = t.db.prepare(`
      SELECT r.id, r.display_name
      FROM rows r
      WHERE r.is_active = 1 AND r.display_name LIKE ? ESCAPE '\\'
      ORDER BY r.display_name
    `).all('%Alice%') as any[]

    expect(results).toHaveLength(2)
    expect(results.map(r => r.display_name)).toContain('Alice Johnson')
    expect(results.map(r => r.display_name)).toContain('Alice Williams')
  })

  it('search returns no results for non-matching query', () => {
    const gridId = createGrid(t.db, 'No Match')
    const nameCol = (t.db.prepare('SELECT id FROM columns WHERE grid_id = ? AND is_name_column = 1').get(gridId) as any).id
    const r1 = addRow(t.db, gridId)
    upsertCell(t.db, r1, nameCol, 'Charlie Brown')
    t.db.prepare('UPDATE rows SET display_name = ? WHERE id = ?').run('Charlie Brown', r1)

    const results = t.db.prepare(`
      SELECT r.id FROM rows r
      WHERE r.is_active = 1 AND r.display_name LIKE ? ESCAPE '\\'
    `).all('%Zzzzz%') as any[]

    expect(results).toHaveLength(0)
  })
})

describe('Cell History', () => {
  it('records cell value changes in cell_history', () => {
    const gridId = createGrid(t.db, 'History Grid')
    const nameCol = (t.db.prepare('SELECT id FROM columns WHERE grid_id = ? AND is_name_column = 1').get(gridId) as any).id
    const rowId = addRow(t.db, gridId)

    // First set
    upsertCell(t.db, rowId, nameCol, 'Original')
    const cellId = (t.db.prepare('SELECT id FROM cells WHERE row_id = ? AND column_id = ?').get(rowId, nameCol) as any).id

    // Record history then update (simulates CELL_UPDATE handler)
    t.db.prepare(`
      INSERT INTO cell_history (cell_id, row_id, column_id, old_value, new_value, changed_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(cellId, rowId, nameCol, 'Original', 'Updated')
    upsertCell(t.db, rowId, nameCol, 'Updated')

    const history = t.db.prepare(`
      SELECT old_value, new_value FROM cell_history
      WHERE row_id = ? AND column_id = ?
      ORDER BY changed_at DESC
    `).all(rowId, nameCol) as any[]

    expect(history).toHaveLength(1)
    expect(history[0].old_value).toBe('Original')
    expect(history[0].new_value).toBe('Updated')
  })
})

describe('Pivot Query Correctness', () => {
  it('returns NULL for cells that have no value set', () => {
    const gridId = createGrid(t.db, 'Null Cells')
    const nameCol = (t.db.prepare('SELECT id FROM columns WHERE grid_id = ? AND is_name_column = 1').get(gridId) as any).id
    const extraCol = addColumn(t.db, gridId, 'Notes', 'text')
    const rowId = addRow(t.db, gridId)

    // Only set name, not notes
    upsertCell(t.db, rowId, nameCol, 'Partial Row')

    const { rows } = loadGrid(t.db, gridId)
    expect(rows).toHaveLength(1)
    expect((rows[0] as any)[`col_${nameCol}`]).toBe('Partial Row')
    expect((rows[0] as any)[`col_${extraCol}`]).toBeNull()
  })

  it('handles multiple rows with many columns correctly', () => {
    const gridId = createGrid(t.db, 'Many Cols')
    const nameCol = (t.db.prepare('SELECT id FROM columns WHERE grid_id = ? AND is_name_column = 1').get(gridId) as any).id
    const colIds: number[] = [nameCol]
    for (let i = 0; i < 10; i++) {
      colIds.push(addColumn(t.db, gridId, `Field ${i}`, 'text'))
    }

    const rowIds: number[] = []
    for (let i = 0; i < 5; i++) {
      const rid = addRow(t.db, gridId)
      rowIds.push(rid)
      upsertCell(t.db, rid, nameCol, `Client ${i}`)
      // Set every other column
      for (let j = 1; j < colIds.length; j += 2) {
        upsertCell(t.db, rid, colIds[j], `val_${i}_${j}`)
      }
    }

    const { rows } = loadGrid(t.db, gridId)
    expect(rows).toHaveLength(5)

    // Verify one row's data
    const row0 = rows[0] as any
    expect(row0[`col_${nameCol}`]).toBe('Client 0')
    expect(row0[`col_${colIds[1]}`]).toBe('val_0_1')
    expect(row0[`col_${colIds[2]}`]).toBeNull() // even columns not set
  })
})

describe('Scrap Notes', () => {
  it('upserts a scrap note and retrieves it', () => {
    const gridId = createGrid(t.db, 'Notes Grid')
    const rowId = addRow(t.db, gridId)

    // Insert
    t.db.prepare(`
      INSERT INTO scrap_notes (row_id, content, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(row_id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at
    `).run(rowId, '<p>Hello world</p>')

    const note = t.db.prepare('SELECT content FROM scrap_notes WHERE row_id = ?').get(rowId) as any
    expect(note.content).toBe('<p>Hello world</p>')

    // Update
    t.db.prepare(`
      INSERT INTO scrap_notes (row_id, content, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(row_id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at
    `).run(rowId, '<p>Updated note</p>')

    const updated = t.db.prepare('SELECT content FROM scrap_notes WHERE row_id = ?').get(rowId) as any
    expect(updated.content).toBe('<p>Updated note</p>')
  })
})

describe('Row Duplicate', () => {
  it('duplicates a row with cell values (excluding name column)', () => {
    const gridId = createGrid(t.db, 'Dup Test')
    const nameCol = (t.db.prepare('SELECT id FROM columns WHERE grid_id = ? AND is_name_column = 1').get(gridId) as any).id
    const statusCol = addColumn(t.db, gridId, 'Status', 'text')
    const rowId = addRow(t.db, gridId)

    upsertCell(t.db, rowId, nameCol, 'Original Name')
    upsertCell(t.db, rowId, statusCol, 'Active')

    // Duplicate logic (from ROW_DUPLICATE handler)
    const newRowId = t.db.transaction(() => {
      const result = t.db.prepare(`
        INSERT INTO rows (grid_id, position, is_active, is_starred, created_at, updated_at)
        VALUES (?, (SELECT COALESCE(MAX(position) + 1, 0) FROM rows WHERE grid_id = ?),
                1, 0, datetime('now'), datetime('now'))
      `).run(gridId, gridId)
      const id = result.lastInsertRowid as number

      // Copy cells except name column
      const cells = t.db.prepare('SELECT * FROM cells WHERE row_id = ? AND column_id != ?').all(rowId, nameCol) as any[]
      const insertCell = t.db.prepare("INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, ?, datetime('now'))")
      for (const cell of cells) {
        insertCell.run(id, cell.column_id, cell.value)
      }
      return id
    })()

    // Verify duplicate has status but not name
    const dupName = t.db.prepare('SELECT value FROM cells WHERE row_id = ? AND column_id = ?').get(newRowId, nameCol)
    expect(dupName).toBeUndefined()

    const dupStatus = t.db.prepare('SELECT value FROM cells WHERE row_id = ? AND column_id = ?').get(newRowId, statusCol) as any
    expect(dupStatus.value).toBe('Active')
  })
})

describe('Cell Format Operations', () => {
  it('sets and retrieves cell formats', () => {
    const gridId = createGrid(t.db, 'Format Test')
    const nameCol = (t.db.prepare('SELECT id FROM columns WHERE grid_id = ? AND is_name_column = 1').get(gridId) as any).id
    const rowId = addRow(t.db, gridId)

    const rules = JSON.stringify([{ bg: '#ff0000', color: '#ffffff' }])

    t.db.prepare(`
      INSERT INTO cell_formats (row_id, column_id, rules) VALUES (?, ?, ?)
      ON CONFLICT(row_id, column_id) DO UPDATE SET rules = excluded.rules
    `).run(rowId, nameCol, rules)

    const formats = t.db.prepare(`
      SELECT cf.row_id, cf.column_id, cf.rules
      FROM cell_formats cf
      JOIN rows r ON r.id = cf.row_id
      WHERE r.grid_id = ?
    `).all(gridId) as any[]

    expect(formats).toHaveLength(1)
    expect(JSON.parse(formats[0].rules)[0].bg).toBe('#ff0000')
  })
})
