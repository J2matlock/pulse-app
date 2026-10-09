/**
 * Migration 036 — workspace words and feature switches.
 * Existing installs keep today's words and features; new ones get nothing.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createEmptyEncryptedDb, cleanupTestDb, allMigrations, type TestDb } from './helpers'
import { up as migration036 } from '../src/main/migrations/036_workspace'
import { HUMAN_SERVICES_VOCAB, parseVocab } from '../src/shared/vocab'
import { parseFeatures } from '../src/shared/features'

let t: TestDb

beforeEach(() => {
  t = createEmptyEncryptedDb()
  t.db.exec('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  for (const m of allMigrations) if (m.version <= 35) m.up(t.db)
})
afterEach(() => { cleanupTestDb(t) })

const setting = (key: string) =>
  (t.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value

describe('migration 036', () => {
  it('adds record_kind, vocab and display_format to grids', () => {
    migration036(t.db)
    const cols = (t.db.prepare("SELECT name FROM pragma_table_info('grids')").all() as Array<{ name: string }>).map(c => c.name)
    expect(cols).toEqual(expect.arrayContaining(['record_kind', 'vocab', 'display_format']))
  })

  it('writes nothing to settings on an empty database', () => {
    migration036(t.db)
    expect(setting('workspace_vocab')).toBeUndefined()
    expect(setting('workspace_features')).toBeUndefined()
  })

  it('freezes human-services words and current features on an install with lists', () => {
    t.db.prepare("INSERT INTO grids (name, position) VALUES ('My caseload', 0)").run()
    t.db.prepare("INSERT INTO settings (key, value) VALUES ('track_time', 'true')").run()
    migration036(t.db)

    expect(parseVocab(setting('workspace_vocab'))).toEqual(HUMAN_SERVICES_VOCAB)
    const features = parseFeatures(setting('workspace_features'))
    expect(features).toMatchObject({ timeTracking: true, mileage: false, letters: true, requirements: true, priority: true })
    expect(features?.appointments).toBeUndefined()

    const grid = t.db.prepare('SELECT record_kind, vocab, display_format FROM grids').get()
    expect(grid).toEqual({ record_kind: 'person', vocab: null, display_format: null })
  })

  it('is safe to run twice and never overwrites saved words', () => {
    t.db.prepare("INSERT INTO grids (name, position) VALUES ('Mine', 0)").run()
    migration036(t.db)
    t.db.prepare("UPDATE settings SET value = '{}' WHERE key = 'workspace_vocab'").run()
    expect(() => migration036(t.db)).not.toThrow()
    expect(setting('workspace_vocab')).toBe('{}')
    expect((t.db.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get() as { value: string }).value).toBe('36')
  })
})
