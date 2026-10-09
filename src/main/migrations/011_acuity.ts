import type { Database } from 'better-sqlite3'

export function up(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS acuity_levels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      grid_id INTEGER NOT NULL REFERENCES grids(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      abbreviation TEXT NOT NULL,
      points INTEGER NOT NULL DEFAULT 1,
      color TEXT DEFAULT '#6b7280',
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_acuity_levels_grid ON acuity_levels(grid_id)`)

  // Idempotency: skip columns that already exist (e.g., re-running after restore)
  const gridCols = db.prepare("PRAGMA table_info('grids')").all() as Array<{ name: string }>
  if (!gridCols.some(c => c.name === 'acuity_enabled')) {
    db.exec(`ALTER TABLE grids ADD COLUMN acuity_enabled INTEGER DEFAULT 0`)
  }
  const rowCols = db.prepare("PRAGMA table_info('rows')").all() as Array<{ name: string }>
  if (!rowCols.some(c => c.name === 'acuity_level_id')) {
    db.exec(`ALTER TABLE rows ADD COLUMN acuity_level_id INTEGER DEFAULT NULL`)
  }

  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '11')").run()
}
