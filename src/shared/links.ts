/**
 * Linked records (generalization W04): types shared by main and the window.
 */
import { notTrashedRow } from './liveRecords'

export const CARDINALITIES = ['one_to_one', 'many_to_one', 'many_to_many'] as const
export type Cardinality = typeof CARDINALITIES[number]
export type LinkDirection = 'forward' | 'backward'


/** A named relationship between two lists, e.g. Vehicles → Customers, "Owner" / "Vehicles" */
export interface LinkType {
  id: number
  from_grid_id: number
  to_grid_id: number
  /** Shown on the "from" record: "Owner" */
  label_forward: string
  /** Shown on the "to" record: "Vehicles" */
  label_backward: string
  cardinality: Cardinality
  created_at: string
  from_grid_name: string
  to_grid_name: string
}

export interface LinkTypeInput {
  id?: number
  from_grid_id: number
  to_grid_id: number
  label_forward: string
  label_backward: string
  cardinality: Cardinality
}

export interface LinkedRecord {
  row_id: number
  grid_id: number
  display_name: string
  /** 0 = archived (shown muted) */
  is_active: 0 | 1
  /** The other list's first two filled-in key columns, for the profile */
  details?: Array<{ label: string; value: string; type: string }>
}

/** One link type as seen from a record: its label, the other list, and the linked records */
export interface RowLinks {
  type: LinkType
  direction: LinkDirection
  label: string
  other_grid_id: number
  other_grid_name: string
  /** This side holds at most one link */
  single: boolean
  records: LinkedRecord[]
}

export interface LinkRef { typeId: number; fromRowId: number; toRowId: number }

/** What an add or remove changed, so undo can put it back */
export interface LinkChange {
  added: LinkRef | null
  removed: LinkRef[]
  /** Change notes written on the records (voided on undo) */
  sysLogIds: number[]
  /** Records whose links changed, for refreshing open views */
  rowIds: number[]
}

/** Does this side of a link type hold at most one link? */
export function holdsOne(cardinality: Cardinality, direction: LinkDirection): boolean {
  return direction === 'forward' ? cardinality !== 'many_to_many' : cardinality === 'one_to_one'
}

/** Separators in a link column's grid value: `id␞name␟id␞name` */
export const LINK_FIELD_SEP = '\u001e'
export const LINK_ITEM_SEP = '\u001f'

export interface LinkChip { rowId: number; name: string; archived?: true }

/** Parse a link column's grid value (`id␞name[␞a]␟…`, ␞a = archived) into chips. */
export function parseLinkValue(value: string | null | undefined): LinkChip[] {
  if (!value) return []
  const out: LinkChip[] = []
  for (const item of value.split(LINK_ITEM_SEP)) {
    const [id, name, flag] = item.split(LINK_FIELD_SEP)
    const rowId = Number(id)
    if (name === undefined || !Number.isInteger(rowId) || rowId <= 0) continue
    out.push(flag === 'a' ? { rowId, name, archived: true } : { rowId, name })
  }
  return out
}

/** Names for sorting and searching a link column */
export function linkValueText(value: string | null | undefined): string {
  return parseLinkValue(value).map(c => c.name).join(', ')
}

/** A link column's settings */
export interface LinkColumnConfig {
  link_type_id: number
  direction: LinkDirection
  show?: 'names' | 'count'
  /** Write a change note on the record when links change */
  log_changes?: boolean
}

/** A link column in the grid query: its links come from record_links, not cells */
export interface LinkColumnSpec { columnId: number; typeId: number; direction: 'forward' | 'backward' }

/** The link columns among these, read from their settings */
export function linkColumnSpecs(columns: Array<{ id: number; column_type: string; config: string | null }>): LinkColumnSpec[] {
  const out: LinkColumnSpec[] = []
  for (const c of columns) {
    if (c.column_type !== 'link') continue
    try {
      const cfg = JSON.parse(c.config || '{}') as { link_type_id?: unknown; direction?: unknown }
      const typeId = Math.trunc(Number(cfg.link_type_id))
      if (Number.isFinite(typeId) && typeId > 0) out.push({ columnId: c.id, typeId, direction: cfg.direction === 'backward' ? 'backward' : 'forward' })
    } catch { /* unreadable settings: the column shows nothing */ }
  }
  return out
}

/** Part of a statement cache key that changes when link columns do */
export function linkSpecKey(specs: LinkColumnSpec[]): string {
  return specs.map(s => `${s.columnId}:${s.typeId}${s.direction[0]}`).join(',')
}

/**
 * One correlated subquery per link column: `id␞name[␞a]␟…` (␞a = archived),
 * trashed records left out. Still one statement and one round trip.
 */
export function linkSelectSql(specs: LinkColumnSpec[]): string {
  return specs.map(s => {
    const id = Math.trunc(s.columnId), type = Math.trunc(s.typeId)
    const [mine, other] = s.direction === 'forward' ? ['from_row_id', 'to_row_id'] : ['to_row_id', 'from_row_id']
    return `(SELECT GROUP_CONCAT(v, char(31)) FROM (
        SELECT t.id || char(30) || COALESCE(t.display_name, '') || CASE WHEN t.is_active = 0 THEN char(30) || 'a' ELSE '' END AS v
        FROM record_links l JOIN rows t ON t.id = l.${other}
        WHERE l.link_type_id = ${type} AND l.${mine} = r.id AND ${notTrashedRow('t')}
        ORDER BY t.display_name COLLATE NOCASE, t.id)) AS col_${id}`
  }).join(',\n      ')
}
