import type { Database } from 'better-sqlite3-multiple-ciphers'

export function up(db: Database): void {
  // Compound index for cell lookups by (row_id, column_id) — covers pivot joins,
  // cell format queries, and upsert conflict checks
  db.exec(`CREATE INDEX IF NOT EXISTS idx_cells_row_col ON cells(row_id, column_id)`)

  // Compound index for cell_history queries (CELL_GET_HISTORY: WHERE row_id=? AND column_id=? ORDER BY changed_at DESC)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_cell_history_row_col ON cell_history(row_id, column_id, changed_at DESC)`)

  // Compound index for archived dashboard query (WHERE is_active=0 AND archived_at IS NOT NULL ORDER BY archived_at DESC)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_rows_archived ON rows(is_active, archived_at DESC)`)

  // cell_formats already has UNIQUE(row_id, column_id) which serves as an implicit index,
  // but adding an explicit covering index ensures optimal lookup direction
  db.exec(`CREATE INDEX IF NOT EXISTS idx_cell_formats_row_col ON cell_formats(row_id, column_id)`)

  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '15')").run()
}
