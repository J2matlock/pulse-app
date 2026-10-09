import type { Database } from 'better-sqlite3'

export function up(db: Database): void {
  // Partial index for follow-up dashboard queries.
  // Covers WHERE follow_up_date IS NOT NULL AND follow_up_completed = 0 AND voided_at IS NULL
  // plus ORDER BY follow_up_date ASC — avoids a full table scan of case_log.
  // Drop the basic index from migration 001 (follow_up_date only) and replace
  // with this partial covering index that filters on the common query pattern.
  db.exec(`DROP INDEX IF EXISTS idx_case_log_followup`)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_case_log_followup_v3
    ON case_log(follow_up_date)
    WHERE follow_up_date IS NOT NULL AND follow_up_completed = 0 AND voided_at IS NULL
  `)

  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '20')").run()
}
