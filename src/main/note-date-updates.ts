/**
 * Case notes that update deadline dates (brainstorm A1).
 *
 * A date column can opt in with `note_updates: ['visit', 'phone', …]` in its
 * config. Logging a note of one of those types sets that client's date to the
 * note's date, so "Last Face-to-Face" stays current without a second edit.
 * A date never moves backward (a later date entered by hand wins).
 *
 * Each move is recorded against its note (note_date_moves), so voiding or
 * deleting the note can put the date back (audit 1.23).
 */
import { getDb, upsertCell, cachedStmt } from './database'
import { localDateString, parseDbTimestamp } from '../shared/dates'
import type { NoteDateUpdate, NoteDateRevert } from '../shared/types'
import { setCellWithHistory } from './cell-write'
import { columnAffectsDisplayName, refreshDisplayNames } from './display-names'
import { userTypeKeys } from './activity-types'

/**
 * A "when did this happen?" day from the screen: a real YYYY-MM-DD, not in
 * the future. Returns the day, null when none was given, or an error message.
 */
export function checkOccurredOn(value: unknown): string | null | { error: string } {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return { error: 'Choose the day it happened.' }
  const [y, m, d] = value.split('-').map(Number) as [number, number, number]
  const date = new Date(y, m - 1, d)
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d || y < 1900) return { error: 'Choose the day it happened.' }
  if (value > localDateString()) return { error: "That day hasn't happened yet. Choose today or an earlier day." }
  return value
}

/**
 * The stored timestamp (UTC, like datetime('now')) for a note that happened
 * on a local day: now for today, midday for an earlier day (so the local day
 * is the same in every time zone change).
 */
export function occurredTimestamp(day: string, now: Date = new Date()): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  const at = day === localDateString(now) ? now : new Date(y, m - 1, d, 12, 0, 0)
  return at.toISOString().replace('T', ' ').slice(0, 19)
}

/** The local day of a stored timestamp */
export function localDayOf(timestamp: string): string {
  return localDateString(parseDbTimestamp(timestamp))
}


/** noteId: the note doing the moving, so its moves can be undone when it's voided or deleted */
export function applyNoteDateUpdates(rowId: number, logType: string, noteDate: string = localDateString(), noteId?: number | null): NoteDateUpdate[] {
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
      if (noteId != null) {
        cachedStmt('note_date_move_insert', 'INSERT INTO note_date_moves (case_log_id, row_id, column_id, old_value, new_value) VALUES (?, ?, ?, ?, ?)')
          .run(noteId, rowId, col.id, old, noteDate)
      }
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

/**
 * A note is voided or deleted: put back the dates it moved (L-05).
 *
 * Each date it set goes back to the latest remaining note of the kinds the
 * column follows, or to what it held before, whichever is later. A date
 * changed since (typed by hand, or moved by a later note) is left alone; a
 * later note's record of "what it was before" then skips this note.
 * Returns what changed, so the screen can say so.
 */
export function revertNoteDates(noteId: number): NoteDateRevert[] {
  const db = getDb()
  const moves = db.prepare(`
    SELECT m.id, m.row_id, m.column_id, m.old_value, m.new_value, col.name, col.config, col.grid_id, c.value AS current
    FROM note_date_moves m
    JOIN columns col ON col.id = m.column_id
    LEFT JOIN cells c ON c.row_id = m.row_id AND c.column_id = m.column_id
    WHERE m.case_log_id = ? ORDER BY m.id
  `).all(noteId) as Array<{ id: number; row_id: number; column_id: number; old_value: string | null; new_value: string; name: string; config: string | null; grid_id: number; current: string | null }>
  if (moves.length === 0) return []
  const reverted: NoteDateRevert[] = []
  db.transaction(() => {
    for (const m of moves) {
      const current = m.current || null
      if (current?.slice(0, 10) === m.new_value) {
        let types: string[] = []
        try { const t = (JSON.parse(m.config ?? '{}') as { note_updates?: unknown }).note_updates; if (Array.isArray(t)) types = t.filter((x): x is string => typeof x === 'string') } catch { /* no types */ }
        const latest = types.length === 0 ? null : (db.prepare(`
          SELECT MAX(date(occurred_at, 'localtime')) AS d FROM case_log
          WHERE row_id = ? AND id != ? AND voided_at IS NULL AND log_type IN (${types.map(() => '?').join(',')})
            AND date(occurred_at, 'localtime') <= ?
        `).get(m.row_id, noteId, ...types, m.new_value) as { d: string | null }).d
        const before = m.old_value || null
        const value = latest && (!before || latest > before.slice(0, 10)) ? latest : before
        if (value !== current) {
          setCellWithHistory(m.row_id, m.column_id, value)
          reverted.push({ row_id: m.row_id, column_id: m.column_id, column_name: m.name, old_value: current, new_value: value })
        }
      } else {
        // Changed since: leave it, and let a later move's "before" skip this note
        db.prepare('UPDATE note_date_moves SET old_value = ? WHERE row_id = ? AND column_id = ? AND id > ? AND old_value IS ?')
          .run(m.old_value, m.row_id, m.column_id, m.id, m.new_value)
      }
      db.prepare('DELETE FROM note_date_moves WHERE id = ?').run(m.id)
    }
    const touched = new Map<number, Set<number>>()
    for (const r of reverted) {
      db.prepare("UPDATE rows SET updated_at = datetime('now') WHERE id = ?").run(r.row_id)
      const grid = moves.find(m => m.row_id === r.row_id && m.column_id === r.column_id)!.grid_id
      if (columnAffectsDisplayName(grid, r.column_id)) touched.set(grid, (touched.get(grid) ?? new Set()).add(r.row_id))
    }
    for (const [grid, rows] of touched) refreshDisplayNames(grid, [...rows])
  })()
  return reverted
}
