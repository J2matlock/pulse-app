/** Migration 047 — sample entries tracked one by one; existing ones the user changed become real. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createEmptyEncryptedDb, cleanupTestDb, allMigrations, type TestDb } from './helpers'
import { up as migration047 } from '../src/main/migrations/047_sample_rows'

let t: TestDb
beforeEach(() => {
  t = createEmptyEncryptedDb()
  t.db.exec('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  for (const m of allMigrations) if (m.version < 47) m.up(t.db)
})
afterEach(() => cleanupTestDb(t))

const ids = () => (t.db.prepare('SELECT row_id FROM sample_rows ORDER BY row_id').all() as Array<{ row_id: number }>).map(r => r.row_id)

describe('migration 047', () => {
  it('tracks an old sample list, leaving out entries the user added or changed', () => {
    const db = t.db
    const gridId = Number(db.prepare("INSERT INTO grids (name, created_at, updated_at) VALUES ('Sample', datetime('now', '-1 day'), datetime('now', '-1 day'))").run().lastInsertRowid)
    const col = Number(db.prepare("INSERT INTO columns (grid_id, name, column_type) VALUES (?, 'Name', 'text')").run(gridId).lastInsertRowid)
    const row = (ago: string) => Number(db.prepare("INSERT INTO rows (grid_id, position, created_at, updated_at) VALUES (?, 0, datetime('now', ?), datetime('now', ?))").run(gridId, ago, ago).lastInsertRowid)
    const cell = (rowId: number, ago: string) => db.prepare("INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, 'x', datetime('now', ?))").run(rowId, col, ago)
    const untouched = row('-1 day'); cell(untouched, '-1 day')
    const edited = row('-1 day'); cell(edited, '-1 hour')
    const noted = row('-1 day'); cell(noted, '-1 day')
    db.prepare("INSERT INTO case_log (row_id, content, log_type, created_at) VALUES (?, 'Real', 'visit', datetime('now'))").run(noted)
    const generatedNote = row('-1 day'); cell(generatedNote, '-1 day')
    db.prepare("INSERT INTO case_log (row_id, content, log_type, created_at) VALUES (?, 'Made up', 'visit', datetime('now', '-30 days'))").run(generatedNote)
    const theirs = row('-1 hour'); cell(theirs, '-1 hour')
    db.prepare("INSERT INTO app_meta (key, value) VALUES ('sample_data', ?)").run(JSON.stringify({ gridId, alertRuleIds: [], providerIds: [], taskIds: [] }))

    migration047(db)
    expect(ids()).toEqual([untouched, generatedNote])
    expect(theirs).toBeGreaterThan(0)
  })

  it('moves starter sample ids out of app_meta, skipping edited ones', () => {
    const db = t.db
    const gridId = Number(db.prepare("INSERT INTO grids (name) VALUES ('Customers')").run().lastInsertRowid)
    const col = Number(db.prepare("INSERT INTO columns (grid_id, name, column_type) VALUES (?, 'Name', 'text')").run(gridId).lastInsertRowid)
    const make = (ago: string) => {
      const id = Number(db.prepare('INSERT INTO rows (grid_id, position) VALUES (?, 0)').run(gridId).lastInsertRowid)
      db.prepare("INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, 'x', datetime('now', ?))").run(id, col, ago)
      return id
    }
    const a = make('-2 days'), b = make('-2 days'), c = make('-1 day')
    db.prepare("INSERT INTO app_meta (key, value) VALUES ('starter_sample', ?)").run(JSON.stringify({ rowIds: [a, b, c] }))
    migration047(db)
    expect(ids()).toEqual([a, b])
    expect(db.prepare("SELECT 1 FROM app_meta WHERE key = 'starter_sample'").get()).toBeUndefined()
    const tracked = db.prepare('SELECT grid_id, fingerprint, asked FROM sample_rows WHERE row_id = ?').get(a) as { grid_id: number; fingerprint: string; asked: number }
    expect(tracked).toMatchObject({ grid_id: gridId, asked: 0 })
    expect(tracked.fingerprint).toContain(`${col}:x`)
  })

  it('is safe to run twice', () => {
    migration047(t.db)
    expect(() => migration047(t.db)).not.toThrow()
    expect((t.db.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get() as { value: string }).value).toBe('47')
  })
})
