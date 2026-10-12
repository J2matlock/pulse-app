import type { Database } from 'better-sqlite3-multiple-ciphers'

/**
 * Optional time (minutes) and mileage (miles) on case notes, for roles that
 * report service units or claim mileage. Hidden unless turned on in Settings.
 */
export function up(db: Database): void {
  const cols = db.prepare("SELECT name FROM pragma_table_info('case_log')").all() as Array<{ name: string }>
  if (!cols.some(c => c.name === 'minutes')) db.exec('ALTER TABLE case_log ADD COLUMN minutes INTEGER DEFAULT NULL')
  if (!cols.some(c => c.name === 'miles')) db.exec('ALTER TABLE case_log ADD COLUMN miles REAL DEFAULT NULL')
  db.exec("CREATE INDEX IF NOT EXISTS idx_case_log_created ON case_log(created_at)")

  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '35')").run()
}
