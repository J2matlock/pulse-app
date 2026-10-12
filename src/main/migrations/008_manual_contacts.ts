import type { Database } from 'better-sqlite3-multiple-ciphers'

export function up(db: Database): void {
  // Add manual_contacts column to rows for storing contact info not in grid columns
  // Idempotency: skip if column already exists (e.g., re-running after restore)
  const cols = db.prepare("PRAGMA table_info('rows')").all() as Array<{ name: string }>
  if (!cols.some(c => c.name === 'manual_contacts')) {
    db.exec(`ALTER TABLE rows ADD COLUMN manual_contacts TEXT DEFAULT NULL`)
  }

  // Global notes table — keyed by a string scope (e.g. "tasks") for scratch pads not tied to a row
  db.exec(`
    CREATE TABLE IF NOT EXISTS global_notes (
      scope TEXT PRIMARY KEY,
      content TEXT DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  // Bump schema version
  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '8')").run()
}
