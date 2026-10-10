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
})
