import type { Database } from 'better-sqlite3'

/**
 * Nothing is lost by moving or deleting (audit 2026-10, Decision D1).
 *
 * - parked_cells: when a record moves to a list without a matching column,
 *   the value (and its edit history) waits here, keyed to its old column,
 *   and comes back if the record moves back (items 1.11 / G-18 / L-11).
 * - deleted_columns: a deleted column's settings and every value in it, as
 *   JSON, restorable for 30 days (item 5.2).
 * - grids.deleted_at / deleted_snapshot: a deleted list waits in the Trash
 *   for 30 days with a copy of its links (item 5.2). Lists deleted before
 *   this version get their 30 days from now.
 */
export function up(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS parked_cells (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      row_id INTEGER NOT NULL REFERENCES rows(id) ON DELETE CASCADE,
      column_id INTEGER NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
      value TEXT,
      history TEXT,
      parked_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (row_id, column_id)
    );
    CREATE INDEX IF NOT EXISTS idx_parked_cells_row ON parked_cells(row_id);

    CREATE TABLE IF NOT EXISTS deleted_columns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      grid_id INTEGER NOT NULL REFERENCES grids(id) ON DELETE CASCADE,
      column_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      column_type TEXT NOT NULL,
      snapshot TEXT NOT NULL,
      deleted_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_deleted_columns_grid ON deleted_columns(grid_id);
  `)

  const gridCols = db.prepare("SELECT name FROM pragma_table_info('grids')").all() as { name: string }[]
  if (!gridCols.some(c => c.name === 'deleted_at')) {
    db.exec('ALTER TABLE grids ADD COLUMN deleted_at TEXT')
    db.exec("UPDATE grids SET deleted_at = datetime('now') WHERE is_active = 0")
  }
  if (!gridCols.some(c => c.name === 'deleted_snapshot')) {
    db.exec('ALTER TABLE grids ADD COLUMN deleted_snapshot TEXT')
  }

  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '45')").run()
}
