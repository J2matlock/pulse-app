import type { Database } from 'better-sqlite3'

/**
 * Linked records (generalization W04 §3).
 *
 * - Link types: a named relationship between two lists ("Owner" / "Vehicles").
 * - Record links: one connection between two records of a type.
 * - Link history: every add and remove, kept after either record is purged,
 *   so the audit trail is complete even when change notes are off.
 */
export function up(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS link_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_grid_id INTEGER NOT NULL REFERENCES grids(id) ON DELETE CASCADE,
      to_grid_id INTEGER NOT NULL REFERENCES grids(id) ON DELETE CASCADE,
      label_forward TEXT NOT NULL,
      label_backward TEXT NOT NULL,
      cardinality TEXT NOT NULL DEFAULT 'many_to_one' CHECK (cardinality IN ('one_to_one', 'many_to_one', 'many_to_many')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_link_types_from ON link_types(from_grid_id);
    CREATE INDEX IF NOT EXISTS idx_link_types_to ON link_types(to_grid_id);

    CREATE TABLE IF NOT EXISTS record_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      link_type_id INTEGER NOT NULL REFERENCES link_types(id) ON DELETE CASCADE,
      from_row_id INTEGER NOT NULL REFERENCES rows(id) ON DELETE CASCADE,
      to_row_id INTEGER NOT NULL REFERENCES rows(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (link_type_id, from_row_id, to_row_id)
    );
    CREATE INDEX IF NOT EXISTS idx_record_links_from ON record_links(link_type_id, from_row_id);
    CREATE INDEX IF NOT EXISTS idx_record_links_to ON record_links(link_type_id, to_row_id);

    CREATE TABLE IF NOT EXISTS record_link_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      link_type_id INTEGER NOT NULL,
      from_row_id INTEGER NOT NULL,
      to_row_id INTEGER NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('add', 'remove')),
      at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_record_link_history_from ON record_link_history(from_row_id);
    CREATE INDEX IF NOT EXISTS idx_record_link_history_to ON record_link_history(to_row_id);
  `)

  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '39')").run()
}
