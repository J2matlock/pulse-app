import type { Database } from 'better-sqlite3-multiple-ciphers'

/**
 * Keep every earlier version of an edited case note (records integrity).
 * Before this, only the very first version (case_log.original_content) and
 * the current text survived; intermediate edits were lost.
 */
export function up(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS case_log_edits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_log_id INTEGER NOT NULL REFERENCES case_log(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      replaced_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_case_log_edits_entry ON case_log_edits(case_log_id, replaced_at);
  `)

  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '32')").run()
}
