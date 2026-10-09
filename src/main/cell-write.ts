/** Writing one cell outside CELL_UPDATE (deadline and stage actions), with its history. */
import { getDb } from './database'

/** Write one cell with history, returning what it was. */
export function setCellWithHistory(rowId: number, columnId: number, value: string | null): string | null {
  const db = getDb()
  const existing = db.prepare('SELECT id, value FROM cells WHERE row_id = ? AND column_id = ?').get(rowId, columnId) as { id: number; value: string | null } | undefined
  db.prepare(`INSERT INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(row_id, column_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(rowId, columnId, value)
  const cellId = existing?.id ?? (db.prepare('SELECT id FROM cells WHERE row_id = ? AND column_id = ?').get(rowId, columnId) as { id: number }).id
  if ((existing?.value ?? null) !== value) {
    db.prepare("INSERT INTO cell_history (cell_id, row_id, column_id, old_value, new_value, changed_at) VALUES (?, ?, ?, ?, ?, datetime('now'))")
      .run(cellId, rowId, columnId, existing?.value ?? null, value)
  }
  return existing?.value ?? null
}
