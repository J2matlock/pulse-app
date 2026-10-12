import type { Database } from 'better-sqlite3-multiple-ciphers'

/** Saved reports (generalization W10 §6.1): a name, the list and the builder's settings as JSON. */
export function up(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS report_definitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      grid_id INTEGER NOT NULL REFERENCES grids(id) ON DELETE CASCADE,
      config TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_report_definitions_grid ON report_definitions(grid_id);
  `)

  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '43')").run()
}
