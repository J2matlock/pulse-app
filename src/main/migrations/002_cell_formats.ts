import type { Database } from 'better-sqlite3'

export function up(db: Database): void {
  db.exec(`
    -- Per-cell conditional formatting rules (survive sorting/reordering because
    -- they reference row_id, not row position)
    CREATE TABLE IF NOT EXISTS cell_formats (
      row_id    INTEGER NOT NULL,
      column_id INTEGER NOT NULL,
      rules     TEXT NOT NULL DEFAULT '[]',
      PRIMARY KEY (row_id, column_id)
    );
  `)

  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '2')").run()
}
