/**
 * ipc-grid.ts — GRID_*, COLUMN_*, SORT_* IPC handlers
 */

import { deleteLinksForGrid } from '../links'
import { IPC } from '../../shared/ipc-channels'
import { secureWrap, ok, fail, buildSafeSetClause, validId, enforceWritable, logNonFatal } from './ipc-utils'
import { getDb, buildGridQuery, cachedStmt, invalidateGridStmtCache } from '../database'
import { linkColumnSpecs, linkSpecKey } from '../../shared/links'
import { fileCountColumnIds } from '../../shared/attachments'
import type { Column, Grid, GridRow } from '../../shared/types'
import { VALID_COLUMN_TYPES, canNameRecords } from '../../shared/types'
import { columnDependents } from '../column-usage'
import { optionUsage, saveColumnOptions, OptionsError } from '../column-options'
import { invalidateColumnCache } from './ipc-cell'
import { afterColumnRenamed, hasDisplayFormat, refreshDisplayNames } from '../display-names'
import { numberExistingRows } from '../auto-number'
import { DEFAULT_AUTO_NUMBER } from '../../shared/autoNumber'

// ── IPC payload size limits ────────────────────────────────────────────────
const MAX_REORDER_GRIDS = 500
const MAX_REORDER_COLUMNS = 500

/**
 * Resolves visible/hidden columns for a grid and builds the pivot query result.
 * Computed columns (age_from_dob, calculated_days) reference a source column by ID.
 * Even if that source column is hidden, its values must be included in the pivot
 * query so the renderer can compute the derived value.
 */
function resolveGridColumns(gridId: number, showArchived: boolean): {
  columns: Column[]
  hiddenColumns: Column[]
  rows: GridRow[]
  acuityLevels: unknown[]
} {
  const allColumns = cachedStmt('grid_columns', 'SELECT * FROM columns WHERE grid_id = ? ORDER BY position')
    .all(gridId) as Column[]

  const columns = allColumns.filter(c => c.is_visible !== 0)
  const hiddenColumns = allColumns.filter(c => c.is_visible === 0)

  const neededSourceIds = new Set<number>()
  for (const col of columns) {
    if (col.column_type === 'age_from_dob' || col.column_type === 'calculated_days') {
      try {
        const cfg = JSON.parse(col.config || '{}') as { source_column_id?: number }
        if (cfg.source_column_id) neededSourceIds.add(cfg.source_column_id)
      } catch (err) { logNonFatal('ipc-grid', `Malformed column config for column ${col.id}`, err) }
    }
  }

  // Include ALL columns in the pivot query (not just visible ones)
  // so that ProfileView's GridDataSummary can show data from hidden columns.
  const queryColumnIds = allColumns.map(c => c.id)
  // Cache key includes actual column IDs (not just count) since different grids
  // with the same column count produce different SQL shapes.
  const links = linkColumnSpecs(allColumns)
  const fileCounts = fileCountColumnIds(allColumns)
  const pivotKey = `pivot_${queryColumnIds.join('_')}_${showArchived ? 'a' : 'i'}_${linkSpecKey(links)}_${fileCounts.join('_')}`
  const rows = queryColumnIds.length > 0
    ? cachedStmt(pivotKey, buildGridQuery(queryColumnIds, showArchived, links, fileCounts)).all(gridId) as GridRow[]
    : []

  const acuityLevels = cachedStmt('grid_acuity', 'SELECT * FROM acuity_levels WHERE grid_id = ? ORDER BY position')
    .all(gridId)

  return { columns, hiddenColumns, rows, acuityLevels }
}

export function registerGridHandlers(): void {
  // ── Grids ─────────────────────────────────────────────────────────────────
  secureWrap(IPC.GRID_GET_ALL, 'ipc-grid', () => {
    const grids = cachedStmt('grid_get_all_v2', `
      SELECT id, name, description, created_at, updated_at, sort_config,
             filter_config, column_order, frozen_columns, row_height,
             show_gridlines, show_row_numbers, show_alternating_rows,
             position, is_active, acuity_enabled, record_kind, display_format
      FROM grids WHERE is_active = 1 ORDER BY position, id
    `).all() as Grid[]
    return ok(grids)
  })

  secureWrap(IPC.GRID_GET, 'ipc-grid', (_e, gridId: number, showArchived = false) => {
    if (!validId(gridId)) return fail('Invalid ID')
    const grid = cachedStmt('grid_by_id', 'SELECT * FROM grids WHERE id = ?').get(gridId) as Grid | undefined
    if (!grid) return fail('That list no longer exists. It may have been deleted.')

    const { columns, hiddenColumns, rows, acuityLevels } = resolveGridColumns(gridId, showArchived)

    return ok({ grid, columns, hiddenColumns, rows, acuityLevels })
  })

  secureWrap(IPC.GRID_GET_FULL, 'ipc-grid', (_e, gridId: number, showArchived = false) => {
    if (!validId(gridId)) return fail('Invalid ID')
    const db = getDb()
    const grid = cachedStmt('grid_by_id', 'SELECT * FROM grids WHERE id = ?').get(gridId) as import('../../shared/types').Grid | undefined
    if (!grid) return fail('That list no longer exists. It may have been deleted.')

    const { columns, hiddenColumns, rows, acuityLevels } = resolveGridColumns(gridId, showArchived)

    // Cell formats
    const cellFormats = cachedStmt('cell_format_get_for_grid', `
      SELECT cf.row_id, cf.column_id, cf.rules
      FROM cell_formats cf
      JOIN rows r ON r.id = cf.row_id
      WHERE r.grid_id = ?
    `).all(gridId) as { row_id: number; column_id: number; rules: string }[]

    // Row tags map
    const tagRows = cachedStmt('grid_row_tags', `
      SELECT rt.row_id, t.name
      FROM row_tags rt
      JOIN tags t ON t.id = rt.tag_id
      JOIN rows r ON r.id = rt.row_id
      WHERE r.grid_id = ?
      ORDER BY rt.row_id, t.name
    `).all(gridId) as { row_id: number; name: string }[]
    const rowTagsMap: Record<number, string[]> = {}
    for (const r of tagRows) {
      if (!rowTagsMap[r.row_id]) rowTagsMap[r.row_id] = []
      rowTagsMap[r.row_id]!.push(r.name)
    }

    // Saved views
    const savedViews = cachedStmt('saved_views_by_grid', 'SELECT * FROM saved_views WHERE grid_id = ? ORDER BY name ASC').all(gridId)

    // Custom groups (stored in settings table)
    const customGroupsRow = db.prepare('SELECT value FROM settings WHERE key = ?').get(`custom_groups_${gridId}`) as { value: string } | undefined
    const customGroups = customGroupsRow?.value ?? null

    // Made-up sample entries, so the list can mark them (audit 2.6)
    const sampleRows: Record<number, number> = {}
    for (const s of cachedStmt('grid_sample_rows', 'SELECT s.row_id, s.asked FROM sample_rows s JOIN rows r ON r.id = s.row_id WHERE r.grid_id = ?')
      .all(gridId) as Array<{ row_id: number; asked: number }>) sampleRows[s.row_id] = s.asked

    return ok({ grid, columns, hiddenColumns, rows, acuityLevels, cellFormats, rowTagsMap, savedViews, customGroups, sampleRows })
  })

  secureWrap(IPC.GRID_CREATE, 'ipc-grid', (_e, name: string) => {
    const guard = enforceWritable(); if (guard) return guard
    if (typeof name !== 'string' || name.trim().length === 0 || name.length > 200) return fail('Invalid grid name')
    const db = getDb()
    const doCreate = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO grids (name, created_at, updated_at)
        VALUES (?, datetime('now'), datetime('now'))
      `).run(name)

      const gridId = result.lastInsertRowid as number

      // Create a default "Name" column
      db.prepare(`
        INSERT INTO columns (grid_id, name, column_type, position, is_name_column, is_identifier, width)
        VALUES (?, 'Name', 'text', 0, 1, 1, 200)
      `).run(gridId)

      return gridId
    })
    return ok(doCreate())
  })

  secureWrap(IPC.GRID_UPDATE, 'ipc-grid', (_e, gridId: number, updates: Partial<Grid>) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(gridId)) return fail('Invalid ID')
    const stringFields = ['sort_config', 'filter_config', 'column_order', 'name', 'description'] as const
    for (const field of stringFields) {
      const val = (updates as Record<string, unknown>)[field]
      if (val !== undefined && typeof val === 'string' && val.length > 500_000) return fail(`${field} value too large`)
    }
    const allowed = ['name', 'description', 'sort_config', 'filter_config',
      'column_order', 'frozen_columns', 'row_height', 'show_gridlines', 'show_row_numbers', 'show_alternating_rows'] as const
    const result = buildSafeSetClause(updates as Record<string, unknown>, allowed, ["updated_at = datetime('now')"])
    if (!result) return fail('No valid fields to update')

    getDb().prepare(`UPDATE grids SET ${result.setClause} WHERE id = ?`)
      .run(...result.values, gridId)
    return ok(true)
  })

  secureWrap(IPC.GRID_DELETE, 'ipc-grid', (_e, gridId: number) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(gridId)) return fail('Invalid ID')
    // Soft delete — mark inactive. Links to other lists go with it (W04 §8; the dialog said how many)
    getDb().transaction(() => {
      deleteLinksForGrid(gridId)
      getDb().prepare("UPDATE grids SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(gridId)
    })()
    invalidateGridStmtCache()
    return ok(true)
  })

  secureWrap(IPC.GRID_REORDER, 'ipc-grid', (_e, orderedIds: number[]) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!Array.isArray(orderedIds) || orderedIds.length > MAX_REORDER_GRIDS) return fail('Invalid reorder payload')
    if (!orderedIds.every(id => Number.isInteger(id) && id > 0)) return fail('Invalid IDs in reorder payload')
    const db = getDb()
    const update = db.prepare("UPDATE grids SET position = ? WHERE id = ?")
    const run = db.transaction(() => {
      orderedIds.forEach((id, idx) => update.run(idx, id))
    })
    run()
    return ok(true)
  })

  // ── Columns ───────────────────────────────────────────────────────────────
  secureWrap(IPC.COLUMN_CREATE, 'ipc-grid', (_e, gridId: number, name: string, columnType: string) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(gridId)) return fail('Invalid ID')
    if (typeof name !== 'string' || name.trim().length === 0 || name.length > 200) return fail('Invalid column name')
    if (!VALID_COLUMN_TYPES.has(columnType as never)) return fail(`Invalid column type: ${columnType}`)
    if (columnType === 'link') return fail('Use "Link to another list" to add a link column.')
    const db = getDb()
    const createColumn = db.transaction(() => {
      const maxPos = (db.prepare('SELECT MAX(position) as p FROM columns WHERE grid_id = ?').get(gridId) as { p: number | null }).p ?? -1
      const result = db.prepare(`
        INSERT INTO columns (grid_id, name, column_type, position, config, created_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `).run(gridId, name, columnType, maxPos + 1, columnType === 'auto_number' ? JSON.stringify(DEFAULT_AUTO_NUMBER) : '{}')
      return result.lastInsertRowid
    })
    const lastId = createColumn()
    invalidateGridStmtCache()
    return ok(lastId)
  })

  secureWrap(IPC.COLUMN_UPDATE, 'ipc-grid', (_e, columnId: number, updates: Partial<Column>) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(columnId)) return fail('Invalid ID')
    if ((updates as Record<string, unknown>)['config'] !== undefined) {
      const cfg = (updates as Record<string, unknown>)['config']
      if (typeof cfg === 'string' && cfg.length > 100_000) return fail('Config too large')
    }
    if ((updates as Record<string, unknown>)['conditional_format'] !== undefined) {
      const cf = (updates as Record<string, unknown>)['conditional_format']
      if (typeof cf === 'string' && cf.length > 100_000) return fail('Conditional format config too large')
    }
    if (updates.column_type && !VALID_COLUMN_TYPES.has(updates.column_type as never)) {
      return fail('Invalid column type')
    }
    // A link column's settings come from its link; nothing converts to or from one
    if (updates.column_type !== undefined) {
      const cur = getDb().prepare('SELECT column_type FROM columns WHERE id = ?').get(columnId) as { column_type: string } | undefined
      if ((updates.column_type === 'link') !== (cur?.column_type === 'link') && cur) return fail('Link columns can\'t be changed to another type, or made from one.')
      if ((updates.column_type === 'file_count') !== (cur?.column_type === 'file_count') && cur) return fail('A Files column can\'t be changed to another type, or made from one. Add a new column instead.')
    }
    // Existing values wouldn't be in sequence; numbering starts with a new column
    if (updates.column_type === 'auto_number') {
      const cur = getDb().prepare('SELECT column_type FROM columns WHERE id = ?').get(columnId) as { column_type: string } | undefined
      if (cur && cur.column_type !== 'auto_number') return fail('To number each one automatically, add a new auto-number column.')
    }
    const allowed = ['name', 'column_type', 'width', 'position', 'is_visible',
      'is_required', 'is_identifier', 'default_value', 'description', 'config', 'conditional_format'] as const
    const result = buildSafeSetClause(updates as Record<string, unknown>, allowed)
    if (!result) return fail('No valid fields to update')

    const db = getDb()
    const before = db.prepare('SELECT grid_id, name FROM columns WHERE id = ?').get(columnId) as { grid_id: number; name: string } | undefined
    db.transaction(() => {
      db.prepare(`UPDATE columns SET ${result.setClause} WHERE id = ?`).run(...result.values, columnId)
      if (before && typeof updates.name === 'string' && updates.name !== before.name) afterColumnRenamed(before.grid_id, before.name, updates.name)
    })()
    invalidateColumnCache(columnId)
    return ok(true)
  })

  secureWrap(IPC.COLUMN_BATCH_UPDATE_VISIBILITY, 'ipc-grid', (_e, updates: { columnId: number; isVisible: 0 | 1 }[]) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!Array.isArray(updates) || updates.length === 0 || updates.length > 500) return fail('Invalid visibility payload')
    if (!updates.every(u => Number.isInteger(u.columnId) && u.columnId > 0 && (u.isVisible === 0 || u.isVisible === 1))) {
      return fail('Invalid visibility entry — each must have integer columnId and isVisible 0|1')
    }
    const db = getDb()
    const stmt = cachedStmt('col_batch_vis', 'UPDATE columns SET is_visible = ? WHERE id = ?')
    const run = db.transaction(() => {
      for (const u of updates) {
        stmt.run(u.isVisible, u.columnId)
      }
    })
    run()
    return ok(true)
  })

  secureWrap(IPC.COLUMN_BATCH_UPDATE_WIDTHS, 'ipc-grid', (_e, updates: { columnId: number; width: number }[]) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!Array.isArray(updates) || updates.length === 0 || updates.length > 500) return fail('Invalid width update payload')
    if (!updates.every(u => Number.isInteger(u.columnId) && u.columnId > 0 && typeof u.width === 'number' && u.width > 0)) {
      return fail('Invalid width entry — each must have integer columnId and positive width')
    }
    if (updates.some(u => u.width > 2000)) {
      return fail('Column width exceeds maximum (2000px)')
    }
    const db = getDb()
    const stmt = cachedStmt('col_batch_width', 'UPDATE columns SET width = ? WHERE id = ?')
    const run = db.transaction(() => {
      for (const u of updates) {
        stmt.run(Math.round(u.width), u.columnId)
      }
    })
    run()
    return ok(true)
  })

  secureWrap(IPC.COLUMN_DELETE, 'ipc-grid', (_e, columnId: number) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(columnId)) return fail('Invalid ID')
    const db = getDb()
    const col = db.prepare('SELECT id, grid_id, is_name_column FROM columns WHERE id = ?').get(columnId) as
      { id: number; grid_id: number; is_name_column: number } | undefined
    if (!col) return fail('Column not found')

    const doDelete = db.transaction(() => {
      if (col.is_name_column === 1) {
        // Another column takes over naming: a text column if there is one, else the first
        const other = db.prepare(
          "SELECT id FROM columns WHERE grid_id = ? AND id != ? ORDER BY (column_type = 'text') DESC, position LIMIT 1"
        ).get(col.grid_id, columnId) as { id: number } | undefined
        if (!other) {
          throw new Error('Cannot delete the only column in this grid.')
        }
        db.prepare('UPDATE columns SET is_name_column = 1 WHERE id = ?').run(other.id)
      }
      // Cascade deletes cells via FK
      db.prepare('DELETE FROM columns WHERE id = ?').run(columnId)
      // Names elsewhere (dashboard, search, links) come from rows.display_name, which no trigger updates here
      if (col.is_name_column === 1 || hasDisplayFormat(col.grid_id)) refreshDisplayNames(col.grid_id)
    })
    doDelete()
    invalidateGridStmtCache()
    invalidateColumnCache(columnId)
    return ok(true)
  })

  // Everything that points at this column, for the delete dialog (audit 1.8)
  secureWrap(IPC.COLUMN_DEPENDENTS, 'ipc-grid', (_e, columnId: number) => {
    if (!validId(columnId)) return fail('Invalid ID')
    return ok(columnDependents(columnId))
  })

  // "Use as name": this column names the list's records everywhere
  secureWrap(IPC.COLUMN_SET_NAME, 'ipc-grid', (_e, columnId: number) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(columnId)) return fail('Invalid ID')
    const db = getDb()
    const col = db.prepare('SELECT id, grid_id, column_type FROM columns WHERE id = ?').get(columnId) as { id: number; grid_id: number; column_type: string } | undefined
    if (!col) return fail('Column not found')
    if (!canNameRecords(col.column_type)) return fail("This kind of column can't be used as the name.")
    const prev = db.prepare('SELECT id FROM columns WHERE grid_id = ? AND is_name_column = 1').get(col.grid_id) as { id: number } | undefined
    db.transaction(() => {
      db.prepare('UPDATE columns SET is_name_column = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE grid_id = ?').run(columnId, col.grid_id)
      refreshDisplayNames(col.grid_id)
    })()
    invalidateGridStmtCache()
    return ok({ previousId: prev?.id ?? null })
  })

  // How many records use each choice, for the options editor (G-36)
  secureWrap(IPC.COLUMN_OPTION_USAGE, 'ipc-grid', (_e, columnId: number) => {
    if (!validId(columnId)) return fail('Invalid ID')
    return ok(optionUsage(columnId))
  })

  // Save a status or dropdown column's choices; renamed ones can carry their records along (G-02, G-36)
  secureWrap(IPC.COLUMN_SET_OPTIONS, 'ipc-grid', (_e, columnId: number, change: { options: string[]; renames?: Record<string, string>; updateRecords?: boolean }) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(columnId)) return fail('Invalid ID')
    if (!change || !Array.isArray(change.options)) return fail('Choose the options first.')
    if (change.renames !== undefined && (typeof change.renames !== 'object' || change.renames === null)) return fail('Invalid rename list')
    try {
      const res = saveColumnOptions(columnId, change)
      invalidateColumnCache(columnId)
      return ok(res)
    } catch (err) {
      if (err instanceof OptionsError) return fail(err.message)
      throw err
    }
  })

  // After adding an auto-number column: give the records already in the list a number
  secureWrap(IPC.COLUMN_NUMBER_EXISTING, 'ipc-grid', (_e, columnId: number) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(columnId)) return fail('Invalid ID')
    const isAuto = getDb().prepare("SELECT 1 FROM columns WHERE id = ? AND column_type = 'auto_number'").get(columnId)
    if (!isAuto) return fail("That column doesn't number automatically.")
    return ok({ numbered: numberExistingRows(columnId) })
  })

  secureWrap(IPC.COLUMN_REORDER, 'ipc-grid', (_e, gridId: number, orderedIds: number[]) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(gridId)) return fail('Invalid ID')
    if (!Array.isArray(orderedIds) || orderedIds.length > MAX_REORDER_COLUMNS) return fail('Invalid reorder payload')
    if (!orderedIds.every(id => Number.isInteger(id) && id > 0)) return fail('Invalid IDs in reorder payload')
    const db = getDb()
    const stmt = cachedStmt('col_reorder', 'UPDATE columns SET position = ? WHERE id = ? AND grid_id = ?')
    const reorder = db.transaction(() => {
      for (let i = 0; i < orderedIds.length; i++) {
        stmt.run(i, orderedIds[i], gridId)
      }
    })
    reorder()
    return ok(true)
  })

  // ── Sort & Filter ─────────────────────────────────────────────────────────
  secureWrap(IPC.SORT_UPDATE, 'ipc-grid', (_e, gridId: number, sortConfig: unknown) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(gridId)) return fail('Invalid ID')
    // Validate sortConfig: must be an array or null
    if (sortConfig !== null && !Array.isArray(sortConfig)) {
      return fail('Sort config must be an array or null')
    }
    if (Array.isArray(sortConfig)) {
      for (const item of sortConfig) {
        if (typeof item !== 'object' || item === null) return fail('Invalid sort config')
        if (!validId((item as Record<string, unknown>).columnId)) return fail('Invalid sort column')
        const dir = (item as Record<string, unknown>).direction
        if (dir !== 'asc' && dir !== 'desc') return fail('Invalid sort direction')
      }
    }
    getDb().prepare("UPDATE grids SET sort_config = ? WHERE id = ?")
      .run(JSON.stringify(sortConfig ?? []), gridId)
    return ok(true)
  })

  secureWrap(IPC.SORT_CLEAR, 'ipc-grid', (_e, gridId: number) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(gridId)) return fail('Invalid ID')
    getDb().prepare("UPDATE grids SET sort_config = '[]' WHERE id = ?").run(gridId)
    return ok(true)
  })
}
