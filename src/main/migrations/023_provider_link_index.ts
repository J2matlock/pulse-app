import type { Database } from 'better-sqlite3'

export function up(db: Database): void {
  // This index already exists from migration 019 — this is a no-op kept for
  // schema_version bookkeeping only.
  // db.exec(`CREATE INDEX IF NOT EXISTS idx_provider_client_links_provider
  //   ON provider_client_links(provider_id)`)

  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '23')").run()
}
