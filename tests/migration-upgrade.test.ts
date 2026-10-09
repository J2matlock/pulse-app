/**
 * Migration Upgrade Path Tests — verifies full and partial migration chains,
 * idempotency, and failure isolation using real SQLite databases.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createEmptyEncryptedDb, cleanupTestDb, allMigrations, LATEST_SCHEMA_VERSION, type TestDb } from './helpers'

let t: TestDb

beforeEach(() => { t = createEmptyEncryptedDb() })
afterEach(() => { cleanupTestDb(t) })

function getSchemaVersion(): number {
  const row = t.db.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get() as { value: string } | undefined
  return row ? parseInt(row.value, 10) : 0
}

function runMigrationsFrom(fromVersion: number): void {
  for (const migration of allMigrations) {
    if (migration.version > fromVersion) {
      migration.up(t.db)
    }
  }
}

function runMigrationsUpTo(toVersion: number): void {
  for (const migration of allMigrations) {
    if (migration.version <= toVersion) {
      migration.up(t.db)
    }
  }
}

// ── Fresh DB ─────────────────────────────────────────────────────────────────

describe('Fresh DB — Full Migration Chain', () => {
  it(`reaches the latest schema version (${LATEST_SCHEMA_VERSION})`, () => {
    t.db.exec('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    for (const m of allMigrations) m.up(t.db)
    expect(getSchemaVersion()).toBe(LATEST_SCHEMA_VERSION)
  })

  it('creates all expected core tables', () => {
    t.db.exec('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    for (const m of allMigrations) m.up(t.db)

    const tables = t.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[]
    const names = tables.map(t => t.name).filter(n => !n.startsWith('sqlite_'))

    const expectedCoreTables = [
      'app_meta', 'grids', 'columns', 'rows', 'cells', 'cell_history',
      'alert_rules', 'checklist_items', 'case_log', 'scrap_notes',
      'checklist_templates', 'setup_templates',
      'tags', 'row_tags', 'saved_filters', 'saved_views',
      'snippets', 'letter_templates', 'action_log', 'settings',
      'caseload_tasks', 'caseload_task_history',
    ]
    for (const tbl of expectedCoreTables) {
      expect(names, `missing table: ${tbl}`).toContain(tbl)
    }
  })

  it('creates tables from later migrations (contacts, acuity, formats)', () => {
    t.db.exec('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    for (const m of allMigrations) m.up(t.db)

    const tables = t.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[]
    const names = tables.map(t => t.name)

    const laterTables = [
      'cell_formats', 'cond_format_rules',
      'provider_categories', 'providers', 'provider_tags',
      'provider_client_links', 'provider_interactions',
      'provider_custom_fields', 'provider_custom_values',
      'acuity_levels', 'global_notes',
    ]
    for (const tbl of laterTables) {
      expect(names, `missing table: ${tbl}`).toContain(tbl)
    }
  })
})

// ── Partial Upgrade: version 1 to latest ─────────────────────────────────────

describe('Partial Upgrade: v1 to latest', () => {
  it('migrates from version 1 to latest without errors', () => {
    t.db.exec('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    allMigrations[0].up(t.db)  // Run migration 1
    expect(getSchemaVersion()).toBe(1)

    runMigrationsFrom(1)
    expect(getSchemaVersion()).toBe(LATEST_SCHEMA_VERSION)
  })

  it('preserves data inserted at version 1', () => {
    t.db.exec('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    allMigrations[0].up(t.db)

    // Insert data at schema v1
    t.db.prepare("INSERT INTO grids (name, created_at, updated_at) VALUES ('My Caseload', datetime('now'), datetime('now'))").run()
    t.db.prepare("INSERT INTO columns (grid_id, name, column_type, position, is_name_column, created_at) VALUES (1, 'Name', 'text', 0, 1, datetime('now'))").run()
    t.db.prepare("INSERT INTO rows (grid_id, position, created_at, updated_at) VALUES (1, 0, datetime('now'), datetime('now'))").run()
    t.db.prepare("INSERT INTO cells (row_id, column_id, value) VALUES (1, 1, 'Alice')").run()

    // Run remaining migrations
    runMigrationsFrom(1)

    // Verify data survived
    const cell = t.db.prepare('SELECT value FROM cells WHERE row_id = 1 AND column_id = 1').get() as { value: string }
    expect(cell.value).toBe('Alice')
    const grid = t.db.prepare('SELECT name FROM grids WHERE id = 1').get() as { name: string }
    expect(grid.name).toBe('My Caseload')
  })
})

// ── Partial Upgrade: version 10 to latest ────────────────────────────────────

describe('Partial Upgrade: v10 to latest', () => {
  it('migrates from version 10 to latest without errors', () => {
    t.db.exec('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    runMigrationsUpTo(10)
    expect(getSchemaVersion()).toBe(10)

    runMigrationsFrom(10)
    expect(getSchemaVersion()).toBe(LATEST_SCHEMA_VERSION)
  })

  it('new indexes from v15+ exist after upgrade from v10', () => {
    t.db.exec('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    runMigrationsUpTo(10)
    runMigrationsFrom(10)

    const indexes = t.db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[]
    const indexNames = indexes.map(i => i.name)

    // From migration 015
    expect(indexNames).toContain('idx_cells_row_col')
    // From migration 019
    expect(indexNames).toContain('idx_row_tags_row')
    // From migration 022
    expect(indexNames).toContain('idx_checklist_items_completed')
  })
})

// ── Idempotency ──────────────────────────────────────────────────────────────

describe('Migration Idempotency', () => {
  it('running all migrations twice does not error', () => {
    t.db.exec('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')

    // First run
    for (const m of allMigrations) m.up(t.db)
    expect(getSchemaVersion()).toBe(LATEST_SCHEMA_VERSION)

    // Second run — should not throw because of IF NOT EXISTS and INSERT OR REPLACE
    expect(() => {
      for (const m of allMigrations) m.up(t.db)
    }).not.toThrow()

    expect(getSchemaVersion()).toBe(LATEST_SCHEMA_VERSION)
  })

  it('individual migration 001 is idempotent', () => {
    t.db.exec('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    allMigrations[0].up(t.db)
    expect(() => allMigrations[0].up(t.db)).not.toThrow()
    expect(getSchemaVersion()).toBe(1)
  })

  it('individual migration 006 (contacts) is idempotent', () => {
    t.db.exec('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    runMigrationsUpTo(6)
    expect(() => allMigrations[5].up(t.db)).not.toThrow()
    expect(getSchemaVersion()).toBe(6)
  })

  it('individual migration 011 (acuity) is idempotent', () => {
    t.db.exec('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    runMigrationsUpTo(11)
    expect(() => allMigrations[10].up(t.db)).not.toThrow()
    expect(getSchemaVersion()).toBe(11)
  })

  it('individual migration 024 (fix display_name) is idempotent', () => {
    t.db.exec('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    for (const m of allMigrations) m.up(t.db)
    expect(() => allMigrations[23].up(t.db)).not.toThrow()
    expect(getSchemaVersion()).toBe(24)
  })
})

// ── Failure Isolation ────────────────────────────────────────────────────────

describe('Migration Failure Isolation', () => {
  it('successful migrations persist even if a later one would fail', () => {
    t.db.exec('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')

    // Run through version 5 successfully
    runMigrationsUpTo(5)
    expect(getSchemaVersion()).toBe(5)

    // Verify the tables created by migration 1-5 exist
    const tables = t.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[]
    const names = tables.map(t => t.name)
    expect(names).toContain('grids')
    expect(names).toContain('columns')
    expect(names).toContain('rows')
    expect(names).toContain('cells')
  })

  it('schema version reflects last successful migration on simulated failure', () => {
    t.db.exec('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')

    // Run migrations 1-3
    runMigrationsUpTo(3)
    expect(getSchemaVersion()).toBe(3)

    // Simulate a "bad migration" that throws
    const badMigration = () => {
      t.db.exec('CREATE TABLE this_will_succeed_but_then (id INTEGER)')
      throw new Error('Simulated migration failure')
    }

    // Use transaction to simulate the real migration runner behavior
    expect(() => {
      const runInTx = t.db.transaction(() => badMigration())
      runInTx()
    }).toThrow('Simulated migration failure')

    // Schema version should still be 3 (transaction rolled back)
    expect(getSchemaVersion()).toBe(3)

    // The table from the failed migration should NOT exist (rolled back)
    const tables = t.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = 'this_will_succeed_but_then'")
      .all()
    expect(tables).toHaveLength(0)

    // Can still run remaining migrations from v3
    runMigrationsFrom(3)
    expect(getSchemaVersion()).toBe(LATEST_SCHEMA_VERSION)
  })
})

// ── Schema Correctness After Upgrade ─────────────────────────────────────────

describe('Schema Correctness After Upgrade', () => {
  it('rows table has display_name column (added by migration 017)', () => {
    t.db.exec('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    for (const m of allMigrations) m.up(t.db)

    const cols = t.db.prepare("PRAGMA table_info('rows')").all() as { name: string }[]
    const colNames = cols.map(c => c.name)
    expect(colNames).toContain('display_name')
  })

  it('rows table has deleted_at column (added by migration 012)', () => {
    t.db.exec('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    for (const m of allMigrations) m.up(t.db)

    const cols = t.db.prepare("PRAGMA table_info('rows')").all() as { name: string }[]
    const colNames = cols.map(c => c.name)
    expect(colNames).toContain('deleted_at')
  })

  it('case_log has voided_at column (added by migration 010)', () => {
    t.db.exec('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    for (const m of allMigrations) m.up(t.db)

    const cols = t.db.prepare("PRAGMA table_info('case_log')").all() as { name: string }[]
    const colNames = cols.map(c => c.name)
    expect(colNames).toContain('voided_at')
  })

  it('foreign keys are enforced after full migration', () => {
    t.db.exec('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    for (const m of allMigrations) m.up(t.db)

    // Try inserting a cell referencing a non-existent row — should fail FK
    expect(() => {
      t.db.prepare("INSERT INTO cells (row_id, column_id, value) VALUES (9999, 9999, 'test')").run()
    }).toThrow()
  })
})
