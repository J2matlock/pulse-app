/** Migration 038 — deadline engine v2 columns and tables; existing rules stay intervals. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createEmptyEncryptedDb, cleanupTestDb, allMigrations, type TestDb } from './helpers'
import { up as migration038 } from '../src/main/migrations/038_deadline_engine'

let t: TestDb
beforeEach(() => {
  t = createEmptyEncryptedDb()
  t.db.exec('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  for (const m of allMigrations) if (m.version <= 37) m.up(t.db)
})
afterEach(() => cleanupTestDb(t))

describe('migration 038', () => {
  it('keeps existing rules as plain intervals and adds the tables', () => {
    t.db.prepare("INSERT INTO alert_rules (name, thresholds, interval_days) VALUES ('Monthly', '[]', 30)").run()
    migration038(t.db)
    expect(t.db.prepare('SELECT kind, rule_config, rule_condition, business_days FROM alert_rules').get())
      .toEqual({ kind: 'interval', rule_config: null, rule_condition: null, business_days: 0 })
    const tables = (t.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(r => r.name)
    expect(tables).toEqual(expect.arrayContaining(['deadline_extensions', 'deadline_progress']))
  })

  it('is safe to run twice', () => {
    migration038(t.db)
    expect(() => migration038(t.db)).not.toThrow()
    expect((t.db.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get() as { value: string }).value).toBe('38')
  })
})
