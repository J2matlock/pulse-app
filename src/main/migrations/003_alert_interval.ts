import type { Database } from 'better-sqlite3-multiple-ciphers'

export function up(db: Database): void {
  // Rename cycle_days → interval_days for semantic clarity:
  // interval_days = days to add to the stored cell date to get the effective deadline.
  // 0 (or NULL) means the stored date IS the deadline.
  // Idempotency: skip if column was already renamed (e.g., re-running after restore)
  const cols = db.prepare("PRAGMA table_info('alert_rules')").all() as Array<{ name: string }>
  if (cols.some(c => c.name === 'cycle_days') && !cols.some(c => c.name === 'interval_days')) {
    db.exec(`ALTER TABLE alert_rules RENAME COLUMN cycle_days TO interval_days;`)
  }

  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '3')").run()
}
