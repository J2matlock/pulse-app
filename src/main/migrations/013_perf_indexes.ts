import type { Database } from 'better-sqlite3'

export function up(db: Database): void {
  // Index for provider tag search (contacts.ts getProviders with tag filter)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_provider_tags_provider ON provider_tags(provider_id, tag)`)

  // Index for grid listing query (WHERE is_active = 1 ORDER BY position)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_grids_active_pos ON grids(is_active, position)`)

  // Compound index for case_log filtered queries (WHERE row_id = ? AND log_type != 'system')
  db.exec(`CREATE INDEX IF NOT EXISTS idx_case_log_row_type ON case_log(row_id, log_type)`)

  // Index for provider interaction latest-date subquery (GROUP BY provider_id ORDER BY created_at DESC)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_provider_interactions_latest ON provider_interactions(provider_id, created_at DESC)`)

  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '13')").run()
}
