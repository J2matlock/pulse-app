import type { Database } from 'better-sqlite3'

export function up(db: Database): void {
  // Add position column to caseload_tasks
  // Idempotency: skip if column already exists (e.g., re-running after restore)
  const cols = db.prepare("PRAGMA table_info('caseload_tasks')").all() as Array<{ name: string }>
  if (!cols.some(c => c.name === 'position')) {
    db.exec(`ALTER TABLE caseload_tasks ADD COLUMN position INTEGER NOT NULL DEFAULT 0`)
  }

  // Backfill existing rows with sequential positions (order by due_date, then created_at)
  const rows = db.prepare(
    `SELECT id FROM caseload_tasks ORDER BY due_date ASC NULLS LAST, created_at ASC`
  ).all() as Array<{ id: number }>

  const update = db.prepare('UPDATE caseload_tasks SET position = ? WHERE id = ?')
  for (let i = 0; i < rows.length; i++) {
    update.run(i, rows[i]!.id)
  }

  // Bump schema version
  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '7')").run()
}
