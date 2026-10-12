import type { Database } from 'better-sqlite3-multiple-ciphers'

/**
 * "Done" for one-off dates (Decision E1, audit 5.3):
 * - deadline_done: a one-off date marked Finished keeps its date and gets a
 *   done flag, tied to the date it was finished for (a new date is a new
 *   deadline).
 * - Date columns with "from another date", "on fixed dates" or "a series of
 *   steps" rules hold the day it was done, not a due date; they become
 *   Deadline columns, which show "Due …" and "Done …". Rules counted from
 *   their own column ('self') keep their Date column.
 */
export function up(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS deadline_done (
      row_id INTEGER NOT NULL REFERENCES rows(id) ON DELETE CASCADE,
      column_id INTEGER NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
      done_for TEXT NOT NULL,
      done_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (row_id, column_id, done_for)
    );
  `)
  db.prepare(`
    UPDATE columns SET column_type = 'deadline'
    WHERE column_type = 'date' AND id IN (
      SELECT col.id FROM columns col
      JOIN alert_rules ar ON ar.id = CAST(json_extract(col.config, '$.alert_rule_id') AS INTEGER)
      WHERE json_valid(ar.rule_config) AND (
        ar.kind = 'calendar'
        OR (ar.kind IN ('relative', 'sequence') AND COALESCE(json_extract(ar.rule_config, '$.anchorColumnId'), 'self') != 'self')
      )
    )
  `).run()

  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '46')").run()
}
