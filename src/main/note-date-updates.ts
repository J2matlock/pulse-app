/**
 * Case notes that update deadline dates (brainstorm A1).
 *
 * A date column can opt in with `note_updates: ['visit', 'phone', …]` in its
 * config. Logging a note of one of those types sets that client's date to the
 * note's date, so "Last Face-to-Face" stays current without a second edit.
 * A date never moves backward (a later date entered by hand wins).
 */
import { getDb, upsertCell, cachedStmt } from './database'
import { localDateString } from '../shared/dates'
import type { NoteDateUpdate } from '../shared/types'
import { columnAffectsDisplayName, refreshDisplayNames } from './display-names'
import { userTypeKeys } from './activity-types'

/** Note types a column can follow (system entries never update dates). */

export function applyNoteDateUpdates(rowId: number, logType: string, noteDate: string = localDateString()): NoteDateUpdate[] {
  // Only people's own note types move dates; notes Pulse writes itself never do
  if (!userTypeKeys(true).has(logType)) return []
  const db = getDb()
  const columns = cachedStmt('note_update_cols', `
    SELECT col.id, col.name, col.config, c.id AS cell_id, c.value
    FROM rows r
    JOIN columns col ON col.grid_id = r.grid_id AND col.column_type = 'date'
      AND json_extract(col.config, '$.note_updates') IS NOT NULL
    LEFT JOIN cells c ON c.row_id = r.id AND c.column_id = col.id
    WHERE r.id = ?
  `).all(rowId) as Array<{ id: number; name: string; config: string; cell_id: number | null; value: string | null }>

  const updates: NoteDateUpdate[] = []
  db.transaction(() => {
    for (const col of columns) {
      let types: unknown
      try { types = (JSON.parse(col.config) as { note_updates?: unknown }).note_updates } catch { continue }
      if (!Array.isArray(types) || !types.includes(logType)) continue
      const old = col.value || null
      if (old && old.slice(0, 10) >= noteDate) continue
      upsertCell(rowId, col.id, noteDate)
      if (col.cell_id != null) {
        cachedStmt('cell_history_insert', `
          INSERT INTO cell_history (cell_id, row_id, column_id, old_value, new_value, changed_at)
          VALUES (?, ?, ?, ?, ?, datetime('now'))
        `).run(col.cell_id, rowId, col.id, old, noteDate)
      }
      updates.push({ column_id: col.id, column_name: col.name, old_value: old, new_value: noteDate })
    }
    if (updates.length > 0) {
      cachedStmt('row_update_ts', "UPDATE rows SET updated_at = datetime('now') WHERE id = ?").run(rowId)
      // A dated column can be part of the list's display format
      const row = cachedStmt('note_update_row_grid', 'SELECT grid_id FROM rows WHERE id = ?').get(rowId) as { grid_id: number } | undefined
      if (row && updates.some(u => columnAffectsDisplayName(row.grid_id, u.column_id))) refreshDisplayNames(row.grid_id, [rowId])
    }
  })()
  return updates
}
