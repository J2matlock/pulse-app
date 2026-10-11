/**
 * ipc-cell.ts — CELL_*, CELL_FORMAT_* IPC handlers
 */

import { IPC } from '../../shared/ipc-channels'
import { QUERY_LIMITS } from '../../shared/query-limits'
import { secureWrap, ok, fail, validId, logNonFatal, notifyCaseLogChanged, enforceWritable } from './ipc-utils'
import { getDb, upsertCell, cachedStmt, registerCloseHook } from '../database'
import { storesNoCells, type CellFormat } from '../../shared/types'
import { word } from '../vocab'
import { columnAffectsDisplayName, refreshDisplayNames } from '../display-names'
import { numberSeries } from '../number-history'
import { rematerializeForRecord } from '../appointments'

// Column metadata cache for CELL_UPDATE log_changes checks.
// Keyed by column_id → { name, column_type, config (parsed) }.
// Invalidated via invalidateColumnCache() when columns are modified.
interface ColMeta { name: string; column_type: string; config: Record<string, unknown> }
const _colMetaCache = new Map<number, ColMeta>()

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

export function registerCellHandlers(): void {
  secureWrap(IPC.CELL_GET_HISTORY, 'ipc-cell', (_e, rowId: number, columnId: number) => {
    if (!validId(rowId) || !validId(columnId)) return fail('Invalid ID')
    const rows = cachedStmt('cell_history_get', `
      SELECT old_value, new_value, changed_at
      FROM cell_history
      WHERE row_id = ? AND column_id = ?
      ORDER BY changed_at DESC
      LIMIT ${QUERY_LIMITS.CELL_HISTORY}
    `).all(rowId, columnId)
    return ok(rows)
  })

  secureWrap(IPC.CELL_HISTORY_SERIES, 'ipc-cell', (_e, rowId: unknown, columnIds: unknown) => {
    if (!validId(rowId)) return fail('Invalid ID')
    if (!Array.isArray(columnIds) || columnIds.length > 200 || !columnIds.every(validId)) return fail('Invalid columns')
    return ok(numberSeries(rowId, columnIds as number[]))
  })

  secureWrap(IPC.CELL_HISTORY_COMPACT, 'ipc-cell', (_e, retentionMonths: number) => {
    const guard = enforceWritable(); if (guard) return guard
    if (typeof retentionMonths !== 'number' || retentionMonths < 1 || !Number.isInteger(retentionMonths)) {
      return fail('retentionMonths must be an integer >= 1. To delete all history, use a dedicated purge operation.')
    }
    // Pre-compute cutoff date in JS to avoid SQL string concatenation
    const cutoff = new Date()
    cutoff.setMonth(cutoff.getMonth() - retentionMonths)
    const cutoffIso = cutoff.toISOString().replace('T', ' ').slice(0, 19)
    const info = getDb().prepare(
      'DELETE FROM cell_history WHERE changed_at < ?'
    ).run(cutoffIso)
    return ok(info.changes)
  })

  secureWrap(IPC.CELL_UPDATE, 'ipc-cell', (_e, rowId: number, columnId: number, value: string | null) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(rowId) || !validId(columnId)) return fail('Invalid ID')
    if (value !== null && typeof value !== 'string') return fail('Cell value must be a string under 100k characters')
    // Strip null bytes BEFORE length check so the limit reflects the actual stored value
    if (value !== null) value = value.replace(/\0/g, '')
    if (value !== null && value.length > 100_000) return fail('Cell value must be a string under 100k characters')
    // A cell must pair a row and a column from the same grid — otherwise a renderer
    // bug could write orphan data that never shows up in any grid.
    const pairOk = cachedStmt('cell_row_col_same_grid_id', 'SELECT r.grid_id FROM rows r JOIN columns c ON c.grid_id = r.grid_id WHERE r.id = ? AND c.id = ?').get(rowId, columnId) as { grid_id: number } | undefined
    if (!pairOk) return fail(`We couldn't save that change — the ${word('record')} or column no longer exists. Try reloading the grid.`)
    // Link columns (W04) have no cells; their links change through RECORD_LINK_ADD/REMOVE
    if (storesNoCells(getColMeta(columnId)?.column_type ?? '')) return fail('That column shows links. Use the link picker to change it.')
    if (getColMeta(columnId)?.column_type === 'auto_number') return fail('Numbers are filled in automatically and can\'t be changed.')
    const db = getDb()

    let sysLogId: number | null = null
    let needsLogNotify = false

    db.transaction(() => {
      // Record history before updating
      const existing = cachedStmt('cell_select', 'SELECT id, value FROM cells WHERE row_id = ? AND column_id = ?').get(rowId, columnId) as { id: number, value: string | null } | undefined

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
      if (oldValue !== value) {
        const col = getColMeta(columnId)
        if (col && col.config.log_changes) {
          let content: string
          if (col.column_type === 'date') {
            const fmt = (d: string) => {
              const [y = NaN, m = NaN, day = NaN] = d.split('-').map(Number)
              return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            }
            const from = oldValue ? fmt(oldValue) : 'blank'
            const to = value ? fmt(value) : 'cleared'
            content = value ? `${col.name} changed from ${from} to ${to}` : `${col.name} completed (was ${from})`
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

    return ok({ sysLogId })
  })

  // CELL_BULK_UPDATE: removed — no multi-cell paste UI exists yet. Re-add when needed.

  // ── Cell Formats ──────────────────────────────────────────────────────────
  secureWrap(IPC.CELL_FORMAT_GET_FOR_GRID, 'ipc-cell', (_e, gridId: number) => {
    if (!validId(gridId)) return fail('Invalid ID')
    const formats = cachedStmt('cell_format_get_for_grid', `
      SELECT cf.row_id, cf.column_id, cf.rules
      FROM cell_formats cf
      JOIN rows r ON r.id = cf.row_id
      WHERE r.grid_id = ?
    `).all(gridId) as CellFormat[]
    return ok(formats)
  })

  secureWrap(IPC.CELL_FORMAT_SET, 'ipc-cell', (_e, rowId: number, columnId: number, rules: string) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(rowId) || !validId(columnId)) return fail('Invalid ID')
    if (typeof rules !== 'string') return fail('Invalid rules format')
    if (rules.length > 50_000) return fail('Formatting rules too large')
    try { JSON.parse(rules) } catch (err) { return fail('Invalid rules JSON') }
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
  })

  secureWrap(IPC.CELL_FORMAT_BATCH_SET, 'ipc-cell', (_e, entries: Array<{ rowId: number; columnId: number; rules: string }>) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!Array.isArray(entries) || entries.length > 2_000) return fail('Invalid batch format payload')
    for (const e of entries) {
      if (!validId(e.rowId) || !validId(e.columnId)) return fail('Invalid ID in batch entry')
      if (typeof e.rules !== 'string' || e.rules.length > 50_000) return fail('Entry rules invalid')
      if (e.rules && e.rules !== '[]') { try { JSON.parse(e.rules) } catch (err) { return fail('Invalid rules JSON in batch entry') } }
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
  })
}
