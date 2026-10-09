/**
 * Acuity Scoring System Tests — tests against real SQLCipher DB.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'

let t: TestDb

beforeEach(() => { t = createTestDb() })
afterEach(() => { cleanupTestDb(t) })

describe('Acuity Levels', () => {
  it('create acuity level, verify returned fields', () => {
    const { gridId } = seedGrid(t.db, { rowCount: 0, columnCount: 1 })
    t.db.prepare(`
      INSERT INTO acuity_levels (grid_id, name, abbreviation, points, color, position)
      VALUES (?, 'High', 'H', 3, '#ef4444', 0)
    `).run(gridId)

    const level = t.db.prepare('SELECT * FROM acuity_levels WHERE grid_id = ?').get(gridId) as Record<string, unknown>
    expect(level.name).toBe('High')
    expect(level.abbreviation).toBe('H')
    expect(level.points).toBe(3)
    expect(level.color).toBe('#ef4444')
    expect(level.position).toBe(0)
    expect(level.id).toBeDefined()
  })

  it('create multiple levels, verify ordering by position', () => {
    const { gridId } = seedGrid(t.db, { rowCount: 0, columnCount: 1 })
    const insert = t.db.prepare(`
      INSERT INTO acuity_levels (grid_id, name, abbreviation, points, color, position)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    insert.run(gridId, 'Low', 'L', 1, '#22c55e', 0)
    insert.run(gridId, 'Medium', 'M', 2, '#eab308', 1)
    insert.run(gridId, 'High', 'H', 3, '#ef4444', 2)

    const levels = t.db.prepare(
      'SELECT name FROM acuity_levels WHERE grid_id = ? ORDER BY position'
    ).all(gridId) as { name: string }[]
    expect(levels.map(l => l.name)).toEqual(['Low', 'Medium', 'High'])
  })

  it('update level (name, points, color), verify change persists', () => {
    const { gridId } = seedGrid(t.db, { rowCount: 0, columnCount: 1 })
    const r = t.db.prepare(`
      INSERT INTO acuity_levels (grid_id, name, abbreviation, points, color, position)
      VALUES (?, 'High', 'H', 3, '#ef4444', 0)
    `).run(gridId)
    const levelId = r.lastInsertRowid as number

    t.db.prepare('UPDATE acuity_levels SET name = ?, points = ?, color = ? WHERE id = ?')
      .run('Critical', 5, '#dc2626', levelId)

    const updated = t.db.prepare('SELECT name, points, color FROM acuity_levels WHERE id = ?')
      .get(levelId) as { name: string; points: number; color: string }
    expect(updated.name).toBe('Critical')
    expect(updated.points).toBe(5)
    expect(updated.color).toBe('#dc2626')
  })

  it('delete level: must null out rows first, then delete', () => {
    const { gridId, rowIds } = seedGrid(t.db, { rowCount: 2, columnCount: 1 })
    const r = t.db.prepare(`
      INSERT INTO acuity_levels (grid_id, name, abbreviation, points, color, position)
      VALUES (?, 'High', 'H', 3, '#ef4444', 0)
    `).run(gridId)
    const levelId = r.lastInsertRowid as number

    // Assign level to rows
    t.db.prepare('UPDATE rows SET acuity_level_id = ? WHERE id = ?').run(levelId, rowIds[0])
    t.db.prepare('UPDATE rows SET acuity_level_id = ? WHERE id = ?').run(levelId, rowIds[1])

    // App-level cleanup: null out rows referencing the level, then delete
    t.db.prepare('UPDATE rows SET acuity_level_id = NULL WHERE acuity_level_id = ?').run(levelId)
    t.db.prepare('DELETE FROM acuity_levels WHERE id = ?').run(levelId)

    // Level should be gone
    const level = t.db.prepare('SELECT * FROM acuity_levels WHERE id = ?').get(levelId)
    expect(level).toBeUndefined()

    // Rows should have NULL acuity_level_id
    for (const rowId of rowIds) {
      const row = t.db.prepare('SELECT acuity_level_id FROM rows WHERE id = ?').get(rowId) as { acuity_level_id: number | null }
      expect(row.acuity_level_id).toBeNull()
    }
  })

  it('reorder levels, verify new positions', () => {
    const { gridId } = seedGrid(t.db, { rowCount: 0, columnCount: 1 })
    const insert = t.db.prepare(`
      INSERT INTO acuity_levels (grid_id, name, abbreviation, points, color, position)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    const id1 = insert.run(gridId, 'Low', 'L', 1, '#22c55e', 0).lastInsertRowid as number
    const id2 = insert.run(gridId, 'Medium', 'M', 2, '#eab308', 1).lastInsertRowid as number
    const id3 = insert.run(gridId, 'High', 'H', 3, '#ef4444', 2).lastInsertRowid as number

    // Reverse order
    const update = t.db.prepare('UPDATE acuity_levels SET position = ? WHERE id = ?')
    t.db.transaction(() => {
      update.run(0, id3)
      update.run(1, id2)
      update.run(2, id1)
    })()

    const levels = t.db.prepare(
      'SELECT id FROM acuity_levels WHERE grid_id = ? ORDER BY position'
    ).all(gridId) as { id: number }[]
    expect(levels.map(l => l.id)).toEqual([id3, id2, id1])
  })

  it('assign level to row, verify acuity_level_id on row', () => {
    const { gridId, rowIds } = seedGrid(t.db, { rowCount: 1, columnCount: 1 })
    const r = t.db.prepare(`
      INSERT INTO acuity_levels (grid_id, name, abbreviation, points, color, position)
      VALUES (?, 'Medium', 'M', 2, '#eab308', 0)
    `).run(gridId)
    const levelId = r.lastInsertRowid as number

    t.db.prepare('UPDATE rows SET acuity_level_id = ? WHERE id = ?').run(levelId, rowIds[0])
    const row = t.db.prepare('SELECT acuity_level_id FROM rows WHERE id = ?').get(rowIds[0]) as { acuity_level_id: number }
    expect(row.acuity_level_id).toBe(levelId)
  })

  it('clear level from row (set null)', () => {
    const { gridId, rowIds } = seedGrid(t.db, { rowCount: 1, columnCount: 1 })
    const r = t.db.prepare(`
      INSERT INTO acuity_levels (grid_id, name, abbreviation, points, color, position)
      VALUES (?, 'High', 'H', 3, '#ef4444', 0)
    `).run(gridId)
    const levelId = r.lastInsertRowid as number

    t.db.prepare('UPDATE rows SET acuity_level_id = ? WHERE id = ?').run(levelId, rowIds[0])
    t.db.prepare('UPDATE rows SET acuity_level_id = NULL WHERE id = ?').run(rowIds[0])
    const row = t.db.prepare('SELECT acuity_level_id FROM rows WHERE id = ?').get(rowIds[0]) as { acuity_level_id: number | null }
    expect(row.acuity_level_id).toBeNull()
  })

  it('toggle acuity_enabled on grid', () => {
    const { gridId } = seedGrid(t.db, { rowCount: 0, columnCount: 1 })
    // Default should be 0
    let grid = t.db.prepare('SELECT acuity_enabled FROM grids WHERE id = ?').get(gridId) as { acuity_enabled: number }
    expect(grid.acuity_enabled).toBe(0)

    t.db.prepare('UPDATE grids SET acuity_enabled = 1 WHERE id = ?').run(gridId)
    grid = t.db.prepare('SELECT acuity_enabled FROM grids WHERE id = ?').get(gridId) as { acuity_enabled: number }
    expect(grid.acuity_enabled).toBe(1)

    t.db.prepare('UPDATE grids SET acuity_enabled = 0 WHERE id = ?').run(gridId)
    grid = t.db.prepare('SELECT acuity_enabled FROM grids WHERE id = ?').get(gridId) as { acuity_enabled: number }
    expect(grid.acuity_enabled).toBe(0)
  })
})
