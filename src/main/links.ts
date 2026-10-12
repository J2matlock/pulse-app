/**
 * Linked records (generalization W04 §5): link types between lists, the
 * links themselves, and their history.
 *
 * Cardinality is enforced in the same transaction as the write: on a side
 * that holds one link, adding a new one replaces the old, and the replaced
 * link is returned so undo can restore it. Every add and remove goes into
 * record_link_history; a change note is written on a record when its list
 * shows the link in a column with change notes on.
 */
import { getDb } from './database'
import { word } from './vocab'
import { assignAutoNumbers } from './auto-number'
import { hasDisplayFormat, refreshDisplayNames } from './display-names'
import { holdsOne, CARDINALITIES, linkColumnSpecs, linkSelectSql, type LinkChange, type LinkDirection, type LinkRef, type LinkType, type LinkTypeInput, type LinkedRecord, type RowLinks } from '../shared/links'
import { NOT_TRASHED_ROW, liveGrid, notTrashedRow } from '../shared/liveRecords'
import { columnTypesSql } from '../shared/columnTraits'

export class LinkError extends Error {}

const LABEL_MAX = 60
const TYPE_SELECT = `
  SELECT lt.*, fg.name AS from_grid_name, tg.name AS to_grid_name
  FROM link_types lt JOIN grids fg ON fg.id = lt.from_grid_id JOIN grids tg ON tg.id = lt.to_grid_id`

export function listLinkTypes(gridId?: number): LinkType[] {
  const db = getDb()
  return (gridId === undefined
    ? db.prepare(`${TYPE_SELECT} ORDER BY lt.id`).all()
    : db.prepare(`${TYPE_SELECT} WHERE lt.from_grid_id = ? OR lt.to_grid_id = ? ORDER BY lt.id`).all(gridId, gridId)) as LinkType[]
}

export function getLinkType(id: number): LinkType | undefined {
  return getDb().prepare(`${TYPE_SELECT} WHERE lt.id = ?`).get(id) as LinkType | undefined
}

function cleanLabel(s: unknown, what: string): string {
  const v = typeof s === 'string' ? s.trim() : ''
  if (!v) throw new LinkError(`Give the link a name for ${what}.`)
  if (v.length > LABEL_MAX) throw new LinkError(`Keep link names under ${LABEL_MAX} characters.`)
  return v
}

/** Records on a side holding one link that already have more than one */
function overfull(typeId: number, direction: LinkDirection): number {
  const col = direction === 'forward' ? 'from_row_id' : 'to_row_id'
  return (getDb().prepare(`SELECT COUNT(*) AS n FROM (SELECT ${col} FROM record_links WHERE link_type_id = ? GROUP BY ${col} HAVING COUNT(*) > 1)`).get(typeId) as { n: number }).n
}

/** Create a link type, or change an existing one's names and how many each side can hold. */
export function saveLinkType(input: LinkTypeInput): LinkType {
  const db = getDb()
  if (!CARDINALITIES.includes(input.cardinality)) throw new LinkError('Choose how many each side can have.')
  const forward = cleanLabel(input.label_forward, 'this side')
  const backward = cleanLabel(input.label_backward, 'the other side')
  return db.transaction(() => {
    if (input.id !== undefined) {
      const current = getLinkType(input.id)
      if (!current) throw new LinkError('That link no longer exists.')
      if (input.cardinality !== current.cardinality) {
        for (const dir of ['forward', 'backward'] as const) {
          if (holdsOne(input.cardinality, dir) && overfull(input.id, dir) > 0) {
            const name = dir === 'forward' ? current.from_grid_name : current.to_grid_name
            throw new LinkError(`Some ${word('record', { many: true }, dir === 'forward' ? current.from_grid_id : current.to_grid_id)} in ${name} are linked to more than one already. Remove the extra links first.`)
          }
        }
      }
      db.prepare('UPDATE link_types SET label_forward = ?, label_backward = ?, cardinality = ? WHERE id = ?').run(forward, backward, input.cardinality, input.id)
      return getLinkType(input.id)!
    }
    const grids = db.prepare(`SELECT COUNT(*) AS n FROM grids WHERE id IN (?, ?) AND ${liveGrid('')}`).get(input.from_grid_id, input.to_grid_id) as { n: number }
    if (grids.n < (input.from_grid_id === input.to_grid_id ? 1 : 2)) throw new LinkError(`That ${word('list')} no longer exists.`)
    const id = Number(db.prepare('INSERT INTO link_types (from_grid_id, to_grid_id, label_forward, label_backward, cardinality) VALUES (?, ?, ?, ?, ?)')
      .run(input.from_grid_id, input.to_grid_id, forward, backward, input.cardinality).lastInsertRowid)
    return getLinkType(id)!
  })()
}

/** Link columns showing a type, in any list */
function linkColumnsFor(typeId: number): Array<{ id: number; grid_id: number; direction: LinkDirection; log: boolean }> {
  const cols = getDb().prepare("SELECT id, grid_id, config FROM columns WHERE column_type = 'link'").all() as Array<{ id: number; grid_id: number; config: string | null }>
  const out: Array<{ id: number; grid_id: number; direction: LinkDirection; log: boolean }> = []
  for (const c of cols) {
    try {
      const cfg = JSON.parse(c.config || '{}') as { link_type_id?: number; direction?: LinkDirection; log_changes?: boolean }
      if (cfg.link_type_id === typeId) out.push({ id: c.id, grid_id: c.grid_id, direction: cfg.direction === 'backward' ? 'backward' : 'forward', log: !!cfg.log_changes })
    } catch { /* unreadable config: not a usable link column */ }
  }
  return out
}

/** How many links a type has, for the "delete" confirmation */
export function countLinks(typeId: number): number {
  return (getDb().prepare('SELECT COUNT(*) AS n FROM record_links WHERE link_type_id = ?').get(typeId) as { n: number }).n
}

/** Delete a link type, its links and the columns showing it. The history stays. */
export function deleteLinkType(id: number): { removedLinks: number; removedColumns: number[] } {
  const db = getDb()
  return db.transaction(() => {
    if (!getLinkType(id)) throw new LinkError('That link no longer exists.')
    const removedLinks = db.prepare(`INSERT INTO record_link_history (link_type_id, from_row_id, to_row_id, action)
      SELECT link_type_id, from_row_id, to_row_id, 'remove' FROM record_links WHERE link_type_id = ?`).run(id).changes
    const cols = linkColumnsFor(id).map(c => c.id)
    for (const c of cols) db.prepare('DELETE FROM columns WHERE id = ?').run(c)
    db.prepare('DELETE FROM link_types WHERE id = ?').run(id)
    return { removedLinks, removedColumns: cols }
  })()
}

interface RowInfo { id: number; grid_id: number; display_name: string | null; deleted_at: string | null }

function rowInfo(rowId: number): RowInfo | undefined {
  return getDb().prepare('SELECT id, grid_id, display_name, deleted_at FROM rows WHERE id = ?').get(rowId) as RowInfo | undefined
}

const nameOf = (r: RowInfo | undefined): string => r?.display_name || `(unnamed)`

/** The type and both records, checked to belong together */
function checkedLink(typeId: number, fromRowId: number, toRowId: number): { type: LinkType; from: RowInfo; to: RowInfo } {
  const type = getLinkType(typeId)
  if (!type) throw new LinkError('That link no longer exists.')
  const from = rowInfo(fromRowId)
  const to = rowInfo(toRowId)
  if (!from || !to || from.deleted_at || to.deleted_at) throw new LinkError(`That ${word('record')} is no longer available.`)
  if (from.grid_id !== type.from_grid_id || to.grid_id !== type.to_grid_id) throw new LinkError(`Those ${word('record', { many: true })} can't be linked this way.`)
  if (fromRowId === toRowId) throw new LinkError(`${word('record', { article: true, cap: true }, from.grid_id)} can't be linked to itself.`)
  return { type, from, to }
}

/** Change notes go on a record when its list shows the link with change notes on */
function noteWriter(type: LinkType) {
  const cols = linkColumnsFor(type.id)
  const logs = (gridId: number, dir: LinkDirection) => cols.some(c => c.grid_id === gridId && c.direction === dir && c.log)
  const insert = getDb().prepare("INSERT INTO case_log (row_id, content, log_type, created_at, updated_at) VALUES (?, ?, 'system', datetime('now'), datetime('now'))")
  const ids: number[] = []
  return {
    ids,
    note(row: RowInfo, dir: LinkDirection, text: string) {
      if (logs(row.grid_id, dir)) ids.push(Number(insert.run(row.id, text).lastInsertRowid))
    },
  }
}

const history = (ref: LinkRef, action: 'add' | 'remove') =>
  getDb().prepare('INSERT INTO record_link_history (link_type_id, from_row_id, to_row_id, action) VALUES (?, ?, ?, ?)').run(ref.typeId, ref.fromRowId, ref.toRowId, action)

/**
 * Link two records. On a side that holds one link the old link is replaced
 * (and returned in `removed`). Linking twice is a no-op.
 */
export function addLink(typeId: number, fromRowId: number, toRowId: number, opts: { quiet?: boolean } = {}): LinkChange {
  const db = getDb()
  return db.transaction((): LinkChange => {
    const { type, from, to } = checkedLink(typeId, fromRowId, toRowId)
    const change: LinkChange = { added: null, removed: [], sysLogIds: [], rowIds: [] }
    if (db.prepare('SELECT 1 FROM record_links WHERE link_type_id = ? AND from_row_id = ? AND to_row_id = ?').get(typeId, fromRowId, toRowId)) return change

    // Imports link quietly: history yes, a change note per record no
    const notes = opts.quiet ? { ids: [] as number[], note: () => {} } : noteWriter(type)
    const fwdOne = holdsOne(type.cardinality, 'forward')
    const backOne = holdsOne(type.cardinality, 'backward')
    const replaced = [
      ...(fwdOne ? db.prepare('SELECT from_row_id, to_row_id FROM record_links WHERE link_type_id = ? AND from_row_id = ?').all(typeId, fromRowId) : []),
      ...(backOne ? db.prepare('SELECT from_row_id, to_row_id FROM record_links WHERE link_type_id = ? AND to_row_id = ?').all(typeId, toRowId) : []),
    ] as Array<{ from_row_id: number; to_row_id: number }>
    let wasName: string | null = null
    for (const old of replaced) {
      db.prepare('DELETE FROM record_links WHERE link_type_id = ? AND from_row_id = ? AND to_row_id = ?').run(typeId, old.from_row_id, old.to_row_id)
      const ref = { typeId, fromRowId: old.from_row_id, toRowId: old.to_row_id }
      history(ref, 'remove')
      change.removed.push(ref)
      const oldFrom = rowInfo(old.from_row_id)
      const oldTo = rowInfo(old.to_row_id)
      // The records this add touches get one combined note below; the others are told here
      if (old.from_row_id === fromRowId) wasName = nameOf(oldTo)
      else if (oldFrom) notes.note(oldFrom, 'forward', fwdOne ? `${type.label_forward} cleared (was ${nameOf(oldTo)})` : `${type.label_forward}: ${nameOf(oldTo)} unlinked`)
      if (old.to_row_id !== toRowId && oldTo) notes.note(oldTo, 'backward', backOne ? `${type.label_backward} cleared (was ${nameOf(oldFrom)})` : `${type.label_backward}: ${nameOf(oldFrom)} unlinked`)
      change.rowIds.push(old.from_row_id, old.to_row_id)
    }
    db.prepare('INSERT INTO record_links (link_type_id, from_row_id, to_row_id) VALUES (?, ?, ?)').run(typeId, fromRowId, toRowId)
    change.added = { typeId, fromRowId, toRowId }
    history(change.added, 'add')
    notes.note(from, 'forward', fwdOne
      ? `${type.label_forward} set to ${nameOf(to)}${wasName ? ` (was ${wasName})` : ''}`
      : `${type.label_forward}: ${nameOf(to)} linked`)
    notes.note(to, 'backward', backOne ? `${type.label_backward} set to ${nameOf(from)}` : `${type.label_backward}: ${nameOf(from)} linked`)
    change.rowIds = [...new Set([...change.rowIds, fromRowId, toRowId])]
    change.sysLogIds = notes.ids
    return change
  })()
}

/** Unlink two records. Removing a link that isn't there is a no-op. */
export function removeLink(typeId: number, fromRowId: number, toRowId: number): LinkChange {
  const db = getDb()
  return db.transaction((): LinkChange => {
    const type = getLinkType(typeId)
    if (!type) throw new LinkError('That link no longer exists.')
    const change: LinkChange = { added: null, removed: [], sysLogIds: [], rowIds: [] }
    if (db.prepare('DELETE FROM record_links WHERE link_type_id = ? AND from_row_id = ? AND to_row_id = ?').run(typeId, fromRowId, toRowId).changes === 0) return change
    const ref = { typeId, fromRowId, toRowId }
    history(ref, 'remove')
    change.removed.push(ref)
    const from = rowInfo(fromRowId)
    const to = rowInfo(toRowId)
    const notes = noteWriter(type)
    if (from) notes.note(from, 'forward', holdsOne(type.cardinality, 'forward') ? `${type.label_forward} cleared (was ${nameOf(to)})` : `${type.label_forward}: ${nameOf(to)} unlinked`)
    if (to) notes.note(to, 'backward', holdsOne(type.cardinality, 'backward') ? `${type.label_backward} cleared (was ${nameOf(from)})` : `${type.label_backward}: ${nameOf(from)} unlinked`)
    change.sysLogIds = notes.ids
    change.rowIds = [fromRowId, toRowId]
    return change
  })()
}

/** Every link type touching this record's list, both directions, with the linked records (trash hidden). */
export function getLinksForRow(rowId: number): RowLinks[] {
  const db = getDb()
  const row = rowInfo(rowId)
  if (!row) return []
  const linked = (typeId: number, dir: LinkDirection): LinkedRecord[] => {
    const [mine, other] = dir === 'forward' ? ['from_row_id', 'to_row_id'] : ['to_row_id', 'from_row_id']
    return db.prepare(`
      SELECT t.id AS row_id, t.grid_id, COALESCE(t.display_name, '') AS display_name, t.is_active
      FROM record_links l JOIN rows t ON t.id = l.${other}
      WHERE l.link_type_id = ? AND l.${mine} = ? AND ${notTrashedRow('t')}
      ORDER BY t.display_name COLLATE NOCASE, t.id`).all(typeId, rowId) as LinkedRecord[]
  }
  // The other list's first two visible columns people fill in, shown under each linked record
  const keyCols = db.prepare(`SELECT id, name, column_type FROM columns WHERE grid_id = ? AND is_visible = 1 AND is_name_column = 0
    AND column_type NOT IN (${columnTypesSql(t => !t.linkDetail)}) ORDER BY position LIMIT 2`)
  const cellOf = db.prepare('SELECT value FROM cells WHERE row_id = ? AND column_id = ?')
  const withDetails = (records: LinkedRecord[], gridId: number): LinkedRecord[] => {
    const cols = keyCols.all(gridId) as Array<{ id: number; name: string; column_type: string }>
    return records.map(r => {
      const details = cols.flatMap(c => {
        const v = (cellOf.get(r.row_id, c.id) as { value: string | null } | undefined)?.value
        return v ? [{ label: c.name, value: v, type: c.column_type }] : []
      })
      return details.length ? { ...r, details } : r
    })
  }
  const out: RowLinks[] = []
  for (const type of listLinkTypes(row.grid_id)) {
    if (type.from_grid_id === row.grid_id) {
      out.push({ type, direction: 'forward', label: type.label_forward, other_grid_id: type.to_grid_id, other_grid_name: type.to_grid_name,
        single: holdsOne(type.cardinality, 'forward'), records: withDetails(linked(type.id, 'forward'), type.to_grid_id) })
    }
    if (type.to_grid_id === row.grid_id) {
      out.push({ type, direction: 'backward', label: type.label_backward, other_grid_id: type.from_grid_id, other_grid_name: type.from_grid_name,
        single: holdsOne(type.cardinality, 'backward'), records: withDetails(linked(type.id, 'backward'), type.from_grid_id) })
    }
  }
  return out
}

/** Records that can be picked for a link: the other side's list, by name, active first; trash never. */
export function searchLinkTargets(typeId: number, direction: LinkDirection, query: string, limit = 20): LinkedRecord[] {
  const type = getLinkType(typeId)
  if (!type) throw new LinkError('That link no longer exists.')
  const gridId = direction === 'forward' ? type.to_grid_id : type.from_grid_id
  const q = query.trim().slice(0, 100).replace(/[\\%_]/g, c => `\\${c}`)
  return getDb().prepare(`
    SELECT id AS row_id, grid_id, COALESCE(display_name, '') AS display_name, is_active
    FROM rows
    WHERE grid_id = ? AND ${notTrashedRow('')} AND COALESCE(display_name, '') LIKE ? ESCAPE '\\'
    ORDER BY is_active DESC, display_name COLLATE NOCASE, id
    LIMIT ?`).all(gridId, `%${q}%`, Math.max(1, Math.min(limit, 100))) as LinkedRecord[]
}

/** Current link values of a list's link columns, for refreshing the grid without reloading it */
export function linkValuesForGrid(gridId: number): Array<Record<string, unknown>> {
  const db = getDb()
  const specs = linkColumnSpecs(db.prepare("SELECT id, column_type, config FROM columns WHERE grid_id = ? AND column_type = 'link'").all(gridId) as Array<{ id: number; column_type: string; config: string | null }>)
  if (specs.length === 0) return []
  return db.prepare(`SELECT r.id AS row_id, ${linkSelectSql(specs)} FROM rows r WHERE r.grid_id = ? AND ${NOT_TRASHED_ROW}`).all(gridId) as Array<Record<string, unknown>>
}

/** The list on the other side of a link type from `direction` */
export function otherGridOf(type: LinkType, direction: LinkDirection): number {
  return direction === 'forward' ? type.to_grid_id : type.from_grid_id
}

/**
 * "New Customer…" in the link picker: add a record with this name to the
 * other list and link it, in one step.
 */
export function createLinkedRecord(typeId: number, direction: LinkDirection, rowId: number, name: string, opts: { quiet?: boolean } = {}): { rowId: number; change: LinkChange } {
  const db = getDb()
  const type = getLinkType(typeId)
  if (!type) throw new LinkError('That link no longer exists.')
  const clean = name.trim().slice(0, 500)
  if (!clean) throw new LinkError('Type a name first.')
  const gridId = otherGridOf(type, direction)
  return db.transaction(() => {
    const nameCol = db.prepare('SELECT id FROM columns WHERE grid_id = ? AND is_name_column = 1 ORDER BY position LIMIT 1').get(gridId) as { id: number } | undefined
    if (!nameCol) throw new LinkError(`That ${word('list')} has no name column to fill in.`)
    const maxPos = (db.prepare('SELECT MAX(position) AS p FROM rows WHERE grid_id = ?').get(gridId) as { p: number | null }).p ?? -1
    const newId = Number(db.prepare("INSERT INTO rows (grid_id, position, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))").run(gridId, maxPos + 1).lastInsertRowid)
    db.prepare("INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, ?, datetime('now'))").run(newId, nameCol.id, clean)
    assignAutoNumbers(gridId, [newId])
    if (hasDisplayFormat(gridId)) refreshDisplayNames(gridId, [newId])
    const change = direction === 'forward' ? addLink(typeId, rowId, newId, opts) : addLink(typeId, newId, rowId, opts)
    return { rowId: newId, change }
  })()
}

/**
 * Set up a link between two lists from the column menu (W04 §7.1): the link
 * type, a column showing it on this list, and optionally one on the other.
 */
export function setupLink(input: LinkTypeInput, opts: { showOnOther: boolean; logChanges: boolean }): { type: LinkType; columnIds: number[] } {
  const db = getDb()
  if (input.id !== undefined) throw new LinkError('That link already exists.')
  return db.transaction(() => {
    const type = saveLinkType(input)
    const insert = db.prepare("INSERT INTO columns (grid_id, name, column_type, width, position, config, created_at) VALUES (?, ?, 'link', 200, ?, ?, datetime('now'))")
    const add = (gridId: number, name: string, direction: LinkDirection): number => {
      const maxPos = (db.prepare('SELECT MAX(position) AS p FROM columns WHERE grid_id = ?').get(gridId) as { p: number | null }).p ?? -1
      return Number(insert.run(gridId, name, maxPos + 1, JSON.stringify({ link_type_id: type.id, direction, log_changes: opts.logChanges })).lastInsertRowid)
    }
    const columnIds = [add(type.from_grid_id, type.label_forward, 'forward')]
    if (opts.showOnOther) columnIds.push(add(type.to_grid_id, type.label_backward, 'backward'))
    return { type, columnIds }
  })()
}

// ── Lifecycle (W04 §8) ────────────────────────────────────────────────────────

/**
 * A duplicate gets the original's forward links ("same owner"). Backward
 * links aren't copied (they'd take a one-only target from the original),
 * nor are one-to-one links.
 */
export function copyForwardLinks(fromRowId: number, toRowId: number): number {
  const db = getDb()
  const links = db.prepare(`SELECT l.link_type_id, l.to_row_id FROM record_links l JOIN link_types lt ON lt.id = l.link_type_id
    WHERE l.from_row_id = ? AND lt.cardinality != 'one_to_one'`).all(fromRowId) as Array<{ link_type_id: number; to_row_id: number }>
  const ins = db.prepare('INSERT OR IGNORE INTO record_links (link_type_id, from_row_id, to_row_id) VALUES (?, ?, ?)')
  let n = 0
  for (const l of links) {
    if (l.to_row_id === toRowId || ins.run(l.link_type_id, toRowId, l.to_row_id).changes === 0) continue
    history({ typeId: l.link_type_id, fromRowId: toRowId, toRowId: l.to_row_id }, 'add')
    n++
  }
  return n
}

interface Misfit { typeId: number; fromRowId: number; toRowId: number; label: string; name: string }

/**
 * Links that can't stay when a record moves to another list. `liveOnly` leaves out
 * links to records in the Trash (or in a list in the Trash), for the warning (Q-084);
 * the move itself still removes those too.
 */
function misfits(rowId: number, targetGridId: number, liveOnly = false): Misfit[] {
  const live = liveOnly ? `AND ${notTrashedRow('o')} AND EXISTS (SELECT 1 FROM grids og WHERE og.id = o.grid_id AND ${liveGrid('og')})` : ''
  return getDb().prepare(`
    SELECT l.link_type_id AS typeId, l.from_row_id AS fromRowId, l.to_row_id AS toRowId,
      CASE WHEN l.from_row_id = ? THEN lt.label_forward ELSE lt.label_backward END AS label,
      COALESCE(NULLIF(o.display_name, ''), '(unnamed)') AS name
    FROM record_links l JOIN link_types lt ON lt.id = l.link_type_id
    JOIN rows o ON o.id = CASE WHEN l.from_row_id = ? THEN l.to_row_id ELSE l.from_row_id END
    WHERE ((l.from_row_id = ? AND lt.from_grid_id != ?) OR (l.to_row_id = ? AND lt.to_grid_id != ?)) ${live}
    ORDER BY label, name`).all(rowId, rowId, rowId, targetGridId, rowId, targetGridId) as Misfit[]
}

/** "Owner: Jane Smith" for each link a move would remove, to warn first */
export function linksThatWontFit(rowId: number, targetGridId: number): string[] {
  return misfits(rowId, targetGridId, true).map(m => `${m.label}: ${m.name}`)
}

/** Remove the links that don't fit the record's new list (call before moving it). */
export function dropLinksThatWontFit(rowId: number, targetGridId: number): number {
  const del = getDb().prepare('DELETE FROM record_links WHERE link_type_id = ? AND from_row_id = ? AND to_row_id = ?')
  const list = misfits(rowId, targetGridId)
  for (const m of list) { del.run(m.typeId, m.fromRowId, m.toRowId); history(m, 'remove') }
  return list.length
}

/** Link types and links touching a list, for the "delete list" warning */
export function linkCountsForGrid(gridId: number): { types: number; links: number } {
  return getDb().prepare(`SELECT COUNT(DISTINCT lt.id) AS types, COUNT(l.id) AS links FROM link_types lt
    LEFT JOIN record_links l ON l.link_type_id = lt.id WHERE lt.from_grid_id = ? OR lt.to_grid_id = ?`).get(gridId, gridId) as { types: number; links: number }
}

/** A list is being deleted: its link types go, with their links and columns elsewhere. */
export function deleteLinksForGrid(gridId: number): number {
  const ids = (getDb().prepare('SELECT id FROM link_types WHERE from_grid_id = ? OR to_grid_id = ?').all(gridId, gridId) as Array<{ id: number }>).map(r => r.id)
  for (const id of ids) deleteLinkType(id)
  return ids.length
}
