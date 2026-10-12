/**
 * The soft-delete filters, written once (A16-09).
 *
 * A record (a `rows` row) is in one of three states:
 *  - live:     is_active = 1, deleted_at IS NULL
 *  - archived: is_active = 0, deleted_at IS NULL (archived_at set)
 *  - trashed:  is_active = 0, deleted_at set
 * A list (a `grids` row) is live with is_active = 1, and in the Trash with
 * is_active = 0 (deleted_at is set alongside it).
 *
 * Every soft-delete writer sets is_active = 0 with deleted_at
 * (tests/soft-delete-writers.test.ts), so "live" could be either column on
 * its own; the helper checks both so a writer that forgot one still can't
 * leak a trashed record.
 *
 * Pass the table alias the query uses ('' for an unaliased table). Records of
 * a list in the Trash keep deleted_at NULL, so cross-list queries add
 * liveGrid() too.
 */

function col(alias: string, name: string): string {
  return alias ? `${alias}.${name}` : name
}

/** A record that is neither archived nor in the Trash */
export function liveRow(alias = 'r'): string {
  return `${col(alias, 'is_active')} = 1 AND ${col(alias, 'deleted_at')} IS NULL`
}

/** A record that isn't in the Trash: live or archived */
export function notTrashedRow(alias = 'r'): string {
  return `${col(alias, 'deleted_at')} IS NULL`
}

/** An archived record: out of the active list, not in the Trash */
export function archivedRow(alias = 'r'): string {
  return `${col(alias, 'is_active')} = 0 AND ${col(alias, 'archived_at')} IS NOT NULL AND ${col(alias, 'deleted_at')} IS NULL`
}

/** A list that isn't in the Trash */
export function liveGrid(alias = 'g'): string {
  return `${col(alias, 'is_active')} = 1`
}

/** `r.is_active = 1 AND r.deleted_at IS NULL` */
export const LIVE_ROW = liveRow('r')
/** `r.deleted_at IS NULL` (live or archived) */
export const NOT_TRASHED_ROW = notTrashedRow('r')
/** `r.is_active = 0 AND r.archived_at IS NOT NULL AND r.deleted_at IS NULL` */
export const ARCHIVED_ROW = archivedRow('r')
/** `g.is_active = 1` */
export const LIVE_GRID = liveGrid('g')
