import type { Database } from 'better-sqlite3'

export function up(db: Database): void {
  // Support soft-voiding of auto-generated and user-created case log entries.
  // Voided entries are hidden from normal views but preserved for audit trail.
  // source_action_id links a system log entry back to the undo action that created it.
  // Idempotency: skip columns that already exist (e.g., re-running after restore)
  const cols = db.prepare("PRAGMA table_info('case_log')").all() as Array<{ name: string }>
  if (!cols.some(c => c.name === 'voided_at')) {
    db.exec(`ALTER TABLE case_log ADD COLUMN voided_at TEXT DEFAULT NULL`)
  }
  if (!cols.some(c => c.name === 'voided_reason')) {
    db.exec(`ALTER TABLE case_log ADD COLUMN voided_reason TEXT DEFAULT NULL`)
  }
  if (!cols.some(c => c.name === 'source_action_id')) {
    db.exec(`ALTER TABLE case_log ADD COLUMN source_action_id TEXT DEFAULT NULL`)
  }

  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '10')").run()
}
