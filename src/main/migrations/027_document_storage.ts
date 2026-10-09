/**
 * Migration 027: Add document storage columns for copy-on-link.
 *
 * Adds stored_path, original_name, and storage_mode to document_refs.
 * Legacy refs default to storage_mode='reference'.
 */

import type { Database } from 'better-sqlite3'

export function up(db: Database): void {
  // Guard: only add columns if they don't already exist (ALTER TABLE ADD COLUMN has no IF NOT EXISTS in SQLite)
  const cols = (db.prepare("PRAGMA table_info('document_refs')").all() as Array<{ name: string }>).map(c => c.name)

  if (!cols.includes('stored_path')) {
    db.exec(`ALTER TABLE document_refs ADD COLUMN stored_path TEXT`)
  }
  if (!cols.includes('original_name')) {
    db.exec(`ALTER TABLE document_refs ADD COLUMN original_name TEXT`)
  }
  if (!cols.includes('storage_mode')) {
    db.exec(`ALTER TABLE document_refs ADD COLUMN storage_mode TEXT NOT NULL DEFAULT 'reference'`)
  }

  db.prepare("UPDATE app_meta SET value = '27' WHERE key = 'schema_version'").run()
}
