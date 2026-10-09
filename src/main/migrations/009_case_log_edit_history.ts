import type { Database } from 'better-sqlite3'

export function up(db: Database): void {
  // Track original content when a case log entry is edited, so the activity
  // timeline can show a diff instead of silently mutating the original entry.
  // Idempotency: skip columns that already exist (e.g., re-running after restore)
  const cols = db.prepare("PRAGMA table_info('case_log')").all() as Array<{ name: string }>
  if (!cols.some(c => c.name === 'original_content')) {
    db.exec(`ALTER TABLE case_log ADD COLUMN original_content TEXT DEFAULT NULL`)
  }
  if (!cols.some(c => c.name === 'edited_at')) {
    db.exec(`ALTER TABLE case_log ADD COLUMN edited_at TEXT DEFAULT NULL`)
  }

  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '9')").run()
}
