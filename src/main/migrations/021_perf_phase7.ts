import type { Database } from 'better-sqlite3-multiple-ciphers'

export function up(db: Database): void {
  // Partial index for CHECKLIST_GET_URGENT — avoids full table scan of checklist_items.
  // Only indexes urgent, incomplete, non-archived items (the exact WHERE filter).
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_checklist_urgent
    ON checklist_items(priority, is_completed, is_archived)
    WHERE priority = 'urgent' AND is_completed = 0 AND is_archived = 0
  `)

  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '21')").run()
}
