/**
 * Migration 028: Checklist groups — groupable sections within a client's checklist.
 */

import type { Database } from 'better-sqlite3-multiple-ciphers'

export function up(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS checklist_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      row_id INTEGER NOT NULL REFERENCES rows(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      is_collapsed INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_checklist_groups_row ON checklist_groups(row_id)`)

  // Guard: only add group_id column if it doesn't already exist
  const cols = (db.prepare("PRAGMA table_info('checklist_items')").all() as Array<{ name: string }>).map(c => c.name)
  if (!cols.includes('group_id')) {
    db.exec(`ALTER TABLE checklist_items ADD COLUMN group_id INTEGER`)
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_checklist_items_group ON checklist_items(group_id)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_checklist_items_row_group ON checklist_items(row_id, group_id)`)

  db.prepare("UPDATE app_meta SET value = '28' WHERE key = 'schema_version'").run()
}
