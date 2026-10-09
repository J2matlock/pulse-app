import type { Database } from 'better-sqlite3'

export function up(db: Database): void {
  // Idempotent: check if column already exists before adding
  const cols = db.prepare("PRAGMA table_info('rows')").all() as Array<{ name: string }>
  if (!cols.some(c => c.name === 'deleted_at')) {
    db.exec(`ALTER TABLE rows ADD COLUMN deleted_at TEXT DEFAULT NULL`)
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_rows_deleted ON rows(grid_id, deleted_at)`)
  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '12')").run()
}
