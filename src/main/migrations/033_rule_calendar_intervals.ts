import type { Database } from 'better-sqlite3-multiple-ciphers'

/**
 * Deadline rules can repeat by calendar months/years and can snap to the end
 * of the month. Existing rules keep their day-based interval unchanged.
 */
export function up(db: Database): void {
  const cols = db.prepare("SELECT name FROM pragma_table_info('alert_rules')").all() as Array<{ name: string }>
  if (!cols.some(c => c.name === 'interval_months')) {
    db.exec('ALTER TABLE alert_rules ADD COLUMN interval_months INTEGER DEFAULT NULL')
  }
  if (!cols.some(c => c.name === 'end_of_month')) {
    db.exec('ALTER TABLE alert_rules ADD COLUMN end_of_month INTEGER NOT NULL DEFAULT 0')
  }

  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '33')").run()
}
