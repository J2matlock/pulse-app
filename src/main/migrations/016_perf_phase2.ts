import type { Database } from 'better-sqlite3-multiple-ciphers'

export function up(db: Database): void {
  // NOTE: This migration runs with noTransaction=true because VACUUM cannot run
  // inside a transaction. If it fails partway through, the index creation is
  // idempotent (IF NOT EXISTS) and the VACUUM is safe to retry.

  // Compound index covering buildGridQuery: WHERE grid_id=? AND is_active=1 AND deleted_at IS NULL ORDER BY position
  db.exec(`CREATE INDEX IF NOT EXISTS idx_rows_grid_active_del_pos
    ON rows(grid_id, is_active, deleted_at, position)`)

  // Enable incremental auto-vacuum so freed pages are reclaimed without full VACUUM.
  // auto_vacuum mode can only change on an empty DB or after a full VACUUM.
  // For existing databases this VACUUM is a one-time cost (~1-2s for typical caseload DBs).
  const currentMode = db.pragma('auto_vacuum') as Array<{ auto_vacuum: number }>
  if (currentMode[0]?.auto_vacuum !== 2) {
    db.pragma('auto_vacuum = INCREMENTAL')
    db.exec('VACUUM')
  }

  // Reclaim up to 100 free pages
  db.pragma('incremental_vacuum(100)')

  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '16')").run()
}
