import type { Database } from 'better-sqlite3-multiple-ciphers'
import { trackSampleRows } from '../sample-marks'

/**
 * Sample entries are tracked one by one (audit 1.3 / 2.6), so "Remove sample
 * data" can keep anything the user changed or added to, and the list can mark
 * sample entries. Before this, the sample list was removed whole and starter
 * samples were a list of ids in app_meta.
 *
 * asked: 0 = not asked yet, 1 = the user said it's just a sample (removable
 * even if edited), 2 = asked and dismissed (edits keep it).
 */
export function up(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sample_rows (
      row_id INTEGER PRIMARY KEY REFERENCES rows(id) ON DELETE CASCADE,
      grid_id INTEGER NOT NULL,
      fingerprint TEXT NOT NULL,
      marks TEXT NOT NULL DEFAULT '{}',
      asked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)

  // Existing sample data: we can't know what it looked like when loaded, so a
  // row with anything changed or added since then (2-minute grace) is the
  // user's own and stays untracked; the rest is tracked from how it is now.
  const meta = (key: string) => (db.prepare('SELECT value FROM app_meta WHERE key = ?').get(key) as { value: string } | undefined)?.value
  const json = <T,>(s: string | undefined): T | null => { try { return s ? JSON.parse(s) as T : null } catch { return null } }
  const candidates: Array<{ id: number; loadedAt: string }> = []

  const caseload = json<{ gridId?: number }>(meta('sample_data'))
  if (caseload?.gridId) {
    const grid = db.prepare('SELECT created_at FROM grids WHERE id = ?').get(caseload.gridId) as { created_at: string } | undefined
    if (grid) {
      const ids = db.prepare('SELECT id FROM rows WHERE grid_id = ? AND abs(julianday(created_at) - julianday(?)) * 86400 <= 120')
        .all(caseload.gridId, grid.created_at) as Array<{ id: number }>
      for (const r of ids) candidates.push({ id: r.id, loadedAt: grid.created_at })
    }
  }

  const starter = json<{ rowIds?: unknown }>(meta('starter_sample'))
  const starterIds = Array.isArray(starter?.rowIds) ? starter.rowIds.filter((x): x is number => typeof x === 'number') : []
  if (starterIds.length) {
    // Loaded when its cells were first written: the earliest cell time in each list
    const rows = db.prepare(`SELECT r.id, r.grid_id, (SELECT MIN(c.updated_at) FROM cells c WHERE c.row_id = r.id) AS t
      FROM rows r WHERE r.id IN (SELECT value FROM json_each(?))`).all(JSON.stringify(starterIds)) as Array<{ id: number; grid_id: number; t: string | null }>
    const firstByGrid = new Map<number, string>()
    for (const r of rows) if (r.t && (!firstByGrid.has(r.grid_id) || r.t < firstByGrid.get(r.grid_id)!)) firstByGrid.set(r.grid_id, r.t)
    for (const r of rows) {
      const loadedAt = firstByGrid.get(r.grid_id)
      if (loadedAt) candidates.push({ id: r.id, loadedAt })
    }
  }

  const after = '> julianday(?) + 120.0 / 86400'
  const changed = [
    `SELECT 1 FROM cells WHERE row_id = ? AND julianday(updated_at) ${after}`,
    `SELECT 1 FROM case_log WHERE row_id = ? AND log_type != 'system' AND (julianday(created_at) ${after} OR edited_at IS NOT NULL)`,
    `SELECT 1 FROM attachments WHERE row_id = ? AND julianday(created_at) ${after}`,
    `SELECT 1 FROM appointments WHERE row_id = ? AND series_id IS NULL AND julianday(created_at) ${after}`,
    `SELECT 1 FROM checklist_items WHERE row_id = ? AND julianday(created_at) ${after}`,
    `SELECT 1 FROM provider_client_links WHERE row_id = ? AND julianday(linked_at) ${after}`,
  ].map(sql => db.prepare(`${sql} LIMIT 1`))
  const linked = db.prepare(`SELECT 1 FROM record_links WHERE (from_row_id = ? OR to_row_id = ?) AND julianday(created_at) ${after} LIMIT 1`)
  const scrap = db.prepare("SELECT 1 FROM scrap_notes WHERE row_id = ? AND trim(COALESCE(content, '')) NOT IN ('', '<p></p>') LIMIT 1")
  const untouched = candidates
    .filter(c => !changed.some(s => s.get(c.id, c.loadedAt)) && !linked.get(c.id, c.id, c.loadedAt) && !scrap.get(c.id))
    .map(c => c.id)
  const tracked = new Set((db.prepare('SELECT row_id FROM sample_rows').all() as Array<{ row_id: number }>).map(r => r.row_id))
  trackSampleRows(db, untouched.filter(id => !tracked.has(id)))
  db.prepare("DELETE FROM app_meta WHERE key = 'starter_sample'").run()

  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '47')").run()
}
