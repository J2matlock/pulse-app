/**
 * Migration 049 — indexes for foreign-key lookups no index led with (A22-07,
 * A22-08; DF-06): record links by either record, field history by column,
 * and the per-cell tables by column.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Database } from 'better-sqlite3-multiple-ciphers'
import { createEmptyEncryptedDb, cleanupTestDb, allMigrations, type TestDb } from './helpers'
import { up as migration049 } from '../src/main/migrations/049_fk_child_indexes'

let t: TestDb
/** Every statement deadlines.ts prepares, so the test can EXPLAIN the real SQL */
const prepared: string[] = []
vi.mock('../src/main/database', () => ({
  getDb: () => ({ prepare: (sql: string) => { prepared.push(sql); return t.db.prepare(sql) } }),
  cachedStmt: (_k: string, sql: string) => { prepared.push(sql); return t.db.prepare(sql) },
}))

import { previousValues, meterHistories, finishedDates, progressEntries } from '../src/main/deadlines'

beforeEach(() => {
  t = createEmptyEncryptedDb()
  t.db.exec('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  for (const m of allMigrations) if (m.version < 49) m.up(t.db)
  prepared.length = 0
})
afterEach(() => cleanupTestDb(t))

const version = () => (t.db.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get() as { value: string }).value
const plan = (db: Database, sql: string, ...args: unknown[]) =>
  (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args) as Array<{ detail: string }>).map(r => r.detail).join(' | ')
const count = (sql: string, ...args: unknown[]) => (t.db.prepare(sql).get(...args) as { n: number }).n

function seed(): { gridId: number; rowA: number; rowB: number; dateCol: number; textCol: number; linkTypeId: number } {
  const db = t.db
  const gridId = Number(db.prepare("INSERT INTO grids (name) VALUES ('People')").run().lastInsertRowid)
  const other = Number(db.prepare("INSERT INTO grids (name) VALUES ('Households')").run().lastInsertRowid)
  const dateCol = Number(db.prepare("INSERT INTO columns (grid_id, name, column_type, position) VALUES (?, 'Done', 'date', 0)").run(gridId).lastInsertRowid)
  const textCol = Number(db.prepare("INSERT INTO columns (grid_id, name, column_type, position) VALUES (?, 'Notes', 'text', 1)").run(gridId).lastInsertRowid)
  const rowA = Number(db.prepare('INSERT INTO rows (grid_id, position) VALUES (?, 0)').run(gridId).lastInsertRowid)
  const rowB = Number(db.prepare('INSERT INTO rows (grid_id, position) VALUES (?, 1)').run(gridId).lastInsertRowid)
  const house = Number(db.prepare('INSERT INTO rows (grid_id, position) VALUES (?, 0)').run(other).lastInsertRowid)
  const linkTypeId = Number(db.prepare("INSERT INTO link_types (from_grid_id, to_grid_id, label_forward, label_backward, cardinality) VALUES (?, ?, 'Household', 'Members', 'many_to_one')")
    .run(gridId, other).lastInsertRowid)
  db.prepare('INSERT INTO record_links (link_type_id, from_row_id, to_row_id) VALUES (?, ?, ?)').run(linkTypeId, rowA, house)
  db.prepare('INSERT INTO record_links (link_type_id, from_row_id, to_row_id) VALUES (?, ?, ?)').run(linkTypeId, rowB, house)
  const cell = Number(db.prepare("INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, '2026-04-15')").run(rowA, dateCol).lastInsertRowid)
  const hist = db.prepare('INSERT INTO cell_history (cell_id, row_id, column_id, old_value, new_value) VALUES (?, ?, ?, ?, ?)')
  hist.run(cell, rowA, dateCol, null, '2026-01-15')
  hist.run(cell, rowA, dateCol, '2026-01-15', '2026-04-15')
  db.prepare("INSERT INTO deadline_done (row_id, column_id, done_for) VALUES (?, ?, '2026-04-15')").run(rowA, dateCol)
  db.prepare("INSERT INTO deadline_progress (row_id, column_id, step, done_at) VALUES (?, ?, 1, '2026-04-15')").run(rowA, dateCol)
  db.prepare("INSERT INTO cell_formats (row_id, column_id, rules) VALUES (?, ?, '[]')").run(rowA, textCol)
  return { gridId, rowA, rowB, dateCol, textCol, linkTypeId }
}

describe('migration 049', () => {
  it('upgrades a v48 database, keeping its data, and the cascade lookups use the new indexes', () => {
    const s = seed()
    expect(version()).toBe('48')
    // Before: no index leads with from_row_id / to_row_id / column_id
    expect(plan(t.db, 'SELECT 1 FROM record_links WHERE from_row_id = ?', 1)).not.toMatch(/SEARCH record_links USING (COVERING )?INDEX \w+ \(from_row_id=\?\)/)
    expect(plan(t.db, 'SELECT 1 FROM cell_history WHERE column_id = ?', 1)).toMatch(/SCAN cell_history/)

    migration049(t.db)

    expect(version()).toBe('49')
    expect(plan(t.db, 'SELECT 1 FROM record_links WHERE from_row_id = ?', 1)).toMatch(/USING (COVERING )?INDEX idx_record_links_from_row \(from_row_id=\?\)/)
    expect(plan(t.db, 'SELECT 1 FROM record_links WHERE to_row_id = ?', 1)).toMatch(/USING (COVERING )?INDEX idx_record_links_to_row \(to_row_id=\?\)/)
    for (const [table, index] of [
      ['cell_formats', 'idx_cell_formats_column'], ['deadline_progress', 'idx_deadline_progress_column'],
      ['deadline_extensions', 'idx_deadline_extensions_column'], ['deadline_done', 'idx_deadline_done_column'],
      ['parked_cells', 'idx_parked_cells_column'], ['note_date_moves', 'idx_note_date_moves_column'],
    ] as const) {
      expect(plan(t.db, `SELECT 1 FROM ${table} WHERE column_id = ?`, 1), table).toMatch(new RegExp(`USING (COVERING )?INDEX ${index} \\(column_id=\\?\\)`))
    }
    expect(count('SELECT COUNT(*) AS n FROM record_links WHERE link_type_id = ?', s.linkTypeId)).toBe(2)
    expect(count('SELECT COUNT(*) AS n FROM cell_history')).toBe(2)
  })

  it("the deadline loaders' own queries read history, done dates and steps by column through an index", () => {
    const s = seed()
    migration049(t.db)
    expect(previousValues(s.dateCol)).toEqual(new Map([[s.rowA, '2026-01-15']]))
    meterHistories(s.dateCol)
    expect(finishedDates(s.dateCol)).toEqual(new Map([[s.rowA, ['2026-04-15']]]))
    expect(progressEntries(s.dateCol).get(s.rowA)).toEqual([{ step: 1, anchor: null }])
    const byColumn = prepared.filter(sql => /FROM (cell_history|deadline_done|deadline_progress)/.test(sql))
    expect(byColumn).toHaveLength(5)
    for (const sql of byColumn) {
      const named = sql.includes('@columnId')
      const p = named ? plan(t.db, sql, { columnId: s.dateCol, until: null }) : plan(t.db, sql, ...Array(sql.split('?').length - 1).fill(s.dateCol))
      expect(p, sql).not.toMatch(/\bSCAN\b/)
      expect(p, sql).toMatch(/SEARCH \w+ USING (COVERING )?INDEX (idx_cell_history_col_row|idx_deadline_done_column|idx_deadline_progress_column) \(column_id=\?/)
    }
  })

  it('deleting a record still deletes its links both ways, and deleting a column its per-cell data', () => {
    const s = seed()
    migration049(t.db)
    t.db.prepare('DELETE FROM columns WHERE id = ?').run(s.dateCol)
    t.db.prepare('DELETE FROM columns WHERE id = ?').run(s.textCol)
    expect(count('SELECT COUNT(*) AS n FROM deadline_done')).toBe(0)
    expect(count('SELECT COUNT(*) AS n FROM deadline_progress')).toBe(0)
    expect(count('SELECT COUNT(*) AS n FROM cell_formats')).toBe(0)
    t.db.prepare('DELETE FROM rows WHERE id = ?').run(s.rowA)
    expect(count('SELECT COUNT(*) AS n FROM record_links WHERE from_row_id = ? OR to_row_id = ?', s.rowA, s.rowA)).toBe(0)
    expect(count('SELECT COUNT(*) AS n FROM record_links WHERE from_row_id = ?', s.rowB)).toBe(1)
  })

  it('is safe to run twice', () => {
    migration049(t.db)
    expect(() => migration049(t.db)).not.toThrow()
    expect(version()).toBe('49')
  })
})
