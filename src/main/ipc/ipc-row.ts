/**
 * ipc-row.ts — ROW_* IPC handlers
 */

import { copyForwardLinks, dropLinksThatWontFit } from '../links'
import { IPC } from '../../shared/ipc-channels'
import { secureWrap, logNonFatal, ok, fail, buildSafeSetClause, validId, notifyCaseLogChanged, enforceWritable } from './ipc-utils'
import { getDb, getRow, cachedStmt } from '../database'
import { logger } from '../logger'
import { word } from '../vocab'
import { refreshDisplayNames } from '../display-names'
import { assignAutoNumbers } from '../auto-number'

// ── IPC payload size limits ────────────────────────────────────────────────
const MAX_REORDER_ROWS = 5000
const MAX_BULK_ROW_ACTION = 1000
const ALLOWED_BULK_ACTIONS = new Set(['archive', 'unarchive', 'delete'])

// ── Shared column-mapping helpers ─────────────────────────────────────────

interface ColumnMapping {
  srcColMap: Map<number, string>  // source column id → name
  tgtMap: Map<string, number>     // lowercase target column name → target column id
}

/** Build bidirectional column-name maps between two grids. */
function buildColumnMapping(srcGridId: number, tgtGridId: number): ColumnMapping {
  const srcCols = cachedStmt('row_col_map_select', 'SELECT id, name FROM columns WHERE grid_id = ?').all(srcGridId) as { id: number; name: string }[]
  const tgtCols = cachedStmt('row_col_map_select', 'SELECT id, name FROM columns WHERE grid_id = ?').all(tgtGridId) as { id: number; name: string }[]
  return {
    srcColMap: new Map(srcCols.map(c => [c.id, c.name])),
    tgtMap: new Map(tgtCols.map(c => [c.name.toLowerCase(), c.id])),
  }
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
    const colName = mapping.srcColMap.get(cell.column_id)
    if (!colName) continue
    const tgtColId = mapping.tgtMap.get(colName.toLowerCase())
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
    const tgtColId = mapping.tgtMap.get(colName.toLowerCase())
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
            const srcColName = mapping.srcColMap.get(r.sourceColumnId)
            if (srcColName) {
              const mapped = mapping.tgtMap.get(srcColName.toLowerCase())
              if (mapped != null) updated.sourceColumnId = mapped
            }
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

/** Stamp "all rows" cell_format rules from a moved row onto existing rows in the target grid. */
function stampCellFormatsOnTarget(
  rowId: number,
  targetGridId: number,
): void {
  const tgtRows = cachedStmt('row_tgt_grid_ids', 'SELECT id FROM rows WHERE grid_id = ? AND id != ? LIMIT 2001').all(targetGridId, rowId) as { id: number }[]
  if (tgtRows.length > 2000) {
    logger.warn('ipc-row', 'ROW_MOVE_TO_GRID: target grid has >2000 rows, skipping cell_format stamping')
    return
  }
  if (tgtRows.length === 0) return

  const movedFmts = cachedStmt('row_cellfmt_colrules', 'SELECT column_id, rules FROM cell_formats WHERE row_id = ?').all(rowId) as { column_id: number; rules: string }[]
  const insertOrReplace = cachedStmt('row_cellfmt_upsert', 'INSERT OR REPLACE INTO cell_formats (row_id, column_id, rules) VALUES (?, ?, ?)')
  const selectFmt = cachedStmt('row_cellfmt_get_rules', 'SELECT rules FROM cell_formats WHERE row_id = ? AND column_id = ?')
  for (const mf of movedFmts) {
    try {
      const parsed = JSON.parse(mf.rules) as Array<{ originRowId?: number }>
      // Only stamp rules that have originRowId (i.e., "all rows" scope)
      const allRowsRules = parsed.filter(r => r.originRowId != null)
      if (allRowsRules.length === 0) continue
      const rulesJson = JSON.stringify(allRowsRules)

      // Batch-read existing formats (reuse prepared stmt instead of re-preparing per row)
      const existingMap = new Map<number, string>()
      for (const tr of tgtRows) {
        const existing = selectFmt.get(tr.id, mf.column_id) as { rules: string } | undefined
        if (existing) existingMap.set(tr.id, existing.rules)
      }

      // Batch-write merged rules
      for (const tr of tgtRows) {
        const existingJson = existingMap.get(tr.id)
        if (existingJson) {
          try {
            const existingRules = JSON.parse(existingJson) as Array<Record<string, unknown>>
            const mergedJson = JSON.stringify([...existingRules, ...allRowsRules])
            if (mergedJson.length > 50_000) {
              logger.warn('ipc-row', `ROW_MOVE_TO_GRID: merged cell_formats for row ${tr.id}, col ${mf.column_id} exceeds 50KB (${mergedJson.length}), skipping`)
              continue
            }
            insertOrReplace.run(tr.id, mf.column_id, mergedJson)
          } catch (e) {
            logger.warn('ipc-row', `ROW_MOVE_TO_GRID: failed to parse existing cell_formats for row ${tr.id}, col ${mf.column_id}`, e)
            insertOrReplace.run(tr.id, mf.column_id, rulesJson)
          }
        } else {
          insertOrReplace.run(tr.id, mf.column_id, rulesJson)
        }
      }
    } catch (e) { logger.warn('ipc-row', 'ROW_MOVE_TO_GRID: failed to process moved cell_formats for stamping', e) }
  }
}

/** Remove cell_format rules originated by rowId from sibling rows in the source grid. */
function cleanupSourceSiblings(
  rowId: number,
  sourceGridId: number,
): void {
  const siblingFmts = cachedStmt('row_cellfmt_siblings', `
    SELECT cf.row_id, cf.column_id, cf.rules
    FROM cell_formats cf
    JOIN rows r ON r.id = cf.row_id
    WHERE r.grid_id = ? AND cf.row_id != ?
  `).all(sourceGridId, rowId) as { row_id: number; column_id: number; rules: string }[]
  const deleteFmt = cachedStmt('row_cellfmt_delete', 'DELETE FROM cell_formats WHERE row_id = ? AND column_id = ?')
  const updateFmt = cachedStmt('row_cellfmt_update_rules', 'UPDATE cell_formats SET rules = ? WHERE row_id = ? AND column_id = ?')
  for (const sf of siblingFmts) {
    try {
      const parsed = JSON.parse(sf.rules) as Array<{ originRowId?: number }>
      const filtered = parsed.filter(r => r.originRowId !== rowId)
      if (filtered.length === 0) {
        deleteFmt.run(sf.row_id, sf.column_id)
      } else if (filtered.length < parsed.length) {
        updateFmt.run(JSON.stringify(filtered), sf.row_id, sf.column_id)
      }
    } catch (e) { logger.warn('ipc-row', `ROW_MOVE_TO_GRID: failed to clean up sibling cell_formats for row ${sf.row_id}`, e) }
  }
}

/** Re-map existing cells and cell_history in-place for a row being moved between grids. */
function remapCellsForMove(
  rowId: number,
  mapping: ColumnMapping,
): void {
  // Re-map cells
  const srcCells = cachedStmt('row_remap_cells_select', 'SELECT id, column_id, value FROM cells WHERE row_id = ?').all(rowId) as { id: number; column_id: number; value: string | null }[]
  const updateCell = cachedStmt('row_remap_cell_col', 'UPDATE cells SET column_id = ? WHERE id = ?')
  const deleteCell = cachedStmt('row_remap_cell_delete', 'DELETE FROM cells WHERE id = ?')
  for (const cell of srcCells) {
    const colName = mapping.srcColMap.get(cell.column_id)
    if (!colName) { deleteCell.run(cell.id); continue }
    const tgtColId = mapping.tgtMap.get(colName.toLowerCase())
    if (tgtColId !== undefined) {
      updateCell.run(tgtColId, cell.id)
    } else {
      deleteCell.run(cell.id)
    }
  }

  // Re-map cell_history entries
  const srcHistCells = cachedStmt('row_remap_hist_select', 'SELECT id, column_id FROM cell_history WHERE row_id = ?').all(rowId) as { id: number; column_id: number }[]
  const updateHist = cachedStmt('row_remap_hist_col', 'UPDATE cell_history SET column_id = ? WHERE id = ?')
  const deleteHist = cachedStmt('row_remap_hist_delete', 'DELETE FROM cell_history WHERE id = ?')
  for (const h of srcHistCells) {
    const colName = mapping.srcColMap.get(h.column_id)
    if (!colName) { deleteHist.run(h.id); continue }
    const tgtColId = mapping.tgtMap.get(colName.toLowerCase())
    if (tgtColId !== undefined) {
      updateHist.run(tgtColId, h.id)
    } else {
      deleteHist.run(h.id)
    }
  }
}

function gridOfRow(rowId: number): number | null {
  const row = cachedStmt('row_grid_of', 'SELECT grid_id FROM rows WHERE id = ?').get(rowId) as { grid_id: number } | undefined
  return row?.grid_id ?? null
}

/** "Client" / "Vehicle"… for this row's list, for system entries in its activity log */
function recordWord(rowId: number): string {
  return word('record', { cap: true }, gridOfRow(rowId))
}

export function registerRowHandlers(): void {
  secureWrap(IPC.ROW_BULK_ACTION, 'ipc-row', (_e, action: 'archive' | 'unarchive' | 'delete', rowIds: number[]) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!ALLOWED_BULK_ACTIONS.has(action)) return fail(`Invalid bulk action: ${action}`)
    if (!Array.isArray(rowIds) || rowIds.length === 0) return fail('No rows specified')
    if (rowIds.length > MAX_BULK_ROW_ACTION) return fail(`Bulk action limited to ${MAX_BULK_ROW_ACTION} rows`)
    if (!rowIds.every(id => Number.isInteger(id) && id > 0)) return fail('Invalid row IDs')
    const db = getDb()
    const logStmt = cachedStmt('row_sys_log', `INSERT INTO case_log (row_id, content, log_type, created_at, updated_at) VALUES (?, ?, 'system', datetime('now'), datetime('now'))`)
    const run = db.transaction(() => {
      if (action === 'archive') {
        const stmt = cachedStmt('row_bulk_archive', `
          UPDATE rows SET is_active = 0, archived_at = datetime('now'),
          archived_reason = 'Bulk action', updated_at = datetime('now') WHERE id = ?
        `)
        rowIds.forEach(id => {
          stmt.run(id)
          logStmt.run(id, `${recordWord(id)} archived: Bulk action`)
        })
      } else if (action === 'unarchive') {
        const stmt = cachedStmt('row_bulk_unarchive', `
          UPDATE rows SET is_active = 1, archived_at = NULL, archived_reason = NULL,
          updated_at = datetime('now') WHERE id = ?
        `)
        rowIds.forEach(id => {
          stmt.run(id)
          logStmt.run(id, `${recordWord(id)} unarchived`)
        })
      } else if (action === 'delete') {
        const stmt = cachedStmt('row_bulk_delete', `
          UPDATE rows SET is_active = 0, deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?
        `)
        rowIds.forEach(id => {
          stmt.run(id)
          logStmt.run(id, `${recordWord(id)} moved to trash`)
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
    db.transaction(() => {
      // Soft-delete: move to trash instead of hard delete
      cachedStmt('row_soft_delete', `UPDATE rows SET is_active = 0, deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(rowId)
      // Log system event on the client's activity timeline
      cachedStmt('row_sys_log', `INSERT INTO case_log (row_id, content, log_type, created_at, updated_at) VALUES (?, ?, 'system', datetime('now'), datetime('now'))`).run(rowId, `${recordWord(rowId)} moved to trash`)
    })()
    notifyCaseLogChanged(rowId)
    return ok(true)
  })

  secureWrap(IPC.ROW_HARD_DELETE, 'ipc-row', (_e, rowId: number) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(rowId)) return fail('Invalid ID')
    // True hard delete — restricted to recently-created rows (within 60 seconds) for undo of addRow/duplicateRow
    const db = getDb()
    const result = db.transaction(() => {
      const row = cachedStmt('row_check_recent', "SELECT created_at FROM rows WHERE id = ? AND created_at >= datetime('now', '-60 seconds')").get(rowId) as { created_at: string } | undefined
      if (!row) {
        // Either row doesn't exist or it's too old for hard delete
        const exists = cachedStmt('row_exists', "SELECT 1 FROM rows WHERE id = ?").get(rowId)
        return exists ? fail('Hard delete only allowed for recently-created rows') : fail('Row not found')
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
    db.transaction(() => {
      // An archived record comes back archived (audit L-12)
      cachedStmt('row_restore_v2', `UPDATE rows SET is_active = CASE WHEN archived_at IS NULL THEN 1 ELSE 0 END, deleted_at = NULL, updated_at = datetime('now') WHERE id = ?`).run(rowId)
      cachedStmt('row_sys_log', `INSERT INTO case_log (row_id, content, log_type, created_at, updated_at) VALUES (?, ?, 'system', datetime('now'), datetime('now'))`).run(rowId, `${recordWord(rowId)} restored from trash`)
    })()
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
    db.transaction(() => {
      cachedStmt('row_archive', `
        UPDATE rows SET is_active = 0, archived_at = datetime('now'), archived_reason = ?,
        updated_at = datetime('now') WHERE id = ?
      `).run(reason ?? null, rowId)
      const logMsg = reason ? `${recordWord(rowId)} archived: ${reason}` : `${recordWord(rowId)} archived`
      cachedStmt('row_sys_log', `INSERT INTO case_log (row_id, content, log_type, created_at, updated_at) VALUES (?, ?, 'system', datetime('now'), datetime('now'))`).run(rowId, logMsg)
    })()
    notifyCaseLogChanged(rowId)
    return ok(true)
  })

  secureWrap(IPC.ROW_UNARCHIVE, 'ipc-row', (_e, rowId: number) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(rowId)) return fail('Invalid ID')
    const db = getDb()
    db.transaction(() => {
      cachedStmt('row_unarchive', `
        UPDATE rows SET is_active = 1, archived_at = NULL, archived_reason = NULL,
        updated_at = datetime('now') WHERE id = ?
      `).run(rowId)
      cachedStmt('row_sys_log', `INSERT INTO case_log (row_id, content, log_type, created_at, updated_at) VALUES (?, ?, 'system', datetime('now'), datetime('now'))`).run(rowId, `${recordWord(rowId)} unarchived`)
    })()
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

      // 3. Stamp "all rows" rules onto existing rows in the target grid
      stampCellFormatsOnTarget(rowId, targetGridId)

      // 4. Clean up cell_formats on sibling rows in the source grid that were stamped by this row
      cleanupSourceSiblings(rowId, srcRow.grid_id)

      // 5. Update provider_client_links to reflect new grid
      cachedStmt('row_move_provider_links', 'UPDATE provider_client_links SET grid_id = ? WHERE row_id = ?')
        .run(targetGridId, rowId)

      // 6. Clear acuity_level_id — acuity levels are grid-specific, old ID is invalid in target grid
      cachedStmt('row_move_clear_acuity', 'UPDATE rows SET acuity_level_id = NULL WHERE id = ?').run(rowId)

      // 6b. Links whose type doesn't connect the target list go (the move dialog warned)
      dropLinksThatWontFit(rowId, targetGridId)

      // 7. Move the row itself — preserves row_id so all profile data stays
      cachedStmt('row_move_grid', 'UPDATE rows SET grid_id = ?, position = ?, updated_at = datetime(\'now\') WHERE id = ?').run(targetGridId, maxPos, rowId)

      // 8. Number and name it the way the target list does
      assignAutoNumbers(targetGridId, [rowId], { overwrite: true })
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
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(rowId)) return fail('Invalid ID')
    if (!Array.isArray(contacts) || contacts.length > 50) return fail('Invalid contacts: must be an array of at most 50 items')
    for (const c of contacts) {
      if (typeof c.type !== 'string' || typeof c.label !== 'string' || typeof c.value !== 'string') return fail('Invalid contact: each item must have type, label, and value strings')
      if (c.type.length > 50 || c.label.length > 100 || c.value.length > 500) return fail('Invalid contact: type/label/value exceed maximum lengths')
    }
    cachedStmt('row_set_manual_contacts', 'UPDATE rows SET manual_contacts = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(JSON.stringify(contacts), rowId)
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
      JOIN grids g ON g.id = r.grid_id
      WHERE r.is_active = 1
        AND r.display_name LIKE ? ESCAPE '\'
      ORDER BY r.display_name
      LIMIT 20 OFFSET ?
    `).all(`%${search.replace(/[%_\\]/g, '\\$&')}%`, safeOffset)
    return ok(rows)
  })
}
