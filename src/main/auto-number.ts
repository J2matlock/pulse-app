/**
 * Assigns auto numbers (J-0001, J-0002…) to records
 * (plans/generalization/W02-list-kinds.md §4).
 *
 * Numbers are handed out inside the caller's transaction and the column's
 * `next` is bumped in the same transaction, so two creates can't get the
 * same number. Numbers are never reused: a deleted record's number stays gone.
 */
import { getDb, cachedStmt } from './database'
import { parseAutoNumberConfig, formatAutoNumber, autoNumberValue, DEFAULT_AUTO_NUMBER } from '../shared/autoNumber'
import { columnAffectsDisplayName, refreshDisplayNames } from './display-names'

interface AutoColumn { id: number; config: string | null }

function autoColumns(gridId: number): AutoColumn[] {
  return cachedStmt('an_cols', "SELECT id, config FROM columns WHERE grid_id = ? AND column_type = 'auto_number' ORDER BY position")
    .all(gridId) as AutoColumn[]
}

function saveNext(columnId: number, rawConfig: string | null, next: number): void {
  let obj: Record<string, unknown> = {}
  try { obj = JSON.parse(rawConfig || '{}') as Record<string, unknown> } catch { obj = {} }
  cachedStmt('an_save_next', 'UPDATE columns SET config = ? WHERE id = ?').run(JSON.stringify({ ...obj, next }), columnId)
}

const upsert = () => cachedStmt('an_upsert', `
  INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, ?, datetime('now'))
  ON CONFLICT(row_id, column_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)

/**
 * Give rows the next numbers in every auto-number column of their list, in
 * the order given. Rows that already have a number keep it unless `overwrite`
 * (duplicates and records brought in from another list get a new one).
 */
export function assignAutoNumbers(gridId: number, rowIds: number[], opts: { overwrite?: boolean } = {}): void {
  if (!rowIds.length) return
  const cols = autoColumns(gridId)
  if (!cols.length) return
  const existing = cachedStmt('an_existing', 'SELECT value FROM cells WHERE row_id = ? AND column_id = ?')
  for (const col of cols) {
    const cfg = parseAutoNumberConfig(col.config)
    let next = cfg.next
    for (const rowId of rowIds) {
      if (!opts.overwrite) {
        const cur = existing.get(rowId, col.id) as { value: string | null } | undefined
        if (cur?.value?.trim()) continue
      }
      upsert().run(rowId, col.id, formatAutoNumber(cfg, next++))
    }
    if (next !== cfg.next) saveNext(col.id, col.config, next)
    if (columnAffectsDisplayName(gridId, col.id)) refreshDisplayNames(gridId, rowIds)
  }
}

/**
 * After numbers came in from outside (an import, sample data): move each
 * column's `next` past the highest number already in it.
 */
export function bumpAutoNumbersPastValues(gridId: number): void {
  for (const col of autoColumns(gridId)) {
    const cfg = parseAutoNumberConfig(col.config)
    const values = cachedStmt('an_values', 'SELECT value FROM cells WHERE column_id = ?').all(col.id) as Array<{ value: string | null }>
    const max = values.reduce((m, v) => Math.max(m, autoNumberValue(v.value) ?? 0), 0)
    if (max + 1 > cfg.next) saveNext(col.id, col.config, max + 1)
  }
}

/** Number every record in the list that doesn't have one yet, oldest position first. Returns how many. */
export function numberExistingRows(columnId: number): number {
  const db = getDb()
  const col = db.prepare("SELECT grid_id FROM columns WHERE id = ? AND column_type = 'auto_number'").get(columnId) as { grid_id: number } | undefined
  if (!col) return 0
  const rows = db.prepare(`
    SELECT r.id FROM rows r
    LEFT JOIN cells c ON c.row_id = r.id AND c.column_id = ?
    WHERE r.grid_id = ? AND r.deleted_at IS NULL AND (c.value IS NULL OR TRIM(c.value) = '')
    ORDER BY r.position, r.id
  `).all(columnId, col.grid_id) as Array<{ id: number }>
  db.transaction(() => assignAutoNumbers(col.grid_id, rows.map(r => r.id)))()
  return rows.length
}

/** A column's config as it should start in a new list: numbering from 1. */
export function freshAutoNumberConfig(rawConfig: string | null | undefined): string {
  let obj: Record<string, unknown> = {}
  try { obj = JSON.parse(rawConfig || '{}') as Record<string, unknown> } catch { obj = {} }
  const cfg = parseAutoNumberConfig(obj)
  return JSON.stringify({ ...obj, prefix: cfg.prefix, pad: cfg.pad, next: DEFAULT_AUTO_NUMBER.next })
}
