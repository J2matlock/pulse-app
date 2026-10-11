/**
 * Deleted lists and columns go to the Trash for 30 days (audit 5.2,
 * Decision D1), like records already do.
 *
 * - A deleted column is taken out of its list, and a copy of it and of
 *   everything stored against it (values, their history, formats, deadline
 *   steps and extensions, parked values…) waits in deleted_columns. Restore
 *   puts it all back with the same ids, so rules and views that point at it
 *   work again.
 * - A deleted list stays in place with is_active = 0 and a deleted_at; its
 *   links to other lists are removed (they'd dangle) and kept as a copy so
 *   restoring the list brings them back.
 * Anything left after 30 days is removed for good when the database opens.
 */
import { getDb } from './database'
import { deleteLinksForGrid } from './links'
import { hasDisplayFormat, refreshDisplayNames } from './display-names'
import { keepSamplesUntouched } from './sample-marks'

export class TrashError extends Error {}

type Row = Record<string, unknown>
const quoteId = (s: string) => `"${s.replace(/"/g, '""')}"`

/** Tables with a foreign key to `parent`, and the column that holds it */
function childTables(parent: string): Array<{ table: string; column: string }> {
  const db = getDb()
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>).map(t => t.name)
  const out: Array<{ table: string; column: string }> = []
  for (const table of tables) {
    for (const fk of db.prepare(`SELECT "table" AS parent, "from" AS col FROM pragma_foreign_key_list(?)`).all(table) as Array<{ parent: string; col: string }>) {
      if (fk.parent === parent) out.push({ table, column: fk.col })
    }
  }
  return out
}

function insertRow(table: string, row: Row): boolean {
  const keys = Object.keys(row)
  if (!keys.length) return false
  const sql = `INSERT OR IGNORE INTO ${quoteId(table)} (${keys.map(quoteId).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`
  return getDb().prepare(sql).run(...keys.map(k => row[k] as never)).changes > 0
}

// ── Columns ──────────────────────────────────────────────────────────────────

export interface ColumnSnapshot {
  column: Row
  /** table → rows, children of the column first, then their own children (cell history) */
  tables: Array<{ table: string; rows: Row[] }>
}

/** A copy of a column and everything stored against it */
export function snapshotColumn(columnId: number): ColumnSnapshot {
  const db = getDb()
  const column = db.prepare('SELECT * FROM columns WHERE id = ?').get(columnId) as Row | undefined
  if (!column) throw new TrashError('That column no longer exists.')
  const tables: ColumnSnapshot['tables'] = []
  for (const { table, column: fk } of childTables('columns')) {
    const rows = db.prepare(`SELECT * FROM ${quoteId(table)} WHERE ${quoteId(fk)} = ?`).all(columnId) as Row[]
    if (rows.length) tables.push({ table, rows })
    // Their own children, e.g. the history of each value
    if (!rows.length || !('id' in rows[0]!)) continue
    for (const grand of childTables(table)) {
      const ids = rows.map(r => r.id as number)
      const kids: Row[] = []
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500)
        kids.push(...db.prepare(`SELECT * FROM ${quoteId(grand.table)} WHERE ${quoteId(grand.column)} IN (${chunk.map(() => '?').join(',')})`).all(...chunk) as Row[])
      }
      if (kids.length) tables.push({ table: grand.table, rows: kids })
    }
  }
  return { column, tables }
}

/** Keep a column's copy in the Trash (call in the same transaction as the delete). Returns the Trash entry's id. */
export function trashColumn(columnId: number): number {
  const snap = snapshotColumn(columnId)
  return Number(getDb().prepare('INSERT INTO deleted_columns (grid_id, column_id, name, column_type, snapshot) VALUES (?, ?, ?, ?, ?)')
    .run(snap.column.grid_id, columnId, snap.column.name, snap.column.column_type, JSON.stringify(snap)).lastInsertRowid)
}

export interface DeletedColumn { id: number; grid_id: number; column_id: number; name: string; column_type: string; deleted_at: string; values: number }

export function listDeletedColumns(gridId: number): DeletedColumn[] {
  const rows = getDb().prepare('SELECT id, grid_id, column_id, name, column_type, deleted_at, snapshot FROM deleted_columns WHERE grid_id = ? ORDER BY deleted_at DESC, id DESC')
    .all(gridId) as Array<DeletedColumn & { snapshot: string }>
  return rows.map(({ snapshot, ...r }) => {
    let values = 0
    try { values = (JSON.parse(snapshot) as ColumnSnapshot).tables.find(t => t.table === 'cells')?.rows.filter(c => c.value != null && c.value !== '').length ?? 0 } catch { values = 0 }
    return { ...r, values }
  })
}

/** Put a deleted column back, with its values, as it was. Returns the column id. */
export function restoreColumn(deletedId: number): { columnId: number; gridId: number } {
  const db = getDb()
  const entry = db.prepare('SELECT id, grid_id, column_id, snapshot FROM deleted_columns WHERE id = ?').get(deletedId) as
    { id: number; grid_id: number; column_id: number; snapshot: string } | undefined
  if (!entry) throw new TrashError('That column is no longer in the Trash.')
  let snap: ColumnSnapshot
  try { snap = JSON.parse(entry.snapshot) as ColumnSnapshot } catch { throw new TrashError("That column can't be restored.") }
  if (db.prepare('SELECT 1 FROM columns WHERE id = ?').get(entry.column_id)) throw new TrashError('That column is already back.')
  if (!db.prepare('SELECT 1 FROM grids WHERE id = ?').get(entry.grid_id)) throw new TrashError(`Its list is gone, so the column can't come back.`)
  const hasRowId = (rows: Row[]) => rows.length > 0 && 'row_id' in rows[0]!
  db.transaction(() => keepSamplesUntouched(db, entry.grid_id, () => {
    // One name column per list: it comes back as the name only if the list has none now
    const named = db.prepare('SELECT 1 FROM columns WHERE grid_id = ? AND is_name_column = 1').get(entry.grid_id)
    insertRow('columns', { ...snap.column, ...(named ? { is_name_column: 0 } : {}) })
    const rowExists = db.prepare('SELECT 1 FROM rows WHERE id = ?')
    for (const { table, rows } of snap.tables) {
      // Records purged since can't take their values back
      const keep = hasRowId(rows) ? rows.filter(r => rowExists.get(r.row_id as number)) : rows
      for (const r of keep) insertRow(table, r)
    }
    db.prepare('DELETE FROM deleted_columns WHERE id = ?').run(deletedId)
    if (hasDisplayFormat(entry.grid_id) || !named) refreshDisplayNames(entry.grid_id)
  }))()
  return { columnId: entry.column_id, gridId: entry.grid_id }
}

export function purgeDeletedColumn(deletedId: number): boolean {
  return getDb().prepare('DELETE FROM deleted_columns WHERE id = ?').run(deletedId).changes > 0
}

// ── Lists ────────────────────────────────────────────────────────────────────

interface ListSnapshot { linkTypes: Row[]; linkColumns: ColumnSnapshot[]; recordLinks: Row[] }

/** Move a list to the Trash: its records stay with it; its links are copied, then removed */
export function trashList(gridId: number): void {
  const db = getDb()
  const grid = db.prepare('SELECT id, is_active FROM grids WHERE id = ?').get(gridId) as { id: number; is_active: number } | undefined
  if (!grid) throw new TrashError('That list no longer exists.')
  // Already there (a double click, a second window): trashing again would overwrite its saved links with none
  if (grid.is_active === 0) return
  db.transaction(() => {
    const linkTypes = db.prepare('SELECT * FROM link_types WHERE from_grid_id = ? OR to_grid_id = ?').all(gridId, gridId) as Row[]
    const typeIds = new Set(linkTypes.map(t => t.id as number))
    const linkColumns: ColumnSnapshot[] = []
    for (const c of db.prepare("SELECT id, config FROM columns WHERE column_type = 'link'").all() as Array<{ id: number; config: string | null }>) {
      let typeId: number | undefined
      try { typeId = (JSON.parse(c.config || '{}') as { link_type_id?: number }).link_type_id } catch { typeId = undefined }
      if (typeId !== undefined && typeIds.has(typeId)) linkColumns.push(snapshotColumn(c.id))
    }
    const recordLinks = typeIds.size
      ? db.prepare(`SELECT * FROM record_links WHERE link_type_id IN (${[...typeIds].map(() => '?').join(',')})`).all(...typeIds) as Row[]
      : []
    deleteLinksForGrid(gridId)
    const snapshot: ListSnapshot = { linkTypes, linkColumns, recordLinks }
    db.prepare("UPDATE grids SET is_active = 0, deleted_at = datetime('now'), deleted_snapshot = ?, updated_at = datetime('now') WHERE id = ?")
      .run(JSON.stringify(snapshot), gridId)
  })()
}

export interface DeletedList { id: number; name: string; deleted_at: string; records: number }

export function listDeletedLists(): DeletedList[] {
  return getDb().prepare(`SELECT g.id, g.name, g.deleted_at, (SELECT COUNT(*) FROM rows r WHERE r.grid_id = g.id AND r.deleted_at IS NULL) AS records
    FROM grids g WHERE g.is_active = 0 AND g.deleted_at IS NOT NULL ORDER BY g.deleted_at DESC, g.id DESC`).all() as DeletedList[]
}

/** Bring a list back from the Trash, with its records and the links it had */
export function restoreList(gridId: number): void {
  const db = getDb()
  const grid = db.prepare('SELECT id, is_active, deleted_snapshot FROM grids WHERE id = ?').get(gridId) as { id: number; is_active: number; deleted_snapshot: string | null } | undefined
  if (!grid) throw new TrashError('That list is no longer in the Trash.')
  if (grid.is_active === 1) return
  let snap: ListSnapshot = { linkTypes: [], linkColumns: [], recordLinks: [] }
  try { if (grid.deleted_snapshot) snap = JSON.parse(grid.deleted_snapshot) as ListSnapshot } catch { /* nothing to bring back */ }
  db.transaction(() => {
    db.prepare("UPDATE grids SET is_active = 1, deleted_at = NULL, deleted_snapshot = NULL, updated_at = datetime('now') WHERE id = ?").run(gridId)
    const gridExists = db.prepare('SELECT 1 FROM grids WHERE id = ?')
    const rowExists = db.prepare('SELECT 1 FROM rows WHERE id = ?')
    const back = new Set<number>()
    for (const t of snap.linkTypes) {
      // A link to a list that's been removed for good can't come back
      if (!gridExists.get(t.from_grid_id as number) || !gridExists.get(t.to_grid_id as number)) continue
      if (insertRow('link_types', t)) back.add(t.id as number)
    }
    for (const c of snap.linkColumns) {
      let typeId: number | undefined
      try { typeId = (JSON.parse(String(c.column.config ?? '{}')) as { link_type_id?: number }).link_type_id } catch { typeId = undefined }
      if (typeId === undefined || !back.has(typeId) || !gridExists.get(c.column.grid_id as number)) continue
      insertRow('columns', { ...c.column, is_name_column: 0 })
      for (const { table, rows } of c.tables) for (const r of rows) if (!('row_id' in r) || rowExists.get(r.row_id as number)) insertRow(table, r)
    }
    for (const l of snap.recordLinks) {
      if (back.has(l.link_type_id as number) && rowExists.get(l.from_row_id as number) && rowExists.get(l.to_row_id as number)) insertRow('record_links', l)
    }
  })()
}

/** Remove a list in the Trash for good, with its records and everything on them */
export function purgeList(gridId: number): boolean {
  return getDb().prepare('DELETE FROM grids WHERE id = ? AND is_active = 0 AND deleted_at IS NOT NULL').run(gridId).changes > 0
}
