import type { Database } from 'better-sqlite3-multiple-ciphers'

/**
 * Monthly contact requirements per caseload, e.g. "1 face-to-face (Visit
 * notes) and 1 phone contact per calendar month". Counted from case notes.
 */
export function up(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS contact_requirements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      grid_id INTEGER NOT NULL REFERENCES grids(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      note_types TEXT NOT NULL DEFAULT '[]',
      per_month INTEGER NOT NULL DEFAULT 1,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_contact_requirements_grid ON contact_requirements(grid_id);
  `)

  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '34')").run()
}
