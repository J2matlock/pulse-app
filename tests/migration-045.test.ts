/** Migration 045 — parked cells, deleted columns and the list trash (audit 2026-10, D1). */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createEmptyEncryptedDb, cleanupTestDb, allMigrations, type TestDb } from './helpers'
import { up as migration045 } from '../src/main/migrations/045_list_trash'

let t: TestDb
beforeEach(() => {
  t = createEmptyEncryptedDb()
  t.db.exec('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  for (const m of allMigrations) if (m.version < 45) m.up(t.db)
})
afterEach(() => cleanupTestDb(t))

describe('migration 045', () => {
  it('adds the tables and gives lists deleted earlier 30 days in the Trash from now', () => {
    t.db.prepare("INSERT INTO grids (name, is_active) VALUES ('Kept', 1), ('Deleted earlier', 0)").run()
    migration045(t.db)
    const tables = (t.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(r => r.name)
    expect(tables).toEqual(expect.arrayContaining(['parked_cells', 'deleted_columns']))
    const grids = t.db.prepare('SELECT name, deleted_at FROM grids ORDER BY id').all() as Array<{ name: string; deleted_at: string | null }>
    expect(grids[0]!.deleted_at).toBeNull()
    expect(grids[1]!.deleted_at).toMatch(/^\d{4}-\d{2}-\d{2} /)
  })

  it('is safe to run twice', () => {
    migration045(t.db)
    expect(() => migration045(t.db)).not.toThrow()
    expect((t.db.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get() as { value: string }).value).toBe('45')
  })

  it('turns "highlight all rows" copies into one column rule, and leaves a few chosen ones per cell (L-19)', () => {
    const grid = Number(t.db.prepare("INSERT INTO grids (name) VALUES ('L')").run().lastInsertRowid)
    const col = Number(t.db.prepare("INSERT INTO columns (grid_id, name, column_type, position) VALUES (?, 'Score', 'number', 0)").run(grid).lastInsertRowid)
    const other = Number(t.db.prepare("INSERT INTO columns (grid_id, name, column_type, position) VALUES (?, 'Note', 'text', 1)").run(grid).lastInsertRowid)
    const rows = [0, 1, 2, 3].map(i => Number(t.db.prepare('INSERT INTO rows (grid_id, position) VALUES (?, ?)').run(grid, i).lastInsertRowid))
    const rule = { sourceType: 'self', operator: 'greater_than', value: '90', bgColor: '#fee2e2', originRowId: rows[0] }
    const put = t.db.prepare('INSERT INTO cell_formats (row_id, column_id, rules) VALUES (?, ?, ?)')
    for (const r of rows.slice(0, 3)) put.run(r, col, JSON.stringify([rule]))
    // One record's own highlight stays on that cell
    put.run(rows[3], other, JSON.stringify([{ ...rule, originRowId: rows[3] }]))
    migration045(t.db)
    const { conditional_format } = t.db.prepare('SELECT conditional_format FROM columns WHERE id = ?').get(col) as { conditional_format: string }
    expect(JSON.parse(conditional_format)).toEqual([{ sourceType: 'self', operator: 'greater_than', value: '90', bgColor: '#fee2e2' }])
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM cell_formats WHERE column_id = ?').get(col)).toEqual({ n: 0 })
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM cell_formats WHERE column_id = ?').get(other)).toEqual({ n: 1 })
  })
})
