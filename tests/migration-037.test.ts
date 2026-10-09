/**
 * Migration 037 — note types table, custom measures column, requirement periods.
 * Existing notes and requirements must keep working exactly as before.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createEmptyEncryptedDb, cleanupTestDb, allMigrations, type TestDb } from './helpers'
import { up as migration037 } from '../src/main/migrations/037_activity_types'

let t: TestDb
let rowId: number
let gridId: number

beforeEach(() => {
  t = createEmptyEncryptedDb()
  t.db.exec('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  for (const m of allMigrations) if (m.version <= 36) m.up(t.db)
  gridId = Number(t.db.prepare("INSERT INTO grids (name, position) VALUES ('Mine', 0)").run().lastInsertRowid)
  rowId = Number(t.db.prepare("INSERT INTO rows (grid_id, position) VALUES (?, 0)").run(gridId).lastInsertRowid)
})
afterEach(() => { cleanupTestDb(t) })

const types = () => t.db.prepare('SELECT key, label, icon, color, position, is_archived FROM activity_types ORDER BY position').all()

describe('migration 037', () => {
  it('seeds the five note types with the labels and icons people already see', () => {
    migration037(t.db)
    expect(types()).toEqual([
      { key: 'note', label: 'Note', icon: '📝', color: 'slate', position: 0, is_archived: 0 },
      { key: 'phone', label: 'Phone', icon: '📞', color: 'blue', position: 1, is_archived: 0 },
      { key: 'meeting', label: 'Meeting', icon: '🤝', color: 'green', position: 2, is_archived: 0 },
      { key: 'email', label: 'Email', icon: '✉️', color: 'purple', position: 3, is_archived: 0 },
      { key: 'visit', label: 'Visit', icon: '🏠', color: 'orange', position: 4, is_archived: 0 },
    ])
  })

  it('keeps a label for any other key already on a note, as an archived type', () => {
    t.db.prepare("INSERT INTO case_log (row_id, content, log_type) VALUES (?, 'a', 'home_check'), (?, 'b', 'system'), (?, 'c', 'phone')").run(rowId, rowId, rowId)
    migration037(t.db)
    expect(t.db.prepare("SELECT label, is_archived FROM activity_types WHERE key = 'home_check'").get()).toEqual({ label: 'Home check', is_archived: 1 })
    expect(t.db.prepare("SELECT 1 FROM activity_types WHERE key = 'system'").get()).toBeUndefined()
  })

  it('adds extra_measures to notes and a monthly period to existing requirements', () => {
    t.db.prepare("INSERT INTO contact_requirements (grid_id, label, note_types, per_month) VALUES (?, 'Visits', '[\"visit\"]', 2)").run(gridId)
    migration037(t.db)
    const logCols = (t.db.prepare("SELECT name FROM pragma_table_info('case_log')").all() as Array<{ name: string }>).map(c => c.name)
    expect(logCols).toContain('extra_measures')
    expect(t.db.prepare('SELECT period, per_month FROM contact_requirements').get()).toEqual({ period: 'month', per_month: 2 })
  })

  it('is safe to run twice and keeps renamed types', () => {
    migration037(t.db)
    t.db.prepare("UPDATE activity_types SET label = 'Session' WHERE key = 'meeting'").run()
    expect(() => migration037(t.db)).not.toThrow()
    expect(t.db.prepare("SELECT label FROM activity_types WHERE key = 'meeting'").get()).toEqual({ label: 'Session' })
    expect((t.db.prepare('SELECT COUNT(*) AS n FROM activity_types').get() as { n: number }).n).toBe(5)
    expect((t.db.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get() as { value: string }).value).toBe('37')
  })
})
