/** A number column's values over time, for the profile's history charts (W10 §5). */
import { getDb } from './database'
import { parseNumberCell } from '../shared/numbers'

export interface SeriesPoint { at: string; value: number }

/** "$1,234.50" → 1234.5; anything that isn't a number → null */
export const toNumber = parseNumberCell

/**
 * Each change to these number columns of a record, oldest first (stored
 * UTC timestamps). Values that aren't numbers are skipped. Only number and
 * currency columns of the record's own list are read.
 */
export function numberSeries(rowId: number, columnIds: number[]): Record<number, SeriesPoint[]> {
  const db = getDb()
  const cols = columnIds.length
    ? (db.prepare(`SELECT c.id FROM columns c JOIN rows r ON r.grid_id = c.grid_id WHERE r.id = ? AND c.column_type IN ('number', 'currency')
        AND c.id IN (${columnIds.map(() => '?').join(',')})`).all(rowId, ...columnIds) as Array<{ id: number }>).map(c => c.id)
    : []
  const out: Record<number, SeriesPoint[]> = {}
  if (cols.length === 0) return out
  const rows = db.prepare(`SELECT column_id, new_value, changed_at FROM cell_history WHERE row_id = ? AND column_id IN (${cols.map(() => '?').join(',')})
    ORDER BY changed_at, id`).all(rowId, ...cols) as Array<{ column_id: number; new_value: string | null; changed_at: string }>
  for (const id of cols) out[id] = []
  for (const r of rows) {
    const n = toNumber(r.new_value)
    if (n !== null) out[r.column_id]!.push({ at: r.changed_at, value: n })
  }
  return out
}
