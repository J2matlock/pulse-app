/** Migration 044 — notes get occurred_at (when it happened) and a record of the dates they moved. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createEmptyEncryptedDb, cleanupTestDb, allMigrations, seedGrid, type TestDb } from './helpers'
import { up as migration044 } from '../src/main/migrations/044_note_occurred_at'

let t: TestDb
beforeEach(() => {
  t = createEmptyEncryptedDb()
  t.db.exec('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  for (const m of allMigrations) if (m.version <= 43) m.up(t.db)
})
afterEach(() => cleanupTestDb(t))

describe('migration 044', () => {
  it('dates existing notes by when they were written, and fills the date for new ones that leave it out', () => {
    const { rowIds } = seedGrid(t.db, { rowCount: 1 })
    t.db.prepare("INSERT INTO case_log (row_id, content, log_type, created_at) VALUES (?, 'old', 'visit', '2026-03-01 15:00:00')").run(rowIds[0])
    migration044(t.db)
    expect(t.db.prepare("SELECT occurred_at FROM case_log WHERE content = 'old'").get()).toEqual({ occurred_at: '2026-03-01 15:00:00' })
    t.db.prepare("INSERT INTO case_log (row_id, content, log_type, created_at) VALUES (?, 'new', 'note', '2026-04-02 08:00:00')").run(rowIds[0])
    expect(t.db.prepare("SELECT occurred_at FROM case_log WHERE content = 'new'").get()).toEqual({ occurred_at: '2026-04-02 08:00:00' })
    t.db.prepare("INSERT INTO case_log (row_id, content, log_type, occurred_at, created_at) VALUES (?, 'late', 'visit', '2026-04-01 12:00:00', '2026-04-03 08:00:00')").run(rowIds[0])
    expect(t.db.prepare("SELECT occurred_at FROM case_log WHERE content = 'late'").get()).toEqual({ occurred_at: '2026-04-01 12:00:00' })
  })

  it('adds the edit-history date and the moved-dates table', () => {
    migration044(t.db)
    const editCols = (t.db.prepare("SELECT name FROM pragma_table_info('case_log_edits')").all() as Array<{ name: string }>).map(c => c.name)
    expect(editCols).toContain('occurred_at')
    expect(t.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'note_date_moves'").get()).toBeTruthy()
  })

  it('is safe to run twice', () => {
    migration044(t.db)
    expect(() => migration044(t.db)).not.toThrow()
    expect((t.db.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get() as { value: string }).value).toBe('44')
  })
})
