import type { Database } from 'better-sqlite3-multiple-ciphers'

/**
 * Forms (generalization W08 §2): a clean way to add or update a record, or
 * to print a blank to fill on paper. Fields refer to columns by id (a
 * renamed column stays on the form) and can log a note with the answers.
 */
export function up(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS forms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      grid_id INTEGER NOT NULL REFERENCES grids(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      intro TEXT,
      fields TEXT NOT NULL,
      log_activity_type TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_forms_grid ON forms(grid_id, position);
  `)

  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '41')").run()
}
