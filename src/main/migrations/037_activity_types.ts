import type { Database } from 'better-sqlite3'

/**
 * Activity types, custom measures and requirement periods (generalization W03).
 *
 * - Note types move from a fixed list in code to a table people can edit.
 *   The five built-in types are seeded with today's labels, so every
 *   existing note stays valid. Keys never change; labels can.
 * - Notes get room for custom numbers (labor hours, parts cost…).
 * - Requirements get a period; existing ones stay monthly.
 */

// Same keys, labels and emoji the app showed before this migration
const DEFAULT_TYPES: Array<[key: string, label: string, icon: string, color: string]> = [
  ['note', 'Note', '📝', 'slate'],
  ['phone', 'Phone', '📞', 'blue'],
  ['meeting', 'Meeting', '🤝', 'green'],
  ['email', 'Email', '✉️', 'purple'],
  ['visit', 'Visit', '🏠', 'orange'],
]

// Written by Pulse itself; never in the table (see src/shared/activityTypes.ts)
const SYSTEM_TYPES = ['system', 'manual', 'import', 'followup']

export function up(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS activity_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      icon TEXT,
      color TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      is_archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  const insert = db.prepare('INSERT OR IGNORE INTO activity_types (key, label, icon, color, position) VALUES (?, ?, ?, ?, ?)')
  DEFAULT_TYPES.forEach(([key, label, icon, color], i) => insert.run(key, label, icon, color, i))

  // Defensive: any other key already on a note becomes an archived type, so it keeps a label
  const known = new Set([...DEFAULT_TYPES.map(t => t[0]), ...SYSTEM_TYPES])
  const used = db.prepare('SELECT DISTINCT log_type FROM case_log WHERE log_type IS NOT NULL').all() as Array<{ log_type: string }>
  const insertArchived = db.prepare('INSERT OR IGNORE INTO activity_types (key, label, position, is_archived) VALUES (?, ?, ?, 1)')
  let position = DEFAULT_TYPES.length
  for (const { log_type } of used) {
    if (known.has(log_type)) continue
    const label = log_type.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()).slice(0, 40) || 'Other'
    insertArchived.run(log_type, label, position++)
  }

  const logCols = db.prepare("SELECT name FROM pragma_table_info('case_log')").all() as Array<{ name: string }>
  if (!logCols.some(c => c.name === 'extra_measures')) db.exec('ALTER TABLE case_log ADD COLUMN extra_measures TEXT DEFAULT NULL')

  const reqCols = db.prepare("SELECT name FROM pragma_table_info('contact_requirements')").all() as Array<{ name: string }>
  if (!reqCols.some(c => c.name === 'period')) db.exec("ALTER TABLE contact_requirements ADD COLUMN period TEXT NOT NULL DEFAULT 'month'")

  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '37')").run()
}
