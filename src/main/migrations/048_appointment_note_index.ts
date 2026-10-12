import type { Database } from 'better-sqlite3-multiple-ciphers'

/**
 * Migration 048: index appointments.case_log_id.
 *
 * The column is a foreign key with ON DELETE SET NULL, so every deleted note
 * looked for appointments pointing at it with a full table scan. Emptying the
 * trash or purging a list deletes thousands of notes at once (audit AUDIT-103).
 */
export function up(db: Database): void {
  db.exec('CREATE INDEX IF NOT EXISTS idx_appt_case_log ON appointments(case_log_id) WHERE case_log_id IS NOT NULL')

  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '48')").run()
}
