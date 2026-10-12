import type { Database } from 'better-sqlite3-multiple-ciphers'

export function up(db: Database): void {
  // reference_items references reference_categories
  db.exec(`DROP TABLE IF EXISTS reference_items`)
  db.exec(`DROP TABLE IF EXISTS reference_categories`)
  // document_refs references rows (CASCADE was on rows→refs, but dropping the dependent table is safe)
  db.exec(`DROP TABLE IF EXISTS document_refs`)
  db.prepare("UPDATE app_meta SET value = '31' WHERE key = 'schema_version'").run()
}
