/**
 * ipc-row.ts — ROW_* IPC handlers
 */

import { copyForwardLinks, dropLinksThatWontFit } from '../links'
import { IPC } from '../../shared/ipc-channels'
import type { RowLocation } from '../../shared/ipc-contract'
import { secureWrap, logNonFatal, ok, fail, buildSafeSetClause, validId, notifyCaseLogChanged, enforceWritable } from './ipc-utils'
import { getDb, getRow, cachedStmt } from '../database'
import { word } from '../vocab'
import { refreshDisplayNames } from '../display-names'
import { assignAutoNumbers } from '../auto-number'

// ── IPC payload size limits ────────────────────────────────────────────────
const MAX_REORDER_ROWS = 5000
const MAX_BULK_ROW_ACTION = 1000
const ALLOWED_BULK_ACTIONS = new Set(['archive', 'unarchive', 'delete', 'restore'])

// ── Shared column-mapping helpers ─────────────────────────────────────────

interface ColumnMapping {
  srcColMap: Map<number, string>  // source column id → name
  toTarget: Map<number, number>   // source column id → the same-named target column id
}

/**
 * Match columns between two lists by name (case-insensitive). Names can repeat
 * within a list ("Phone" and "phone"), so each target column takes at most one
 * source column, the first by position; the others count as unmatched (parked
 * on a move, left out of a copy) instead of colliding in one cell.
 */
function buildColumnMapping(srcGridId: number, tgtGridId: number): ColumnMapping {
  const select = cachedStmt('row_col_map_select_ordered', 'SELECT id, name FROM columns WHERE grid_id = ? ORDER BY position, id')
  const srcCols = select.all(srcGridId) as { id: number; name: string }[]
  const tgtCols = select.all(tgtGridId) as { id: number; name: string }[]
  const byName = new Map<string, number>()
  for (const c of tgtCols) if (!byName.has(c.name.toLowerCase())) byName.set(c.name.toLowerCase(), c.id)
  const toTarget = new Map<number, number>()
  const taken = new Set<number>()
  for (const c of srcCols) {
    const tgt = byName.get(c.name.toLowerCase())
    if (tgt === undefined || taken.has(tgt)) continue
    taken.add(tgt)
    toTarget.set(c.id, tgt)
  }
  return { srcColMap: new Map(srcCols.map(c => [c.id, c.name])), toTarget }
}

/** Copy cells from sourceRowId into targetRowId, remapping column IDs by name. */
function copyCellsToGrid(
  sourceRowId: number,
  targetRowId: number,
  mapping: ColumnMapping,
): void {
  const srcCells = cachedStmt('row_copy_cells_select', 'SELECT column_id, value FROM cells WHERE row_id = ?').all(sourceRowId) as { column_id: number; value: string | null }[]
  const insertCell = cachedStmt('row_copy_cells_insert', "INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, ?, datetime('now'))")
  for (const cell of srcCells) {
    const tgtColId = mapping.toTarget.get(cell.column_id)
    if (tgtColId !== undefined) {
      insertCell.run(targetRowId, tgtColId, cell.value)
    }
  }
}

/** Re-map cell_formats entries for a row being moved, carrying only owned rules. */
function transferCellFormats(
  rowId: number,
  mapping: ColumnMapping,
): void {
  const srcFmts = cachedStmt('row_cellfmt_select', 'SELECT row_id, column_id, rules FROM cell_formats WHERE row_id = ?').all(rowId) as { row_id: number; column_id: number; rules: string }[]
  const deleteFmtStmt = cachedStmt('row_cellfmt_delete', 'DELETE FROM cell_formats WHERE row_id = ? AND column_id = ?')
  for (const f of srcFmts) {
    const colName = mapping.srcColMap.get(f.column_id)
    if (!colName) { deleteFmtStmt.run(rowId, f.column_id); continue }
    const tgtColId = mapping.toTarget.get(f.column_id)
    if (tgtColId !== undefined) {
      try {
        const parsed = JSON.parse(f.rules) as Array<{ sourceColumnId?: number; sourceRowId?: number; originRowId?: number }>
        // Only carry rules that this row owns (no originRowId = self-created, or originRowId matches this row)
        const ownRules = parsed.filter(r => r.originRowId == null || r.originRowId === rowId)
        if (ownRules.length === 0) {
          // All rules were inherited — don't carry them to the new grid
          deleteFmtStmt.run(rowId, f.column_id)
          continue
        }
        // Remap column references inside the rules JSON
        const remapped = ownRules.map(r => {
          const updated = { ...r }
          if (r.sourceColumnId != null) {
            const mapped = mapping.toTarget.get(r.sourceColumnId)
            if (mapped != null) updated.sourceColumnId = mapped
          }
          // Keep originRowId so the panel knows this is an "all rows" rule
          updated.originRowId = rowId
          if (r.sourceRowId != null && r.sourceRowId !== rowId) {
            delete updated.sourceRowId
            ;(updated as Record<string, unknown>).sourceType = 'self'
          }
          return updated
        })
        cachedStmt('row_cellfmt_update_col', 'UPDATE cell_formats SET column_id = ?, rules = ? WHERE row_id = ? AND column_id = ?').run(tgtColId, JSON.stringify(remapped), rowId, f.column_id)
      } catch (err) {
        // Parse failed — delete rather than carry broken rules
        logNonFatal('ipc-row', `transferCellFormats: parse rules for row ${rowId} col ${f.column_id}`, err)
        cachedStmt('row_cellfmt_delete', 'DELETE FROM cell_formats WHERE row_id = ? AND column_id = ?').run(rowId, f.column_id)
      }
    } else {
      cachedStmt('row_cellfmt_delete', 'DELETE FROM cell_formats WHERE row_id = ? AND column_id = ?').run(rowId, f.column_id)
    }
  }
}

interface ParkedHistory { old_value: string | null; new_value: string | null; changed_at: string }

/** Keep a cell (and its edit history) aside under its own column, to come back on a return move (G-18, L-11). */
function parkCell(rowId: number, columnId: number, cellId: number, value: string | null, withHistory: boolean): void {
  const history = withHistory
    ? cachedStmt('row_park_hist', 'SELECT old_value, new_value, changed_at FROM cell_history WHERE cell_id = ? ORDER BY id').all(cellId) as ParkedHistory[]
    : []
  cachedStmt('row_park_cell', `INSERT INTO parked_cells (row_id, column_id, value, history, parked_at) VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(row_id, column_id) DO UPDATE SET value = excluded.value, history = excluded.history, parked_at = excluded.parked_at`)
    .run(rowId, columnId, value, history.length ? JSON.stringify(history) : null)
}

/**
 * Re-map existing cells and cell_history in place for a row being moved
 * between grids. Cells with no same-named column in the target are parked,
 * not deleted, and so is the row's own number in each auto-number column.
 */
function remapCellsForMove(
  rowId: number,
  mapping: ColumnMapping,
): void {
  const autoSrc = new Set((cachedStmt('row_move_auto_cols', "SELECT c.id FROM columns c JOIN rows r ON r.grid_id = c.grid_id WHERE r.id = ? AND c.column_type = 'auto_number'")
    .all(rowId) as Array<{ id: number }>).map(c => c.id))
  const srcCells = cachedStmt('row_remap_cells_select', 'SELECT id, column_id, value FROM cells WHERE row_id = ?').all(rowId) as { id: number; column_id: number; value: string | null }[]
  const updateCell = cachedStmt('row_remap_cell_col', 'UPDATE cells SET column_id = ? WHERE id = ?')
  const updateHist = cachedStmt('row_remap_hist_by_cell', 'UPDATE cell_history SET column_id = ? WHERE cell_id = ?')
  const deleteCell = cachedStmt('row_remap_cell_delete', 'DELETE FROM cells WHERE id = ?')
  for (const cell of srcCells) {
    const colName = mapping.srcColMap.get(cell.column_id)
    const tgtColId = mapping.toTarget.get(cell.column_id)
    if (tgtColId === undefined) {
      // A value for a column the target doesn't have: park it with its history (history cascades with the cell)
      if (colName !== undefined) parkCell(rowId, cell.column_id, cell.id, cell.value, true)
      deleteCell.run(cell.id)
      continue
    }
    // The target issues its own numbers; this list's number waits here for a move back
    if (autoSrc.has(cell.column_id) && cell.value?.trim()) parkCell(rowId, cell.column_id, cell.id, cell.value, false)
    updateCell.run(tgtColId, cell.id)
    updateHist.run(tgtColId, cell.id)
  }
  // A deadline's finished marks, done steps and extensions follow it to the same-named column.
  // Ones for a column the target doesn't have stay keyed to it, so a move back finds them.
  const follow = ['deadline_done', 'deadline_progress', 'deadline_extensions'].map(table =>
    cachedStmt(`row_remap_${table}`, `UPDATE OR REPLACE ${table} SET column_id = ? WHERE row_id = ? AND column_id = ?`))
  for (const [srcColId, tgtColId] of mapping.toTarget) {
    if (tgtColId === srcColId) continue
    for (const stmt of follow) stmt.run(tgtColId, rowId, srcColId)
  }
}

/**
 * Put back what was parked for this row in the list it just moved into.
 * A parked number wins over a carried one; other parked values only fill
 * empty cells. Returns the auto-number columns that got their number back.
 */
function unparkCells(rowId: number, gridId: number): Set<number> {
  const parked = cachedStmt('row_unpark_select', `SELECT p.id, p.column_id, p.value, p.history, c.column_type FROM parked_cells p
    JOIN columns c ON c.id = p.column_id WHERE p.row_id = ? AND c.grid_id = ?`).all(rowId, gridId) as
    Array<{ id: number; column_id: number; value: string | null; history: string | null; column_type: string }>
  const restoredAuto = new Set<number>()
  const current = cachedStmt('row_unpark_current', 'SELECT id, value FROM cells WHERE row_id = ? AND column_id = ?')
  const setValue = cachedStmt('row_unpark_set', "UPDATE cells SET value = ?, updated_at = datetime('now') WHERE id = ?")
  const insert = cachedStmt('row_unpark_insert', "INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, ?, datetime('now'))")
  const insertHist = cachedStmt('row_unpark_hist', 'INSERT INTO cell_history (cell_id, row_id, column_id, old_value, new_value, changed_at) VALUES (?, ?, ?, ?, ?, ?)')
  const drop = cachedStmt('row_unpark_drop', 'DELETE FROM parked_cells WHERE id = ?')
  for (const p of parked) {
    const isAuto = p.column_type === 'auto_number'
    const cur = current.get(rowId, p.column_id) as { id: number; value: string | null } | undefined
    let cellId: number | null = null
    if (!cur) cellId = Number(insert.run(rowId, p.column_id, p.value).lastInsertRowid)
    else if (isAuto || !cur.value?.trim()) { setValue.run(p.value, cur.id); cellId = cur.id }
    if (cellId !== null) {
      if (isAuto && p.value?.trim()) restoredAuto.add(p.column_id)
      let history: ParkedHistory[] = []
      try { history = p.history ? JSON.parse(p.history) as ParkedHistory[] : [] } catch { history = [] }
      for (const h of history) insertHist.run(cellId, rowId, p.column_id, h.old_value, h.new_value, h.changed_at)
    }
    drop.run(p.id)
  }
  return restoredAuto
}

function gridOfRow(rowId: number): number | null {
  const row = cachedStmt('row_grid_of', 'SELECT grid_id FROM rows WHERE id = ?').get(rowId) as { grid_id: number } | undefined
  return row?.grid_id ?? null
}

/** "Client" / "Vehicle"… for this row's list, for system entries in its activity log */
function recordWord(rowId: number): string {
  return word('record', { cap: true }, gridOfRow(rowId))
}

/**
 * Archive, unarchive, delete and restore only change a record that's in the state
 * they expect (AUDIT-101): a stale screen could otherwise bring a trashed record back
 * into search and the dashboard, or restart its 30 days in the Trash.
 */
function rowState(rowId: number): 'missing' | 'trash' | 'kept' {
  const r = cachedStmt('row_state', 'SELECT deleted_at FROM rows WHERE id = ?').get(rowId) as { deleted_at: string | null } | undefined
  return !r ? 'missing' : r.deleted_at ? 'trash' : 'kept'
}

function rowGone(): ReturnType<typeof fail> {
  return fail(`That ${word('record')} is no longer available.`)
}

/** A record's "Add contact info" list, tolerating old or damaged JSON */
function parseManualContacts(raw: string | null): Array<{ type: string; label: string; value: string }> {
  if (!raw) return []
  try {
    const list = JSON.parse(raw) as unknown
    return Array.isArray(list) ? list.filter((c): c is { type: string; label: string; value: string } => !!c && typeof c === 'object' && typeof (c as { value?: unknown }).value === 'string') : []
  } catch { return [] }
}

export function registerRowHandlers(): void {
  secureWrap(IPC.ROW_BULK_ACTION, 'ipc-row', (_e, action: 'archive' | 'unarchive' | 'delete' | 'restore', rowIds: number[]) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!ALLOWED_BULK_ACTIONS.has(action)) return fail(`Invalid bulk action: ${action}`)
    if (!Array.isArray(rowIds) || rowIds.length === 0) return fail(`Choose at least one ${word('record')}.`)
    if (rowIds.length > MAX_BULK_ROW_ACTION) return fail(`You can change up to ${MAX_BULK_ROW_ACTION.toLocaleString('en-US')} ${word('record', { many: true })} at once.`)
    if (!rowIds.every(id => Number.isInteger(id) && id > 0)) return fail('Invalid row IDs')
    const db = getDb()
    const logStmt = cachedStmt('row_sys_log', `INSERT INTO case_log (row_id, content, log_type, created_at, updated_at) VALUES (?, ?, 'system', datetime('now'), datetime('now'))`)
    const run = db.transaction(() => {
      if (action === 'archive') {
        const stmt = cachedStmt('row_bulk_archive_v2', `
          UPDATE rows SET is_active = 0, archived_at = datetime('now'),
          archived_reason = 'Bulk action', updated_at = datetime('now') WHERE id = ? AND deleted_at IS NULL
        `)
        rowIds.forEach(id => {
          if (stmt.run(id).changes > 0) logStmt.run(id, `${recordWord(id)} archived: Bulk action`)
        })
      } else if (action === 'unarchive') {
        const stmt = cachedStmt('row_bulk_unarchive_v2', `
          UPDATE rows SET is_active = 1, archived_at = NULL, archived_reason = NULL,
          updated_at = datetime('now') WHERE id = ? AND deleted_at IS NULL AND (is_active = 0 OR archived_at IS NOT NULL)
        `)
        rowIds.forEach(id => {
          if (stmt.run(id).changes > 0) logStmt.run(id, `${recordWord(id)} unarchived`)
        })
      } else if (action === 'delete') {
        const stmt = cachedStmt('row_bulk_delete_v2', `
          UPDATE rows SET is_active = 0, deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND deleted_at IS NULL
        `)
        rowIds.forEach(id => {
          if (stmt.run(id).changes > 0) logStmt.run(id, `${recordWord(id)} moved to the Trash`)
        })
      } else if (action === 'restore') {
        // Undo of a bulk move to trash (G-34); archived records come back archived
        const stmt = cachedStmt('row_bulk_restore', `
          UPDATE rows SET is_active = CASE WHEN archived_at IS NULL THEN 1 ELSE 0 END, deleted_at = NULL,
          updated_at = datetime('now') WHERE id = ? AND deleted_at IS NOT NULL
        `)
        rowIds.forEach(id => {
          if (stmt.run(id).changes > 0) logStmt.run(id, `${recordWord(id)} restored from the Trash`)
        })
      }
    })
    run()
    // Notify renderer once with rowId=0 as a "refresh all" signal
    // (avoids O(n) IPC messages for bulk actions — renderer reloads anyway)
    notifyCaseLogChanged(0)
    return ok(rowIds.length)
  })

  secureWrap(IPC.ROW_GET, 'ipc-row', (_e, gridId: number, rowId: number) => {
    if (!validId(gridId) || !validId(rowId)) return fail('Invalid ID')
    const row = getRow(gridId, rowId)
    if (!row) return fail('Row not found')
    return ok(row)
  })

  secureWrap(IPC.ROW_LOCATE, 'ipc-row', (_e, rowId: number) => {
    if (!validId(rowId)) return fail('Invalid ID')
    const r = cachedStmt('row_locate', `
      SELECT r.grid_id, r.is_active, r.deleted_at, r.archived_at, r.archived_reason, g.is_active AS grid_active
      FROM rows r JOIN grids g ON g.id = r.grid_id WHERE r.id = ?
    `).get(rowId) as { grid_id: number; is_active: number; deleted_at: string | null; archived_at: string | null; archived_reason: string | null; grid_active: number } | undefined
    if (!r) return ok(null)
    const status: RowLocation['status'] = r.deleted_at ? 'trash'
      : !r.grid_active ? 'list-deleted'
      : r.is_active ? 'active' : 'archived'
    return ok({ gridId: r.grid_id, status, archivedReason: status === 'archived' ? r.archived_reason : null })
  })

  secureWrap(IPC.ROW_CREATE, 'ipc-row', (_e, gridId: number) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(gridId)) return fail('Invalid ID')
    const db = getDb()
    const newRowId = db.transaction(() => {
      const maxPos = (cachedStmt('row_max_pos', 'SELECT MAX(position) as p FROM rows WHERE grid_id = ?').get(gridId) as { p: number | null }).p ?? -1
      const result = cachedStmt('row_insert', `INSERT INTO rows (grid_id, position, created_at, updated_at)
        VALUES (?, ?, datetime('now'), datetime('now'))`).run(gridId, maxPos + 1)
      assignAutoNumbers(gridId, [Number(result.lastInsertRowid)])
      return result.lastInsertRowid
    })()
    return ok(newRowId)
  })

  // ROW_SNAPSHOT_GET + ROW_RESTORE: removed — undo uses ROW_RESTORE_DELETED / ROW_HARD_DELETE

  secureWrap(IPC.ROW_DELETE, 'ipc-row', (_e, rowId: number) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(rowId)) return fail('Invalid ID')
    const db = getDb()
    const moved = db.transaction(() => {
      // Soft-delete: move to trash instead of hard delete. Already there: leave its 30 days alone.
      if (cachedStmt('row_soft_delete_v2', `UPDATE rows SET is_active = 0, deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND deleted_at IS NULL`).run(rowId).changes === 0) return false
      // Log system event on the client's activity timeline
      cachedStmt('row_sys_log', `INSERT INTO case_log (row_id, content, log_type, created_at, updated_at) VALUES (?, ?, 'system', datetime('now'), datetime('now'))`).run(rowId, `${recordWord(rowId)} moved to the Trash`)
      return true
    })()
    if (!moved) return rowState(rowId) === 'missing' ? rowGone() : ok(true)
    notifyCaseLogChanged(rowId)
    return ok(true)
  })

  secureWrap(IPC.ROW_HARD_DELETE, 'ipc-row', (_e, rowId: number) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(rowId)) return fail('Invalid ID')
    // True hard delete — restricted to recently-created rows (within 60 seconds) (the link picker's undo of a record it just made)
    const db = getDb()
    const result = db.transaction(() => {
      const row = cachedStmt('row_check_recent', "SELECT created_at FROM rows WHERE id = ? AND created_at >= datetime('now', '-60 seconds')").get(rowId) as { created_at: string } | undefined
      if (!row) {
        // Either row doesn't exist or it's too old for hard delete
        const exists = cachedStmt('row_exists', "SELECT 1 FROM rows WHERE id = ?").get(rowId)
        return exists ? fail("That can't be undone any more.") : fail('Row not found')
      }
      cachedStmt('row_hard_delete', 'DELETE FROM rows WHERE id = ?').run(rowId)
      return ok(true)
    })()
    return result
  })

  secureWrap(IPC.ROW_RESTORE_DELETED, 'ipc-row', (_e, rowId: number) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(rowId)) return fail('Invalid ID')
    const db = getDb()
    const restored = db.transaction(() => {
      // An archived record comes back archived (audit L-12)
      if (cachedStmt('row_restore_v3', `UPDATE rows SET is_active = CASE WHEN archived_at IS NULL THEN 1 ELSE 0 END, deleted_at = NULL, updated_at = datetime('now') WHERE id = ? AND deleted_at IS NOT NULL`).run(rowId).changes === 0) return false
      cachedStmt('row_sys_log', `INSERT INTO case_log (row_id, content, log_type, created_at, updated_at) VALUES (?, ?, 'system', datetime('now'), datetime('now'))`).run(rowId, `${recordWord(rowId)} restored from the Trash`)
      return true
    })()
    // Removed for good meanwhile: say so, rather than a confusing database error
    if (!restored) return rowState(rowId) === 'missing' ? rowGone() : ok(true)
    notifyCaseLogChanged(rowId)
    return ok(true)
  })

  secureWrap(IPC.ROW_PURGE, 'ipc-row', (_e, rowId: number) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(rowId)) return fail('Invalid ID')
    // Permanent hard delete — only allowed for soft-deleted rows
    // Wrapped in transaction so FK cascades are atomic
    const db = getDb()
    db.transaction(() => {
      cachedStmt('row_purge', 'DELETE FROM rows WHERE id = ? AND deleted_at IS NOT NULL').run(rowId)
    })()
    return ok(true)
  })

  // Empty Trash: every record in the Trash, for good, in one transaction (X-38)
  secureWrap(IPC.ROW_PURGE_ALL, 'ipc-row', () => {
    const guard = enforceWritable(); if (guard) return guard
    const info = getDb().transaction(() => {
      const r = getDb().prepare('DELETE FROM rows WHERE deleted_at IS NOT NULL').run()
      // Lists in the Trash go too, with their records (D1)
      getDb().prepare('DELETE FROM grids WHERE is_active = 0 AND deleted_at IS NOT NULL').run()
      return r
    })()
    return ok(info.changes)
  })

  secureWrap(IPC.ROW_GET_DELETED, 'ipc-row', () => {
    const rows = cachedStmt('row_get_deleted_v2', `
      SELECT r.id, r.grid_id, r.deleted_at, g.name AS grid_name,
             r.display_name AS client_name, g.is_active AS grid_is_active
      FROM rows r JOIN grids g ON g.id = r.grid_id
      WHERE r.deleted_at IS NOT NULL
      ORDER BY r.deleted_at DESC LIMIT 500
    `).all()
    return ok(rows)
  })

  secureWrap(IPC.ROW_ARCHIVE, 'ipc-row', (_e, rowId: number, reason?: string) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(rowId)) return fail('Invalid ID')
    if (typeof reason === 'string' && reason.length > 1000) return fail('Reason too long')
    const db = getDb()
    const archived = db.transaction(() => {
      if (cachedStmt('row_archive_v2', `
        UPDATE rows SET is_active = 0, archived_at = datetime('now'), archived_reason = ?,
        updated_at = datetime('now') WHERE id = ? AND deleted_at IS NULL
      `).run(reason ?? null, rowId).changes === 0) return false
      const logMsg = reason ? `${recordWord(rowId)} archived: ${reason}` : `${recordWord(rowId)} archived`
      cachedStmt('row_sys_log', `INSERT INTO case_log (row_id, content, log_type, created_at, updated_at) VALUES (?, ?, 'system', datetime('now'), datetime('now'))`).run(rowId, logMsg)
      return true
    })()
    if (!archived) return rowGone()
    notifyCaseLogChanged(rowId)
    return ok(true)
  })

  secureWrap(IPC.ROW_UNARCHIVE, 'ipc-row', (_e, rowId: number) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(rowId)) return fail('Invalid ID')
    const db = getDb()
    const unarchived = db.transaction(() => {
      // A record in the Trash stays there; unarchiving it would show it in search and the dashboard
      if (cachedStmt('row_unarchive_v2', `
        UPDATE rows SET is_active = 1, archived_at = NULL, archived_reason = NULL,
        updated_at = datetime('now') WHERE id = ? AND deleted_at IS NULL AND (is_active = 0 OR archived_at IS NOT NULL)
      `).run(rowId).changes === 0) return false
      cachedStmt('row_sys_log', `INSERT INTO case_log (row_id, content, log_type, created_at, updated_at) VALUES (?, ?, 'system', datetime('now'), datetime('now'))`).run(rowId, `${recordWord(rowId)} unarchived`)
      return true
    })()
    if (!unarchived) return rowState(rowId) === 'kept' ? ok(true) : rowGone()
    notifyCaseLogChanged(rowId)
    return ok(true)
  })

  secureWrap(IPC.ROW_DUPLICATE, 'ipc-row', (_e, rowId: number) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(rowId)) return fail('Invalid ID')
    const db = getDb()
    const row = cachedStmt('row_select_by_id', 'SELECT * FROM rows WHERE id = ?').get(rowId) as { id: number; grid_id: number } | undefined
    if (!row) return fail('Row not found')

    const newRowId = db.transaction(() => {
      // Create new row at end of grid
      const result = cachedStmt('row_dup_insert', `
        INSERT INTO rows (grid_id, position, is_active, is_starred, created_at, updated_at)
        VALUES (?, (SELECT COALESCE(MAX(position) + 1, 0) FROM rows WHERE grid_id = ?),
                1, 0, datetime('now'), datetime('now'))
      `).run(row.grid_id, row.grid_id)
      const id = result.lastInsertRowid as number

      // Copy all cells including the name column
      const cells = cachedStmt('row_dup_cells_all',
        'SELECT * FROM cells WHERE row_id = ?'
      ).all(rowId) as Array<{ column_id: number; value: string | null }>

      const insertCell = cachedStmt('row_dup_cell_insert',
        'INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, ?, datetime(\'now\'))'
      )
      for (const cell of cells) {
        insertCell.run(id, cell.column_id, cell.value)
      }
      // A duplicate is a new record: it gets its own number
      assignAutoNumbers(row.grid_id, [id], { overwrite: true })
      refreshDisplayNames(row.grid_id, [id])
      // Same owner, same facility… (W04 §8)
      copyForwardLinks(rowId, id)

      return id
    })()

    return ok(newRowId)
  })

  secureWrap(IPC.ROW_MOVE_TO_GRID, 'ipc-row', (_e, rowId: number, targetGridId: number) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(rowId) || !validId(targetGridId)) return fail('Invalid ID')
    const db = getDb()
    const srcRow = cachedStmt('row_select_by_id', 'SELECT * FROM rows WHERE id = ?').get(rowId) as { id: number; grid_id: number } | undefined
    if (!srcRow) return fail('Row not found')
    if (srcRow.grid_id === targetGridId) return ok(rowId)

    const mapping = buildColumnMapping(srcRow.grid_id, targetGridId)

    const maxPos = (cachedStmt('row_next_position', 'SELECT COALESCE(MAX(position)+1, 0) as p FROM rows WHERE grid_id = ?').get(targetGridId) as { p: number }).p

    const run = db.transaction(() => {
      // 1. Re-map cells and cell_history to target column IDs by matching column names
      remapCellsForMove(rowId, mapping)

      // 2. Re-map cell_formats entries — only carry rules that originated from this row
      transferCellFormats(rowId, mapping)

      // "All rows" highlights are column rules now (L-19), so nothing is stamped on other records

      // 5. Update provider_client_links to reflect new grid
      cachedStmt('row_move_provider_links', 'UPDATE provider_client_links SET grid_id = ? WHERE row_id = ?')
        .run(targetGridId, rowId)

      // 6. Clear acuity_level_id — acuity levels are grid-specific, old ID is invalid in target grid
      cachedStmt('row_move_clear_acuity', 'UPDATE rows SET acuity_level_id = NULL WHERE id = ?').run(rowId)

      // 6b. Links whose type doesn't connect the target list go (the move dialog warned)
      dropLinksThatWontFit(rowId, targetGridId)

      // 7. Move the row itself — preserves row_id so all profile data stays
      cachedStmt('row_move_grid', 'UPDATE rows SET grid_id = ?, position = ?, updated_at = datetime(\'now\') WHERE id = ?').run(targetGridId, maxPos, rowId)

      // 8. Values parked on an earlier move out of this list come back, number included
      const restoredAuto = unparkCells(rowId, targetGridId)

      // 9. Number and name it the way the target list does (keeping a number it had here before)
      assignAutoNumbers(targetGridId, [rowId], { overwrite: true, keep: restoredAuto })
      refreshDisplayNames(targetGridId, [rowId])

      return rowId
    })

    const keptRowId = run()
    return ok(keptRowId)
  })

  secureWrap(IPC.ROW_COPY_TO_GRID, 'ipc-row', (_e, rowId: number, targetGridId: number) => {
    // Same as move but always keeps source row
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(rowId) || !validId(targetGridId)) return fail('Invalid ID')
    const db = getDb()
    const srcRow = cachedStmt('row_select_by_id', 'SELECT * FROM rows WHERE id = ?').get(rowId) as { id: number; grid_id: number } | undefined
    if (!srcRow) return fail('Row not found')
    const mapping = buildColumnMapping(srcRow.grid_id, targetGridId)

    const maxPos = (cachedStmt('row_next_position', 'SELECT COALESCE(MAX(position)+1, 0) as p FROM rows WHERE grid_id = ?').get(targetGridId) as { p: number }).p
    const run = db.transaction(() => {
      const result = cachedStmt('row_copy_insert', `
        INSERT INTO rows (grid_id, position, is_active, is_starred, created_at, updated_at)
        VALUES (?, ?, 1, 0, datetime('now'), datetime('now'))
      `).run(targetGridId, maxPos)
      const newRowId = result.lastInsertRowid as number
      copyCellsToGrid(rowId, newRowId, mapping)
      assignAutoNumbers(targetGridId, [newRowId], { overwrite: true })
      refreshDisplayNames(targetGridId, [newRowId])
      return newRowId
    })
    const newRowId = run()
    return ok(newRowId)
  })

  secureWrap(IPC.ROW_REORDER, 'ipc-row', (_e, gridId: number, orderedIds: number[]) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(gridId)) return fail('Invalid ID')
    if (!Array.isArray(orderedIds) || orderedIds.length > MAX_REORDER_ROWS) return fail('Invalid reorder payload')
    if (!orderedIds.every(id => Number.isInteger(id) && id > 0)) return fail('Invalid IDs in reorder payload')
    const db = getDb()
    const cases = orderedIds.map((id, idx) => `WHEN ${Number(id)} THEN ${idx}`).join(' ')
    const idList = orderedIds.map(Number).join(',')
    const reorder = db.transaction(() => {
      db.exec(`UPDATE rows SET position = CASE id ${cases} END WHERE grid_id = ${Number(gridId)} AND id IN (${idList})`)
    })
    reorder()
    return ok(true)
  })

  secureWrap(IPC.ROW_UPDATE, 'ipc-row', (_e, rowId: number, updates: Partial<{ is_starred: number }>) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(rowId)) return fail('Invalid ID')
    const db = getDb()
    const allowed = ['is_starred'] as const
    const result = buildSafeSetClause(updates as Record<string, unknown>, allowed, ["updated_at = datetime('now')"])
    if (!result) return fail('No valid fields to update')
    db.prepare(`UPDATE rows SET ${result.setClause} WHERE id = ?`).run(...result.values, rowId)
    return ok(true)
  })

  // ── Manual Contacts ──────────────────────────────────────────────────────
  secureWrap(IPC.ROW_GET_MANUAL_CONTACTS, 'ipc-row', (_e, rowId: number) => {
    if (!validId(rowId)) return fail('Invalid ID')
    const row = cachedStmt('row_get_manual_contacts', 'SELECT manual_contacts FROM rows WHERE id = ?').get(rowId) as { manual_contacts: string | null } | undefined
    if (!row) return fail('Row not found')
    let contacts: unknown[] = []
    if (row.manual_contacts) {
      try {
        contacts = JSON.parse(row.manual_contacts)
        if (!Array.isArray(contacts)) contacts = []
      } catch (err) {
        logNonFatal('ipc-row', `ROW_GET_MANUAL_CONTACTS: corrupted JSON for row ${rowId}`, err)
        contacts = []
      }
    }
    return ok(contacts)
  })

  secureWrap(IPC.ROW_SET_MANUAL_CONTACTS, 'ipc-row', (_e, rowId: number, contacts: Array<{ type: string; label: string; value: string }>) => {
    let needsNotify = false
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(rowId)) return fail('Invalid ID')
    if (!Array.isArray(contacts) || contacts.length > 50) return fail('Invalid contacts: must be an array of at most 50 items')
    for (const c of contacts) {
      if (typeof c.type !== 'string' || typeof c.label !== 'string' || typeof c.value !== 'string') return fail('Invalid contact: each item must have type, label, and value strings')
      if (c.type.length > 50 || c.label.length > 100 || c.value.length > 500) return fail('Invalid contact: type/label/value exceed maximum lengths')
    }
    const db = getDb()
    db.transaction(() => {
      // What changed goes on the timeline, so it's in the audit trail too (R-27)
      const before = parseManualContacts((cachedStmt('row_get_manual_contacts', 'SELECT manual_contacts FROM rows WHERE id = ?').get(rowId) as { manual_contacts: string | null } | undefined)?.manual_contacts ?? null)
      cachedStmt('row_set_manual_contacts', 'UPDATE rows SET manual_contacts = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .run(JSON.stringify(contacts), rowId)
      const key = (c: { label: string; value: string }) => `${c.label}\u0000${c.value}`
      const was = new Set(before.map(key)), now = new Set(contacts.map(key))
      const lines = [
        ...contacts.filter(c => !was.has(key(c))).map(c => `Contact info added: ${c.label || c.type} ${c.value}`),
        ...before.filter(c => !now.has(key(c))).map(c => `Contact info removed: ${c.label || c.type} ${c.value}`),
      ]
      for (const line of lines) {
        cachedStmt('row_sys_log', `INSERT INTO case_log (row_id, content, log_type, created_at, updated_at) VALUES (?, ?, 'system', datetime('now'), datetime('now'))`).run(rowId, line)
      }
      if (lines.length) needsNotify = true
    })()
    if (needsNotify) notifyCaseLogChanged(rowId)
    return ok(true)
  })

  // ── Cross-grid client search ──────────────────────────────────────────────
  secureWrap(IPC.SEARCH_CLIENTS_CROSS_GRID, 'ipc-row', (_e, search: string, offset?: number) => {
    if (typeof search !== 'string' || search.length < 2) return ok([])
    const safeOffset = Math.max(0, Math.min(offset || 0, 10000))
    const rows = cachedStmt('row_search_cross_grid', `
      SELECT r.id as rowId, r.grid_id as gridId, g.name as gridName,
             r.display_name AS clientName
      FROM rows r
      JOIN grids g ON g.id = r.grid_id AND g.is_active = 1
      WHERE r.is_active = 1
        AND (r.display_name LIKE ? ESCAPE '\\'
          -- Phone numbers and emails added with "Add contact info" are found too (R-27)
          OR (r.manual_contacts IS NOT NULL AND EXISTS (
            SELECT 1 FROM json_each(CASE WHEN json_valid(r.manual_contacts) THEN r.manual_contacts ELSE '[]' END) j
            WHERE json_extract(j.value, '$.value') LIKE ? ESCAPE '\\' OR json_extract(j.value, '$.label') LIKE ? ESCAPE '\\')))
      ORDER BY r.display_name
      LIMIT 20 OFFSET ?
    `).all(...Array(3).fill(`%${search.replace(/[%_\\]/g, '\\$&')}%`), safeOffset)
    return ok(rows)
  })
}
