import type { Database } from 'better-sqlite3'

/**
 * Attachments (generalization W09 §3): files stored inside the encrypted
 * database, so they're as protected as everything else and travel with
 * backups. The bytes live in their own table so ordinary queries never read
 * them.
 */
export function up(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      row_id INTEGER REFERENCES rows(id) ON DELETE CASCADE,
      case_log_id INTEGER REFERENCES case_log(id) ON DELETE SET NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT
    );
    CREATE TABLE IF NOT EXISTS attachment_blobs (
      attachment_id INTEGER PRIMARY KEY REFERENCES attachments(id) ON DELETE CASCADE,
      data BLOB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_attachments_row ON attachments(row_id, deleted_at);
    CREATE INDEX IF NOT EXISTS idx_attachments_note ON attachments(case_log_id);
  `)

  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '42')").run()
}
