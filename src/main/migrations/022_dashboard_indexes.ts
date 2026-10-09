import type { Database } from 'better-sqlite3'

export function up(db: Database): void {
  // Speed up DASHBOARD_GET_COMPLETED: checklist items completed in last 30 days
  db.exec(`CREATE INDEX IF NOT EXISTS idx_checklist_items_completed
    ON checklist_items(is_completed, completed_at)`)

  // Speed up task history completion lookups
  db.exec(`CREATE INDEX IF NOT EXISTS idx_task_history_completed
    ON caseload_task_history(completed_at)`)

  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '22')").run()
}
