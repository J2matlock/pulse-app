/**
 * How Pulse tells an untouched sample entry from one the user has made their
 * own. Shared by sample-data.ts and migration 047, so it imports nothing.
 *
 * Each sample row keeps a fingerprint of its cells as loaded, plus the highest
 * id in each table that can hang off a record at that moment. Anything newer on
 * the row (a note, a file, an appointment, a link…) was added by the user.
 */
import type { Database } from 'better-sqlite3'

/** Cells (non-empty, by column) plus the row's own fields a person can change */
const FINGERPRINT_SQL = `SELECT
  COALESCE((SELECT group_concat(column_id || ':' || value, char(30)) FROM (
    SELECT column_id, value FROM cells WHERE row_id = r.id AND value IS NOT NULL AND value != '' ORDER BY column_id)), '')
  || char(29) || COALESCE(r.acuity_level_id, '') || char(29) || COALESCE(r.manual_contacts, '') AS fp
FROM rows r WHERE r.id = ?`

export function sampleFingerprint(db: Database, rowId: number): string {
  return (db.prepare(FINGERPRINT_SQL).get(rowId) as { fp: string } | undefined)?.fp ?? ''
}

/**
 * Whether a sample row's cells still read as they did when it was loaded. Pairs
 * for columns that have since been deleted are left out of the comparison, so
 * removing a column from the list doesn't make every entry look edited.
 */
export function sampleFingerprintMatches(db: Database, rowId: number, stored: string): boolean {
  const now = sampleFingerprint(db, rowId)
  if (now === stored) return true
  const [cells = '', ...rest] = stored.split('\u001d')
  const pairs = cells === '' ? [] : cells.split('\u001e')
  const ids = [...new Set(pairs.map(p => Number(p.slice(0, p.indexOf(':')))))].filter(Number.isInteger)
  if (ids.length === 0) return false
  const exists = db.prepare('SELECT 1 FROM columns WHERE id = ?')
  const live = new Set(ids.filter(id => exists.get(id)))
  if (live.size === ids.length) return false
  const kept = pairs.filter(p => live.has(Number(p.slice(0, p.indexOf(':')))))
  return now === [kept.join('\u001e'), ...rest].join('\u001d')
}

/**
 * Run a change to a whole list (deleting, restoring or retyping a column,
 * renaming a choice) without it counting as an edit to its sample entries:
 * entries untouched before the change are re-fingerprinted after it.
 */
export function keepSamplesUntouched<T>(db: Database, gridId: number, change: () => T): T {
  const tracked = db.prepare('SELECT row_id, fingerprint FROM sample_rows WHERE grid_id = ?').all(gridId) as Array<{ row_id: number; fingerprint: string }>
  const untouched = tracked.filter(r => sampleFingerprintMatches(db, r.row_id, r.fingerprint)).map(r => r.row_id)
  const result = change()
  const update = db.prepare('UPDATE sample_rows SET fingerprint = ? WHERE row_id = ?')
  for (const id of untouched) update.run(sampleFingerprint(db, id), id)
  return result
}

export interface SampleMarks {
  log: number; file: number; appt: number; series: number; item: number; link: number; contact: number
}

/** The highest id in each table right now; rows added after this are the user's */
export function currentSampleMarks(db: Database): SampleMarks {
  const max = (table: string) => (db.prepare(`SELECT COALESCE(MAX(id), 0) AS n FROM ${table}`).get() as { n: number }).n
  return {
    log: max('case_log'), file: max('attachments'), appt: max('appointments'), series: max('appointment_series'),
    item: max('checklist_items'), link: max('record_links'), contact: max('provider_client_links'),
  }
}

export function parseSampleMarks(json: string | null): SampleMarks {
  const zero: SampleMarks = { log: 0, file: 0, appt: 0, series: 0, item: 0, link: 0, contact: 0 }
  try { return { ...zero, ...(JSON.parse(json || '{}') as Partial<SampleMarks>) } } catch { return zero }
}

/** Start tracking rows as sample data (call once they're fully loaded) */
export function trackSampleRows(db: Database, rowIds: number[]): void {
  if (rowIds.length === 0) return
  const marks = JSON.stringify(currentSampleMarks(db))
  const gridOf = db.prepare('SELECT grid_id FROM rows WHERE id = ?')
  const ins = db.prepare('INSERT OR REPLACE INTO sample_rows (row_id, grid_id, fingerprint, marks, asked) VALUES (?, ?, ?, ?, 0)')
  for (const id of rowIds) {
    const g = gridOf.get(id) as { grid_id: number } | undefined
    if (g) ins.run(id, g.grid_id, sampleFingerprint(db, id), marks)
  }
}

/**
 * Whether the user has added something to this sample row since it was loaded:
 * a note (or edited a made-up one), a file, an appointment, a checklist item,
 * a link to another record, a linked contact or scratch-pad text.
 */
export function sampleRowHasUserAdditions(db: Database, rowId: number, m: SampleMarks): boolean {
  const any = (sql: string, ...args: unknown[]) => !!db.prepare(sql).get(...args)
  return any("SELECT 1 FROM case_log WHERE row_id = ? AND ((id > ? AND log_type != 'system') OR edited_at IS NOT NULL) LIMIT 1", rowId, m.log)
    || any('SELECT 1 FROM attachments WHERE row_id = ? AND id > ? LIMIT 1', rowId, m.file)
    // Weekly sample series keep adding occurrences; only appointments outside them count
    || any('SELECT 1 FROM appointments WHERE row_id = ? AND id > ? AND (series_id IS NULL OR series_id > ?) LIMIT 1', rowId, m.appt, m.series)
    || any('SELECT 1 FROM checklist_items WHERE row_id = ? AND id > ? LIMIT 1', rowId, m.item)
    || any('SELECT 1 FROM record_links WHERE (from_row_id = ? OR to_row_id = ?) AND id > ? LIMIT 1', rowId, rowId, m.link)
    || any('SELECT 1 FROM provider_client_links WHERE row_id = ? AND id > ? LIMIT 1', rowId, m.contact)
    || any("SELECT 1 FROM scrap_notes WHERE row_id = ? AND trim(COALESCE(content, '')) NOT IN ('', '<p></p>') LIMIT 1", rowId)
}
