import type { Database } from 'better-sqlite3-multiple-ciphers'

export function up(db: Database): void {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_case_log_system_created
    ON case_log(created_at DESC)
    WHERE log_type = 'system'
  `)
  db.prepare("INSERT OR REPLACE INTO app_meta(key, value) VALUES('schema_version', '26')").run()
}
