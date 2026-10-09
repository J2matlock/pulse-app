import type { Database } from 'better-sqlite3'

export function up(db: Database): void {
  // Add position column to grids for drag-to-reorder
  // Idempotency: skip if column already exists (e.g., re-running after restore)
  const cols = db.prepare("PRAGMA table_info('grids')").all() as Array<{ name: string }>
  if (!cols.some(c => c.name === 'position')) {
    db.exec(`ALTER TABLE grids ADD COLUMN position INTEGER DEFAULT 0`)
  }
  // Initialize position values from current id order
  const grids = db.prepare('SELECT id FROM grids WHERE is_active = 1 ORDER BY id').all() as { id: number }[]
  const update = db.prepare('UPDATE grids SET position = ? WHERE id = ?')
  const run = db.transaction(() => { grids.forEach((g, i) => update.run(i, g.id)) })
  run()
  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '5')").run()
}
