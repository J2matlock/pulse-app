import type { Database } from 'better-sqlite3-multiple-ciphers'

export function up(db: Database): void {
  // ── 1. Compound index on case_log for filtered reads ────────────────────────
  // CASE_LOG_GET filters on (row_id, log_type != 'system', voided_at IS NULL)
  // and orders by (is_pinned DESC, created_at DESC). This index covers the
  // WHERE + ORDER BY path for the most common query pattern.
  // Drop the narrower index from migration 013 (row_id, log_type) and replace
  // with this wider covering index (row_id, log_type, is_pinned, created_at).
  db.exec(`DROP INDEX IF EXISTS idx_case_log_row_type`)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_case_log_row_type_v2
    ON case_log(row_id, log_type, is_pinned, created_at)
  `)

  // ── 2. Index for soft-delete trash purge ────────────────────────────────────
  // purgeExpiredTrash() scans rows WHERE deleted_at IS NOT NULL and < threshold.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_rows_deleted_at
    ON rows(deleted_at) WHERE deleted_at IS NOT NULL
  `)

  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '18')").run()
}
