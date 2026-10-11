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
 * A record deleted forever is taken out of these copies at once (AUDIT-108).
 */
import { getDb } from './database'
import { deleteLinksForGrid } from './links'
import { hasDisplayFormat, isLastNameColumnName, refreshDisplayNames } from './display-names'
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

interface ForeignKey { parent: string; from: string[]; to: string[]; setNull: boolean }
const fkCache = new WeakMap<object, Map<string, ForeignKey[]>>()

function foreignKeys(table: string): ForeignKey[] {
  const db = getDb()
  let perDb = fkCache.get(db)
  if (!perDb) { perDb = new Map(); fkCache.set(db, perDb) }
  const cached = perDb.get(table)
  if (cached) return cached
  const list = db.prepare(`SELECT id, seq, "table" AS parent, "from" AS col, "to" AS ref, on_delete FROM pragma_foreign_key_list(?) ORDER BY id, seq`).all(table) as
    Array<{ id: number; seq: number; parent: string; col: string; ref: string | null; on_delete: string }>
  const byId = new Map<number, ForeignKey>()
  for (const f of list) {
    let fk = byId.get(f.id)
    if (!fk) { fk = { parent: f.parent, from: [], to: [], setNull: f.on_delete.toUpperCase() === 'SET NULL' }; byId.set(f.id, fk) }
    fk.from.push(f.col)
    fk.to.push(f.ref ?? '')
  }
  const out = [...byId.values()]
  for (const fk of out) {
    // A key that names no column points at the parent's primary key
    if (fk.to.some(c => !c)) {
      const pk = (db.prepare('SELECT name FROM pragma_table_info(?) WHERE pk > 0 ORDER BY pk').all(fk.parent) as Array<{ name: string }>).map(c => c.name)
      fk.to = pk.length === fk.from.length ? pk : fk.from.map(() => 'rowid')
    }
  }
  perDb.set(table, out)
  return out
}

/**
 * A saved row whose parents are gone since (a note deleted after the column was,
 * a record removed for good) can't go back: `INSERT OR IGNORE` doesn't skip
 * foreign key failures, so one such row would block the whole restore. Keys the
 * database would have cleared on delete are cleared; otherwise the row is left out.
 */
function withLiveParents(table: string, row: Row): Row | null {
  const db = getDb()
  let out = row
  for (const fk of foreignKeys(table)) {
    const vals = fk.from.map(c => row[c])
    if (vals.some(v => v == null)) continue
    const where = fk.to.map(c => `${quoteId(c)} = ?`).join(' AND ')
    if (db.prepare(`SELECT 1 FROM ${quoteId(fk.parent)} WHERE ${where}`).get(...vals as never[])) continue
    if (!fk.setNull) return null
    out = { ...out }
    for (const c of fk.from) out[c] = null
  }
  return out
}

function insertRow(table: string, saved: Row): boolean {
  const row = withLiveParents(table, saved)
  if (!row) return false
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
  /** For a deleted name column: the column that took over naming, which hands it back on restore */
  standInId?: number | null
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
export function trashColumn(columnId: number, opts?: { standInId?: number | null }): number {
  const snap: ColumnSnapshot = { ...snapshotColumn(columnId), ...(opts?.standInId !== undefined ? { standInId: opts.standInId } : {}) }
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
    // One name column per list. A deleted name column takes the role back from the
    // column that stood in for it; if someone has since chosen another name column, that stays.
    const named = db.prepare('SELECT id FROM columns WHERE grid_id = ? AND is_name_column = 1').get(entry.grid_id) as { id: number } | undefined
    const takeBack = snap.column.is_name_column === 1 && (!named || (snap.standInId != null && named.id === snap.standInId))
    if (takeBack && named) db.prepare('UPDATE columns SET is_name_column = 0 WHERE id = ?').run(named.id)
    insertRow('columns', { ...snap.column, is_name_column: takeBack ? 1 : 0 })
    const rowExists = db.prepare('SELECT 1 FROM rows WHERE id = ?')
    for (const { table, rows } of snap.tables) {
      // Records purged since can't take their values back
      const keep = hasRowId(rows) ? rows.filter(r => rowExists.get(r.row_id as number)) : rows
      for (const r of keep) insertRow(table, r)
    }
    db.prepare('DELETE FROM deleted_columns WHERE id = ?').run(deletedId)
    if (hasDisplayFormat(entry.grid_id) || takeBack || isLastNameColumnName(String(snap.column.name ?? ''))) refreshDisplayNames(entry.grid_id)
  }))()
  return { columnId: entry.column_id, gridId: entry.grid_id }
}

// ── Records removed for good ─────────────────────────────────────────────────

/**
 * Drop saved rows that belong to records being removed for good, and anything
 * saved under them (a value's history). A key the database would clear on
 * delete is cleared instead. Returns whether anything changed.
 */
function stripRows(tables: Array<{ table: string; rows: Row[] }>, gone: Set<number>): { tables: Array<{ table: string; rows: Row[] }>; changed: boolean } {
  const dropped = new Map<string, Row[]>()
  const goneValues = (parent: string, to: string): Set<unknown> => {
    if (parent === 'rows' && (to === 'id' || to === 'rowid')) return gone
    return new Set((dropped.get(parent) ?? []).map(r => r[to]))
  }
  let changed = false
  const out: Array<{ table: string; rows: Row[] }> = []
  for (const { table, rows } of tables) {
    const fks = foreignKeys(table).filter(fk => fk.from.length === 1 && (fk.parent === 'rows' || dropped.has(fk.parent)))
      .map(fk => ({ col: fk.from[0]!, setNull: fk.setNull, values: goneValues(fk.parent, fk.to[0]!) }))
    const keep: Row[] = []
    for (const r of rows) {
      let row = r
      let drop = false
      for (const fk of fks) {
        if (row[fk.col] == null || !fk.values.has(row[fk.col])) continue
        if (!fk.setNull) { drop = true; break }
        row = { ...row, [fk.col]: null }
      }
      if (drop) { dropped.set(table, [...(dropped.get(table) ?? []), r]); changed = true; continue }
      if (row !== r) changed = true
      keep.push(row)
    }
    if (keep.length) out.push({ table, rows: keep })
  }
  return { tables: out, changed }
}

/**
 * Records are about to be removed for good: take their values out of the
 * copies kept for deleted columns and lists in the Trash, so "Delete forever"
 * leaves nothing of them behind (AUDIT-108). Call in the purge's transaction,
 * before the delete.
 */
export function forgetPurgedRows(rowIds: number[]): void {
  if (!rowIds.length) return
  const db = getDb()
  const gone = new Set(rowIds)
  const gridIds = new Set<number>()
  for (let i = 0; i < rowIds.length; i += 500) {
    const chunk = rowIds.slice(i, i + 500)
    for (const r of db.prepare(`SELECT DISTINCT grid_id FROM rows WHERE id IN (${chunk.map(() => '?').join(',')})`).all(...chunk) as Array<{ grid_id: number }>) gridIds.add(r.grid_id)
  }
  const saveColumn = db.prepare('UPDATE deleted_columns SET snapshot = ? WHERE id = ?')
  for (const gridId of gridIds) {
    for (const e of db.prepare('SELECT id, snapshot FROM deleted_columns WHERE grid_id = ?').all(gridId) as Array<{ id: number; snapshot: string }>) {
      let snap: ColumnSnapshot
      try { snap = JSON.parse(e.snapshot) as ColumnSnapshot } catch { continue }
      const res = stripRows(snap.tables, gone)
      if (res.changed) saveColumn.run(JSON.stringify({ ...snap, tables: res.tables }), e.id)
    }
  }
  // Lists in the Trash keep copies of link columns (any list's) and of links between records
  const saveList = db.prepare('UPDATE grids SET deleted_snapshot = ? WHERE id = ?')
  for (const g of db.prepare('SELECT id, deleted_snapshot FROM grids WHERE deleted_snapshot IS NOT NULL').all() as Array<{ id: number; deleted_snapshot: string }>) {
    let snap: ListSnapshot
    try { snap = JSON.parse(g.deleted_snapshot) as ListSnapshot } catch { continue }
    let changed = false
    const linkColumns = (snap.linkColumns ?? []).map(c => {
      const res = stripRows(c.tables, gone)
      if (!res.changed) return c
      changed = true
      return { ...c, tables: res.tables }
    })
    const links = stripRows([{ table: 'record_links', rows: snap.recordLinks ?? [] }], gone)
    if (links.changed) changed = true
    if (changed) saveList.run(JSON.stringify({ ...snap, linkColumns, recordLinks: links.tables[0]?.rows ?? [] }), g.id)
  }
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
  const db = getDb()
  return db.transaction(() => {
    if (!db.prepare('SELECT 1 FROM grids WHERE id = ? AND is_active = 0 AND deleted_at IS NOT NULL').get(gridId)) return false
    forgetPurgedRows((db.prepare('SELECT id FROM rows WHERE grid_id = ?').all(gridId) as Array<{ id: number }>).map(r => r.id))
    return db.prepare('DELETE FROM grids WHERE id = ? AND is_active = 0 AND deleted_at IS NOT NULL').run(gridId).changes > 0
  })()
}
