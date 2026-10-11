/**
 * Keeps rows.display_name in step with a list's display format
 * (plans/generalization/W02-list-kinds.md §3).
 *
 * Lists without a format keep the trigger-maintained name from migration 017
 * (name column + a "last name" column). Lists with one get their names
 * computed here, after every write that can change them. The triggers still
 * fire first on name-column writes, so these calls must come after the write.
 */
import { getDb, cachedStmt } from './database'
import { formatTokens, renderDisplayFormat } from '../shared/displayFormat'

const UNNAMED = '(unnamed)'
// SQLite's default limit on bound parameters is far above this; keeps IN (...) small
const CHUNK = 500

// The trigger-style name (name column + a "last name" column); same expression as migration 024
const DEFAULT_NAME_UPDATE = `
  UPDATE rows SET display_name = COALESCE(
    (SELECT
      CASE WHEN last_c.value IS NOT NULL AND TRIM(last_c.value) != ''
        THEN TRIM(COALESCE(fn_c.value, '')) || ' ' || TRIM(last_c.value)
        ELSE TRIM(fn_c.value)
      END
     FROM cells fn_c
     JOIN columns fn_col ON fn_col.id = fn_c.column_id
       AND fn_col.grid_id = rows.grid_id AND fn_col.is_name_column = 1
     LEFT JOIN columns last_col ON last_col.grid_id = rows.grid_id
       AND last_col.id != fn_col.id AND last_col.is_visible = 1
       AND LOWER(TRIM(last_col.name)) IN ('last','last name','lastname','surname','family name','lname')
     LEFT JOIN cells last_c ON last_c.row_id = rows.id AND last_c.column_id = last_col.id
     WHERE fn_c.row_id = rows.id
     LIMIT 1),
    '${UNNAMED}')`

/** Whether a column by this name is the "last name" the default name adds (same names as the SQL above) */
export function isLastNameColumnName(name: string): boolean {
  return ['last', 'last name', 'lastname', 'surname', 'family name', 'lname'].includes(name.trim().toLowerCase())
}

interface FormatInfo {
  format: string
  /** Lower-cased column name → column id, for the columns the format names */
  columns: Map<string, number>
  nameColumnId: number | null
}

function formatInfo(gridId: number): FormatInfo | null {
  const grid = cachedStmt('dn_grid_format', 'SELECT display_format FROM grids WHERE id = ?').get(gridId) as { display_format: string | null } | undefined
  const format = grid?.display_format?.trim()
  if (!format) return null
  const wanted = new Set(formatTokens(format))
  const cols = cachedStmt('dn_grid_cols', 'SELECT id, name, is_name_column FROM columns WHERE grid_id = ? ORDER BY position')
    .all(gridId) as Array<{ id: number; name: string; is_name_column: number }>
  const columns = new Map<string, number>()
  for (const c of cols) {
    const key = c.name.trim().toLowerCase()
    // Two columns with the same name: the first one wins
    if (wanted.has(key) && !columns.has(key)) columns.set(key, c.id)
  }
  return { format, columns, nameColumnId: cols.find(c => c.is_name_column === 1)?.id ?? null }
}

/** Whether the list names its rows with a display format. */
export function hasDisplayFormat(gridId: number): boolean {
  return formatInfo(gridId) !== null
}

/** Whether a change to this column can change names in its list. */
export function columnAffectsDisplayName(gridId: number, columnId: number): boolean {
  const info = formatInfo(gridId)
  if (!info) return false
  return info.nameColumnId === columnId || [...info.columns.values()].includes(columnId)
}

/**
 * Recompute names for some rows of a list (all of them when rowIds is
 * omitted): from the format when the list has one, otherwise the default
 * name. Call inside the write's transaction where there is one.
 */
export function refreshDisplayNames(gridId: number, rowIds?: number[]): void {
  const info = formatInfo(gridId)
  const db = getDb()
  if (!info) {
    if (!rowIds) { db.prepare(`${DEFAULT_NAME_UPDATE} WHERE grid_id = ?`).run(gridId); return }
    for (let i = 0; i < rowIds.length; i += CHUNK) {
      const chunk = rowIds.slice(i, i + CHUNK)
      db.prepare(`${DEFAULT_NAME_UPDATE} WHERE grid_id = ? AND id IN (${chunk.map(() => '?').join(',')})`).run(gridId, ...chunk)
    }
    return
  }
  const ids = rowIds ?? (cachedStmt('dn_grid_rows', 'SELECT id FROM rows WHERE grid_id = ?').all(gridId) as Array<{ id: number }>).map(r => r.id)
  if (!ids.length) return

  const columnIds = [...new Set([...info.columns.values(), ...(info.nameColumnId ? [info.nameColumnId] : [])])]
  const nameByColumn = new Map([...info.columns].map(([name, id]) => [id, name]))
  const update = cachedStmt('dn_update', 'UPDATE rows SET display_name = ? WHERE id = ? AND grid_id = ?')

  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)
    const values = new Map<number, Record<string, string>>()
    const nameValue = new Map<number, string>()
    for (const id of chunk) values.set(id, {})
    if (columnIds.length) {
      const cells = db.prepare(
        `SELECT row_id, column_id, value FROM cells
         WHERE row_id IN (${chunk.map(() => '?').join(',')}) AND column_id IN (${columnIds.map(() => '?').join(',')})`,
      ).all(...chunk, ...columnIds) as Array<{ row_id: number; column_id: number; value: string | null }>
      for (const c of cells) {
        if (c.value == null) continue
        const name = nameByColumn.get(c.column_id)
        if (name) values.get(c.row_id)![name] = c.value
        if (c.column_id === info.nameColumnId) nameValue.set(c.row_id, c.value.trim())
      }
    }
    for (const id of chunk) {
      const name = renderDisplayFormat(info.format, values.get(id)!) || nameValue.get(id) || UNNAMED
      update.run(name, id, gridId)
    }
  }
}

/**
 * After a column is renamed: point the list's format at the new name so its
 * names don't change, then recompute (the rename trigger has just reset them).
 */
export function afterColumnRenamed(gridId: number, oldName: string, newName: string): void {
  const row = cachedStmt('dn_grid_format', 'SELECT display_format FROM grids WHERE id = ?').get(gridId) as { display_format: string | null } | undefined
  const format = row?.display_format
  if (!format) return // the rename trigger already set the default names
  const from = oldName.trim().toLowerCase()
  if (from !== newName.trim().toLowerCase() && !/[{}]/.test(newName)) {
    const updated = format.replace(/\{([^{}]+)\}/g, (whole, name: string) => (name.trim().toLowerCase() === from ? `{${newName.trim()}}` : whole))
    if (updated !== format) getDb().prepare('UPDATE grids SET display_format = ? WHERE id = ?').run(updated, gridId)
  }
  refreshDisplayNames(gridId)
}
