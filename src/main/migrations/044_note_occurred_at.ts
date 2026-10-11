import type { Database } from 'better-sqlite3'

/**
 * Notes dated by when they happened (audit plan 1.22, 1.23; owner decision B1).
 *
 * - case_log.occurred_at: when the visit or call happened. created_at stays
 *   the moment it was written (the audit time). Requirements, quotas, reports
 *   and dates that follow notes count by occurred_at. Existing notes happened
 *   when they were written. A trigger fills it for any insert that doesn't
 *   name it (Pulse's own entries, imports, older code paths).
 * - case_log_edits.occurred_at: the date a note had before an edit, so a
 *   corrected date keeps its history like corrected text does.
 * - note_date_moves: which dates each note moved ("Last Visit" ← Visit), so
 *   voiding or deleting the note can put them back.
 */
export function up(db: Database): void {
  const logCols = db.prepare("SELECT name FROM pragma_table_info('case_log')").all() as Array<{ name: string }>
  if (!logCols.some(c => c.name === 'occurred_at')) db.exec('ALTER TABLE case_log ADD COLUMN occurred_at TEXT DEFAULT NULL')
  db.exec('UPDATE case_log SET occurred_at = created_at WHERE occurred_at IS NULL')
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS case_log_occurred_default AFTER INSERT ON case_log
    WHEN NEW.occurred_at IS NULL
    BEGIN
      UPDATE case_log SET occurred_at = NEW.created_at WHERE id = NEW.id;
    END
  `)
  db.exec('CREATE INDEX IF NOT EXISTS idx_case_log_occurred ON case_log(occurred_at)')

  const editCols = db.prepare("SELECT name FROM pragma_table_info('case_log_edits')").all() as Array<{ name: string }>
  if (!editCols.some(c => c.name === 'occurred_at')) db.exec('ALTER TABLE case_log_edits ADD COLUMN occurred_at TEXT DEFAULT NULL')

  db.exec(`
    CREATE TABLE IF NOT EXISTS note_date_moves (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_log_id INTEGER NOT NULL REFERENCES case_log(id) ON DELETE CASCADE,
      row_id INTEGER NOT NULL REFERENCES rows(id) ON DELETE CASCADE,
      column_id INTEGER NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
      old_value TEXT,
      new_value TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_note_date_moves_note ON note_date_moves(case_log_id);
    CREATE INDEX IF NOT EXISTS idx_note_date_moves_cell ON note_date_moves(row_id, column_id);
  `)

  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '44')").run()
}
