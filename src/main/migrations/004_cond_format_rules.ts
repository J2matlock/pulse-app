import type { Database } from 'better-sqlite3'

export function up(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cond_format_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      column_type_hint TEXT,
      rule_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '4')").run()
}
