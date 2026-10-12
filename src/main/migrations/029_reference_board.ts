/**
 * Migration 029: Reference Board — categories and items tables.
 */

import type { Database } from 'better-sqlite3-multiple-ciphers'

export function up(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS reference_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT 'folder',
      color TEXT NOT NULL DEFAULT '#6b7280',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS reference_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER REFERENCES reference_categories(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      item_type TEXT NOT NULL CHECK(item_type IN ('text', 'image', 'pdf', 'link')),
      content TEXT,
      stored_filename TEXT,
      original_filename TEXT,
      file_size INTEGER,
      description TEXT,
      tags TEXT,
      is_pinned INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  db.exec(`CREATE INDEX IF NOT EXISTS idx_ref_items_category ON reference_items(category_id)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ref_items_type ON reference_items(item_type)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ref_items_pinned ON reference_items(is_pinned)`)

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_ref_items_updated_at
      AFTER UPDATE ON reference_items
      FOR EACH ROW
      BEGIN
        UPDATE reference_items SET updated_at = datetime('now') WHERE id = OLD.id;
      END
  `)

  db.prepare("UPDATE app_meta SET value = '29' WHERE key = 'schema_version'").run()
}
