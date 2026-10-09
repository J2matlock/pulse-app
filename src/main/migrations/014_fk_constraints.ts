import type { Database } from 'better-sqlite3'

export function up(db: Database): void {
  // Idempotent: skip if already at or past version 14
  const row = db.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get() as { value: string } | undefined
  if (row && parseInt(row.value, 10) >= 14) return

  // Helper: check if a table exists
  const tableExists = (name: string): boolean => {
    const t = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name)
    return t != null
  }

  // M1: Add FK constraints to cell_formats (row_id → rows, column_id → columns)
  // Only do the swap if the original table still exists (idempotency)
  if (tableExists('cell_formats') && !tableExists('cell_formats_new')) {
    db.exec(`
      CREATE TABLE cell_formats_new (
        row_id    INTEGER NOT NULL REFERENCES rows(id) ON DELETE CASCADE,
        column_id INTEGER NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
        rules     TEXT NOT NULL DEFAULT '[]',
        PRIMARY KEY (row_id, column_id)
      )
    `)
    // Check if source table has the expected schema (old version without FKs)
    const cfCols = db.prepare("PRAGMA table_info('cell_formats')").all() as Array<{ name: string }>
    if (cfCols.some(c => c.name === 'row_id')) {
      db.exec(`INSERT OR IGNORE INTO cell_formats_new SELECT * FROM cell_formats`)
    }
    db.exec(`DROP TABLE IF EXISTS cell_formats`)
    db.exec(`ALTER TABLE cell_formats_new RENAME TO cell_formats`)
  } else if (tableExists('cell_formats_new') && !tableExists('cell_formats')) {
    // Previous run created _new but crashed before rename — just rename
    db.exec(`ALTER TABLE cell_formats_new RENAME TO cell_formats`)
  }

  // M2: Add FK constraints to provider_client_links (row_id → rows, grid_id → grids)
  if (tableExists('provider_client_links') && !tableExists('provider_client_links_new')) {
    db.exec(`
      CREATE TABLE provider_client_links_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
        row_id INTEGER NOT NULL REFERENCES rows(id) ON DELETE CASCADE,
        grid_id INTEGER NOT NULL REFERENCES grids(id) ON DELETE CASCADE,
        linked_at TEXT NOT NULL DEFAULT (datetime('now')),
        notes TEXT,
        UNIQUE(provider_id, row_id)
      )
    `)
    db.exec(`INSERT OR IGNORE INTO provider_client_links_new SELECT * FROM provider_client_links`)
    db.exec(`DROP TABLE IF EXISTS provider_client_links`)
    db.exec(`ALTER TABLE provider_client_links_new RENAME TO provider_client_links`)
  } else if (tableExists('provider_client_links_new') && !tableExists('provider_client_links')) {
    db.exec(`ALTER TABLE provider_client_links_new RENAME TO provider_client_links`)
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_provider_client_links_row ON provider_client_links(row_id)`)

  // L8: Add UNIQUE constraint on cond_format_rules.name
  if (tableExists('cond_format_rules') && !tableExists('cond_format_rules_new')) {
    // Check if we need to migrate (old schema has column_type_hint; new has column_type)
    const crCols = db.prepare("PRAGMA table_info('cond_format_rules')").all() as Array<{ name: string }>
    const hasOldSchema = crCols.some(c => c.name === 'column_type_hint')

    if (hasOldSchema) {
      db.exec(`
        CREATE TABLE cond_format_rules_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          column_type TEXT NOT NULL DEFAULT 'text',
          rules TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `)
      // Deduplicate names before INSERT OR IGNORE to prevent silent data loss
      const existingRules = db.prepare('SELECT id, name FROM cond_format_rules ORDER BY id').all() as Array<{ id: number; name: string }>
      const nameCount = new Map<string, number>()
      const renames = new Map<number, string>()
      for (const rule of existingRules) {
        const count = nameCount.get(rule.name) ?? 0
        nameCount.set(rule.name, count + 1)
        if (count > 0) {
          renames.set(rule.id, `${rule.name} (${count})`)
        }
      }
      for (const [id, newName] of renames) {
        db.prepare('UPDATE cond_format_rules SET name = ? WHERE id = ?').run(newName, id)
      }
      db.exec(`INSERT OR IGNORE INTO cond_format_rules_new (id, name, column_type, rules, created_at)
        SELECT id, name, COALESCE(column_type_hint, 'text'), COALESCE(rule_json, '[]'), created_at
        FROM cond_format_rules`)
      db.exec(`DROP TABLE IF EXISTS cond_format_rules`)
      db.exec(`ALTER TABLE cond_format_rules_new RENAME TO cond_format_rules`)
    }
    // else: already has new schema, nothing to do
  } else if (tableExists('cond_format_rules_new') && !tableExists('cond_format_rules')) {
    db.exec(`ALTER TABLE cond_format_rules_new RENAME TO cond_format_rules`)
  }

  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '14')").run()
}
