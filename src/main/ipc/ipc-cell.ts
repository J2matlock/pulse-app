/**
 * ipc-cell.ts — CELL_*, CELL_FORMAT_* IPC handlers
 */

import { z } from 'zod'
import { IPC } from '../../shared/ipc-channels'
import { QUERY_LIMITS } from '../../shared/query-limits'
import { ok, fail, validId, logNonFatal, notifyCaseLogChanged } from './ipc-utils'
import { handlersFor, idArg, idListArg } from './ipc-define'
import { getDb, upsertCell, cachedStmt, registerCloseHook } from '../database'
import { storesNoCells } from '../../shared/types'
import { toYmd, MIN_YEAR, MAX_YEAR } from '../../shared/ymd'
import { word } from '../vocab'
import { columnAffectsDisplayName, refreshDisplayNames } from '../display-names'
import { numberSeries } from '../number-history'
import { rematerializeForRecord } from '../appointments'
import { shortYmd } from '../../shared/dates'

// Column metadata cache for CELL_UPDATE log_changes checks.
// Keyed by column_id → { name, column_type, config (parsed) }.
// Invalidated via invalidateColumnCache() when columns are modified.
interface ColMeta { name: string; column_type: string; config: Record<string, unknown> }
const _colMetaCache = new Map<number, ColMeta>()
// The connection the cache was filled from. A restore closes the database through the
// backup bridge, which doesn't run the close hooks, and can hand an old column id to a
// new column; a new connection means a fresh cache (bug sweep S4).
let _colMetaDb: unknown = null

export function invalidateColumnCache(columnId?: number): void {
  if (columnId !== undefined) {
    _colMetaCache.delete(columnId)
  } else {
    _colMetaCache.clear()
  }
}

/** Number columns always keep their first value, for the history chart on the record page */
const NUMBER_TYPES = new Set(['number', 'currency'])

function getColMeta(columnId: number): ColMeta | undefined {
  const db = getDb()
  if (db !== _colMetaDb) { _colMetaCache.clear(); _colMetaDb = db }
  let cached = _colMetaCache.get(columnId)
  if (cached) return cached
  const row = cachedStmt('col_meta', 'SELECT name, column_type, config FROM columns WHERE id = ?').get(columnId) as { name: string; column_type: string; config: string } | undefined
  if (!row) return undefined
  let config: Record<string, unknown> = {}
  try { config = JSON.parse(row.config || '{}') } catch (err) { logNonFatal('ipc-cell', `parse column config ${columnId}`, err) }
  cached = { name: row.name, column_type: row.column_type, config }
  _colMetaCache.set(columnId, cached)
  return cached
}

// Clear the column metadata cache when the database closes (lock/quit/restore)
registerCloseHook(() => _colMetaCache.clear())

const define = handlersFor('ipc-cell')

export function registerCellHandlers(): void {
  define(IPC.CELL_GET_HISTORY, [idArg(), idArg()], (rowId, columnId) => {
    const rows = cachedStmt('cell_history_get', `
      SELECT old_value, new_value, changed_at
      FROM cell_history
      WHERE row_id = ? AND column_id = ?
      ORDER BY changed_at DESC
      LIMIT ${QUERY_LIMITS.CELL_HISTORY}
    `).all(rowId, columnId)
    return ok(rows)
  })

  define(IPC.CELL_HISTORY_SERIES, [idArg(), idListArg('Invalid columns', 'Invalid columns', { max: 200 })],
    (rowId, columnIds) => ok(numberSeries(rowId, columnIds)))

  define(IPC.CELL_HISTORY_COMPACT, [
    z.custom<number>(v => typeof v === 'number' && v >= 1 && Number.isInteger(v), 'retentionMonths must be an integer >= 1. To delete all history, use a dedicated purge operation.'),
  ], (retentionMonths) => {
    // Pre-compute cutoff date in JS to avoid SQL string concatenation
    // Same day N months back, clamped to that month's length: setMonth on May 31
    // gave "Feb 31" = Mar 3 and deleted three extra days (Q-032)
    const now = new Date()
    const back = new Date(now.getFullYear(), now.getMonth() - retentionMonths, 1)
    const day = Math.min(now.getDate(), new Date(back.getFullYear(), back.getMonth() + 1, 0).getDate())
    const cutoff = new Date(back.getFullYear(), back.getMonth(), day, now.getHours(), now.getMinutes(), now.getSeconds())
    const cutoffIso = cutoff.toISOString().replace('T', ' ').slice(0, 19)
    const info = getDb().prepare(
      'DELETE FROM cell_history WHERE changed_at < ?'
    ).run(cutoffIso)
    return ok(info.changes)
  }, { write: true })

  // opts is read field by field below, as before
  define(IPC.CELL_UPDATE, [
    idArg(), idArg(), z.string('Cell value must be a string under 100k characters').nullable(), z.custom<{ doneNote?: unknown; silent?: unknown } | null | undefined>(),
  ], (rowId, columnId, value, opts) => {
    // Mark done: its note is written here, tagged, so the dashboard counts completions by tag, not note text (L-22)
    const doneNote = typeof opts?.doneNote === 'string' && opts.doneNote.trim() ? opts.doneNote.trim().slice(0, 500) : null
    // Undo and redo put a value back: the edit's own note is voided or restored with it, so
    // writing another "changed to" note would leave the case log with extras (F-028)
    const silent = opts?.silent === true
    // Strip null bytes BEFORE length check so the limit reflects the actual stored value
    if (value !== null) value = value.replace(/\0/g, '')
    if (value !== null && value.length > 100_000) return fail('Cell value must be a string under 100k characters')
    // A cell must pair a row and a column from the same grid — otherwise a renderer
    // bug could write orphan data that never shows up in any grid.
    const pairOk = cachedStmt('cell_row_col_same_grid_id', 'SELECT r.grid_id FROM rows r JOIN columns c ON c.grid_id = r.grid_id WHERE r.id = ? AND c.id = ?').get(rowId, columnId) as { grid_id: number } | undefined
    if (!pairOk) return fail(`We couldn't save that change — the ${word('record')} or column no longer exists. Reopen the ${word('list')} and try again.`)
    // Link columns (W04) have no cells; their links change through RECORD_LINK_ADD/REMOVE
    if (storesNoCells(getColMeta(columnId)?.column_type ?? '')) return fail('That column shows links. Use the link picker to change it.')
    if (getColMeta(columnId)?.column_type === 'auto_number') return fail('Numbers are filled in automatically and can\'t be changed.')
    // Dates are stored as YYYY-MM-DD; a half-typed year (0026) or free text would throw the deadlines off (AUDIT-112)
    const meta = getColMeta(columnId)
    if ((meta?.column_type === 'date' || meta?.column_type === 'deadline') && value !== null && value !== '' && toYmd(value) !== value) {
      return fail(`"${meta.name}" needs a full date between ${MIN_YEAR} and ${MAX_YEAR}. Pick one from the calendar and try again.`)
    }
    const db = getDb()

    let sysLogId: number | null = null
    let needsLogNotify = false
    // The value this save replaced, for the renderer's undo step: a record that isn't in the
    // open list (archived, on its own page) has no copy there to take it from (F-016)
    let previous: string | null = null

    db.transaction(() => {
      // Record history before updating
      const existing = cachedStmt('cell_select', 'SELECT id, value FROM cells WHERE row_id = ? AND column_id = ?').get(rowId, columnId) as { id: number, value: string | null } | undefined
      previous = existing?.value ?? null

      upsertCell(rowId, columnId, value)
      if (columnAffectsDisplayName(pairOk.grid_id, columnId)) refreshDisplayNames(pairOk.grid_id, [rowId])

      if (existing) {
        cachedStmt('cell_history_insert', `
          INSERT INTO cell_history (cell_id, row_id, column_id, old_value, new_value, changed_at)
          VALUES (?, ?, ?, ?, ?, datetime('now'))
        `).run(existing.id, rowId, columnId, existing.value, value)
      } else if (value !== null && (getColMeta(columnId)?.config.log_changes || NUMBER_TYPES.has(getColMeta(columnId)?.column_type ?? ''))) {
        // Number columns (and any column that records every change) keep the first value too,
        // so a number's history chart is complete from the start (W10 §5, 3.5)
        const cellId = (cachedStmt('cell_id_for', 'SELECT id FROM cells WHERE row_id = ? AND column_id = ?').get(rowId, columnId) as { id: number }).id
        cachedStmt('cell_history_insert', `
          INSERT INTO cell_history (cell_id, row_id, column_id, old_value, new_value, changed_at)
          VALUES (?, ?, ?, ?, ?, datetime('now'))
        `).run(cellId, rowId, columnId, null, value)
      }

      // Update row's updated_at
      cachedStmt('row_update_ts', "UPDATE rows SET updated_at = datetime('now') WHERE id = ?").run(rowId)

      // System log: only when value changed and column has log_changes enabled
      const oldValue = existing?.value ?? null
      if (doneNote) {
        const logResult = cachedStmt('syslog_insert_done', `INSERT INTO case_log (row_id, content, log_type, source_action_id, created_at, updated_at) VALUES (?, ?, 'system', ?, datetime('now'), datetime('now'))`)
          .run(rowId, doneNote, `deadline_done:${columnId}`)
        sysLogId = logResult.lastInsertRowid as number
        needsLogNotify = true
      } else if (oldValue !== value && !silent) {
        const col = getColMeta(columnId)
        if (col && col.config.log_changes) {
          let content: string
          if (col.column_type === 'date' || col.column_type === 'deadline') {
            const from = oldValue ? shortYmd(oldValue) : 'blank'
            const to = value ? shortYmd(value) : 'cleared'
            // Clearing a date is not finishing it (G-16): only Mark done says "completed"
            content = value ? `${col.name} changed from ${from} to ${to}` : `${col.name} cleared (was ${from})`
          } else if (col.column_type === 'checkbox') {
            content = (value === '1' || value === 'true') ? `${col.name}: checked` : `${col.name}: unchecked`
          } else {
            if (!oldValue && value) content = `${col.name} set to "${value}"`
            else if (oldValue && !value) content = `${col.name} cleared`
            else content = `${col.name} changed to "${value}"`
          }
          const logResult = cachedStmt('syslog_insert', `INSERT INTO case_log (row_id, content, log_type, created_at, updated_at) VALUES (?, ?, 'system', datetime('now'), datetime('now'))`).run(rowId, content)
          sysLogId = logResult.lastInsertRowid as number
          needsLogNotify = true
        }
      }
    })()

    // A date that ends a recurring appointment series moved (W07 §3)
    if (getColMeta(columnId)?.column_type === 'date') {
      try { rematerializeForRecord(rowId) } catch (err) { logNonFatal('ipc-cell', 'appointment series', err) }
    }

    // Notify outside transaction to avoid holding the lock
    if (needsLogNotify) notifyCaseLogChanged(rowId)

    return ok({ sysLogId, previous })
  }, { write: true })

  // CELL_BULK_UPDATE: removed — no multi-cell paste UI exists yet. Re-add when needed.

  // ── Cell Formats ──────────────────────────────────────────────────────────
  define(IPC.CELL_FORMAT_SET, [
    idArg(), idArg(), z.string('Invalid rules format').max(50_000, 'Formatting rules too large'),
  ], (rowId, columnId, rules) => {
    try { JSON.parse(rules) } catch { return fail('Invalid rules JSON') }
    const db = getDb()
    if (!rules || rules === '[]') {
      db.prepare('DELETE FROM cell_formats WHERE row_id = ? AND column_id = ?').run(rowId, columnId)
    } else {
      db.prepare(`
        INSERT INTO cell_formats (row_id, column_id, rules) VALUES (?, ?, ?)
        ON CONFLICT(row_id, column_id) DO UPDATE SET rules = excluded.rules
      `).run(rowId, columnId, rules)
    }
    return ok(true)
  }, { write: true })

  // Each entry is checked in the body, in order, with its own messages
  define(IPC.CELL_FORMAT_BATCH_SET, [
    z.array(z.custom<{ rowId: number; columnId: number; rules: string }>(), 'Invalid batch format payload').max(2_000, 'Invalid batch format payload'),
  ], (entries) => {
    for (const e of entries) {
      if (!validId(e.rowId) || !validId(e.columnId)) return fail('Invalid ID in batch entry')
      if (typeof e.rules !== 'string' || e.rules.length > 50_000) return fail('Entry rules invalid')
      if (e.rules && e.rules !== '[]') { try { JSON.parse(e.rules) } catch { return fail('Invalid rules JSON in batch entry') } }
    }
    const db = getDb()
    const deleteStmt = db.prepare('DELETE FROM cell_formats WHERE row_id = ? AND column_id = ?')
    const upsertStmt = db.prepare(`
      INSERT INTO cell_formats (row_id, column_id, rules) VALUES (?, ?, ?)
      ON CONFLICT(row_id, column_id) DO UPDATE SET rules = excluded.rules
    `)
    db.transaction(() => {
      for (const { rowId, columnId, rules } of entries) {
        if (!rules || rules === '[]') {
          deleteStmt.run(rowId, columnId)
        } else {
          upsertStmt.run(rowId, columnId, rules)
        }
      }
    })()
    return ok(true)
  }, { write: true })
}
