import type { Database } from 'better-sqlite3'

export function up(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      is_collapsed INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)

  // ALTER TABLE doesn't support IF NOT EXISTS — guard manually
  const hasCol = db.prepare(
    "SELECT COUNT(*) as cnt FROM pragma_table_info('caseload_tasks') WHERE name = 'group_id'"
  ).get() as { cnt: number }
  if (!hasCol.cnt) {
    db.exec('ALTER TABLE caseload_tasks ADD COLUMN group_id INTEGER')
  }

  db.exec('CREATE INDEX IF NOT EXISTS idx_caseload_tasks_group ON caseload_tasks(group_id)')

  db.prepare("UPDATE app_meta SET value = '30' WHERE key = 'schema_version'").run()
}
