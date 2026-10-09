/**
 * Full Migration Chain Tests — verifies all migrations run cleanly on empty DB.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createEmptyEncryptedDb, cleanupTestDb, allMigrations, LATEST_SCHEMA_VERSION, type TestDb } from './helpers'

let t: TestDb

beforeEach(() => { t = createEmptyEncryptedDb() })
afterEach(() => { cleanupTestDb(t) })

function runAllMigrations(): void {
  t.db.exec('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  for (const m of allMigrations) m.up(t.db)
}

describe('Full Migration Chain', () => {
  it(`runs all ${allMigrations.length} migrations on empty DB, reaches schema_version ${LATEST_SCHEMA_VERSION}`, () => {
    runAllMigrations()

    const row = t.db.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get() as { value: string }
    expect(Number(row.value)).toBe(LATEST_SCHEMA_VERSION)
  })

  it('all expected tables exist after full migration', () => {
    runAllMigrations()

    const tables = t.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[]
    const names = tables.map(t => t.name).filter(n => !n.startsWith('sqlite_'))

    const expected = [
      'acuity_levels', 'action_log', 'alert_rules', 'app_meta', 'case_log',
      'caseload_task_history', 'caseload_tasks', 'cell_formats', 'cell_history',
      'cells', 'checklist_items', 'checklist_templates', 'columns',
      'cond_format_rules', 'global_notes', 'grids',
      'letter_templates', 'provider_categories', 'provider_client_links',
      'provider_custom_fields', 'provider_custom_values', 'provider_interactions',
      'provider_tags', 'providers', 'row_tags', 'rows', 'saved_filters',
      'saved_views', 'scrap_notes', 'settings', 'setup_templates', 'snippets',
      'tags',
    ]
    for (const tbl of expected) {
      expect(names, `missing table: ${tbl}`).toContain(tbl)
    }
  })

  it('expected indexes exist from all migrations', () => {
    runAllMigrations()

    const indexes = t.db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[]
    const indexNames = indexes.map(i => i.name)

    // From migration 013
    expect(indexNames).toContain('idx_provider_tags_provider')
    expect(indexNames).toContain('idx_grids_active_pos')
    // idx_case_log_row_type was created in 013 but dropped+replaced in 018
    expect(indexNames).toContain('idx_case_log_row_type_v2')
    expect(indexNames).toContain('idx_provider_interactions_latest')

    // From migration 014
    expect(indexNames).toContain('idx_provider_client_links_row')

    // From migration 015
    expect(indexNames).toContain('idx_cells_row_col')

    // From migration 019
    expect(indexNames).toContain('idx_row_tags_row')

    // From migration 022
    expect(indexNames).toContain('idx_checklist_items_completed')

    // From migration 025
    expect(indexNames).toContain('idx_case_log_row_type_created')
    expect(indexNames).toContain('idx_checklist_items_row_completed')
  })

  it('FK constraints work: delete row -> cell_formats cascade', () => {
    runAllMigrations()

    // Create grid, column, row
    t.db.prepare("INSERT INTO grids (name, created_at, updated_at) VALUES ('Test', datetime('now'), datetime('now'))").run()
    const gridId = 1
    t.db.prepare("INSERT INTO columns (grid_id, name, column_type, position, is_name_column, created_at) VALUES (?, 'Name', 'text', 0, 1, datetime('now'))").run(gridId)
    const colId = 1
    t.db.prepare("INSERT INTO rows (grid_id, position, created_at, updated_at) VALUES (?, 0, datetime('now'), datetime('now'))").run(gridId)
    const rowId = 1

    // Add cell_format
    t.db.prepare("INSERT INTO cell_formats (row_id, column_id, rules) VALUES (?, ?, '[]')").run(rowId, colId)
    expect((t.db.prepare('SELECT COUNT(*) as c FROM cell_formats WHERE row_id = ?').get(rowId) as { c: number }).c).toBe(1)

    // Delete row -> cell_formats should cascade
    t.db.prepare('DELETE FROM rows WHERE id = ?').run(rowId)
    expect((t.db.prepare('SELECT COUNT(*) as c FROM cell_formats WHERE row_id = ?').get(rowId) as { c: number }).c).toBe(0)
  })

  it('FK constraints work: delete provider -> provider_client_links cascade', () => {
    runAllMigrations()

    // Create grid, row, category, provider
    t.db.prepare("INSERT INTO grids (name, created_at, updated_at) VALUES ('Test', datetime('now'), datetime('now'))").run()
    const gridId = 1
    t.db.prepare("INSERT INTO rows (grid_id, position, created_at, updated_at) VALUES (?, 0, datetime('now'), datetime('now'))").run(gridId)
    const rowId = 1
    t.db.prepare("INSERT INTO provider_categories (name, color) VALUES ('Medical', '#ef4444')").run()
    const catId = 1
    t.db.prepare("INSERT INTO providers (name, category_id, created_at, updated_at) VALUES ('Dr. Smith', ?, datetime('now'), datetime('now'))").run(catId)
    const providerId = 1

    // Link provider to client
    t.db.prepare("INSERT INTO provider_client_links (provider_id, row_id, grid_id) VALUES (?, ?, ?)").run(providerId, rowId, gridId)
    expect((t.db.prepare('SELECT COUNT(*) as c FROM provider_client_links WHERE provider_id = ?').get(providerId) as { c: number }).c).toBe(1)

    // Delete provider -> links should cascade
    t.db.prepare('DELETE FROM providers WHERE id = ?').run(providerId)
    expect((t.db.prepare('SELECT COUNT(*) as c FROM provider_client_links WHERE provider_id = ?').get(providerId) as { c: number }).c).toBe(0)
  })

  it('cond_format_rules has UNIQUE constraint on name', () => {
    runAllMigrations()

    t.db.prepare("INSERT INTO cond_format_rules (name, column_type, rules) VALUES ('overdue', 'date', '[]')").run()
    expect(() => {
      t.db.prepare("INSERT INTO cond_format_rules (name, column_type, rules) VALUES ('overdue', 'text', '[]')").run()
    }).toThrow()
  })

  it('rows table has display_name column from migration 017', () => {
    runAllMigrations()

    const cols = t.db.prepare("PRAGMA table_info('rows')").all() as { name: string }[]
    const colNames = cols.map(c => c.name)
    expect(colNames).toContain('display_name')
  })

  it('rows table has deleted_at column from migration 012', () => {
    runAllMigrations()

    const cols = t.db.prepare("PRAGMA table_info('rows')").all() as { name: string }[]
    const colNames = cols.map(c => c.name)
    expect(colNames).toContain('deleted_at')
  })

  it('case_log has voided_at column from migration 010', () => {
    runAllMigrations()

    const cols = t.db.prepare("PRAGMA table_info('case_log')").all() as { name: string }[]
    const colNames = cols.map(c => c.name)
    expect(colNames).toContain('voided_at')
    expect(colNames).toContain('voided_reason')
    expect(colNames).toContain('source_action_id')
  })

  it('case_log has voided_at column from migration 010', () => {
    runAllMigrations()

    const cols = t.db.prepare("PRAGMA table_info('case_log')").all() as { name: string }[]
    const colNames = cols.map(c => c.name)
    expect(colNames).toContain('voided_at')
    expect(colNames).toContain('voided_reason')
    expect(colNames).toContain('source_action_id')
  })

  it('acuity_levels table exists from migration 011', () => {
    runAllMigrations()

    const tables = t.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='acuity_levels'")
      .all() as { name: string }[]
    expect(tables).toHaveLength(1)
  })

  it('each migration increments schema_version correctly', () => {
    t.db.exec('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')

    for (const m of allMigrations) {
      m.up(t.db)
      const row = t.db.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get() as { value: string }
      expect(Number(row.value), `schema_version after migration ${m.version}`).toBe(m.version)
    }
  })
})
