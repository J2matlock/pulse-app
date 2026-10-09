import type { Database } from 'better-sqlite3'
import { HUMAN_SERVICES_VOCAB } from '../../shared/vocab'
import { featuresForExistingInstall } from '../../shared/features'

/**
 * Workspace words and feature switches (generalization W01).
 *
 * Lists get a kind (people/things/jobs), their own optional words and a
 * display format. Installs that already have lists are frozen on today's
 * words and features so nothing changes for them; a brand-new database gets
 * nothing here and falls back to the generic defaults.
 */
export function up(db: Database): void {
  const cols = db.prepare("SELECT name FROM pragma_table_info('grids')").all() as Array<{ name: string }>
  if (!cols.some(c => c.name === 'record_kind')) db.exec("ALTER TABLE grids ADD COLUMN record_kind TEXT NOT NULL DEFAULT 'person'")
  if (!cols.some(c => c.name === 'vocab')) db.exec('ALTER TABLE grids ADD COLUMN vocab TEXT DEFAULT NULL')
  if (!cols.some(c => c.name === 'display_format')) db.exec('ALTER TABLE grids ADD COLUMN display_format TEXT DEFAULT NULL')

  const hasGrids = !!db.prepare('SELECT 1 FROM grids LIMIT 1').get()
  if (hasGrids) {
    const setting = (key: string) =>
      (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value
    const features = featuresForExistingInstall({
      trackTime: setting('track_time') === 'true',
      trackMileage: setting('track_mileage') === 'true',
    })
    const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)')
    insert.run('workspace_vocab', JSON.stringify(HUMAN_SERVICES_VOCAB))
    insert.run('workspace_features', JSON.stringify(features))
  }

  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '36')").run()
}
