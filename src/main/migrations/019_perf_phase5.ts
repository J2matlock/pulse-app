import type { Database } from 'better-sqlite3'

export function up(db: Database): void {
  // ── 1. Index on row_tags(row_id) ────────────────────────────────────────────
  // TAG_GET_ROWS_FOR_GRID joins row_tags by row_id — full scan without this.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_row_tags_row ON row_tags(row_id)`)

  // ── 2. Index on saved_filters(grid_id) ──────────────────────────────────────
  // SAVED_FILTER_GET_ALL filters by grid_id.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_saved_filters_grid ON saved_filters(grid_id)`)

  // ── 3. Index on saved_views(grid_id) ────────────────────────────────────────
  // SAVED_VIEW_GET_ALL filters by grid_id.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_saved_views_grid ON saved_views(grid_id)`)

  // ── 4. Index on provider_client_links(provider_id) ──────────────────────────
  // getClientLinks filters by provider_id.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_provider_client_links_provider ON provider_client_links(provider_id)`)

  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '19')").run()
}
