import type { Database } from 'better-sqlite3-multiple-ciphers'

export function up(db: Database): void {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_case_log_row_type_created
      ON case_log(row_id, log_type, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_checklist_items_row_completed
      ON checklist_items(row_id, is_completed);
  `)
  db.prepare("INSERT OR REPLACE INTO app_meta(key, value) VALUES('schema_version', '25')").run()
}
