import type { Database } from 'better-sqlite3'

/**
 * Deadline engine v2 (generalization W05 §4).
 *
 * - Rules get a kind (interval stays the default, so every existing rule
 *   behaves as before), kind-specific settings, an optional "only when"
 *   condition, and a business-days switch.
 * - Extensions: a new due date with a reason, tied to the date it extends
 *   (a new date starts a new cycle and the extension stops applying).
 * - Progress: which steps of a sequence rule are done.
 */
export function up(db: Database): void {
  const cols = db.prepare("SELECT name FROM pragma_table_info('alert_rules')").all() as Array<{ name: string }>
  const has = (n: string) => cols.some(c => c.name === n)
  if (!has('kind')) db.exec("ALTER TABLE alert_rules ADD COLUMN kind TEXT NOT NULL DEFAULT 'interval'")
  if (!has('rule_config')) db.exec('ALTER TABLE alert_rules ADD COLUMN rule_config TEXT DEFAULT NULL')
  if (!has('rule_condition')) db.exec('ALTER TABLE alert_rules ADD COLUMN rule_condition TEXT DEFAULT NULL')
  if (!has('business_days')) db.exec('ALTER TABLE alert_rules ADD COLUMN business_days INTEGER NOT NULL DEFAULT 0')

  db.exec(`
    CREATE TABLE IF NOT EXISTS deadline_extensions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      row_id INTEGER NOT NULL REFERENCES rows(id) ON DELETE CASCADE,
      column_id INTEGER NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
      step INTEGER,
      original_due TEXT NOT NULL,
      new_due TEXT NOT NULL,
      reason TEXT NOT NULL,
      anchor_value TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      revoked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_deadline_extensions_cell ON deadline_extensions(row_id, column_id);

    CREATE TABLE IF NOT EXISTS deadline_progress (
      row_id INTEGER NOT NULL REFERENCES rows(id) ON DELETE CASCADE,
      column_id INTEGER NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
      step INTEGER NOT NULL,
      done_at TEXT NOT NULL,
      anchor_value TEXT,
      PRIMARY KEY (row_id, column_id, step)
    );
  `)

  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '38')").run()
}
