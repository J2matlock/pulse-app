import type { Database } from 'better-sqlite3'

/**
 * Called inside the transaction that permanently deletes records, before the rows go,
 * by the 30-day Trash purge in database.ts. list-trash.ts registers here so purged
 * records are also scrubbed from Trash snapshots. A separate module with no imports,
 * because list-trash imports database.ts and database.ts can't import it back.
 */
export const rowsPurgedHooks: Array<(rowIds: number[]) => void> = []

function inChunks(ids: number[], fn: (chunk: number[], marks: string) => void): void {
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500)
    fn(chunk, chunk.map(() => '?').join(','))
  }
}

/**
 * What the foreign keys don't take with records deleted for good (Q-030). Every
 * permanent delete (Delete forever, Empty the Trash, a list deleted for good, the
 * 30-day purge) calls this in its transaction, before the rows go.
 *
 * A repeating appointment's series keeps its record id inside its template, with
 * the title, location and notes, so no cascade reaches it.
 */
export function purgeRecordLeftovers(db: Database, rowIds: number[]): void {
  if (!rowIds.length) return
  const del = (marks: string) => db.prepare(`DELETE FROM appointment_series WHERE json_extract(template, '$.row_id') IN (${marks})`)
  inChunks(rowIds, (chunk, marks) => { del(marks).run(...chunk) })
}

/**
 * After the rows went: link history kept only for records that are now all gone
 * (no live record's audit trail can show it), and pinned dashboard reports whose
 * report went with a deleted list. History with one live end stays: that record's
 * audit trail still shows the link, to "(deleted)".
 */
export function pruneAfterPurge(db: Database, rowIds: number[]): void {
  if (rowIds.length) {
    inChunks(rowIds, (chunk, marks) => {
      db.prepare(`DELETE FROM record_link_history WHERE (from_row_id IN (${marks}) OR to_row_id IN (${marks}))
        AND NOT EXISTS (SELECT 1 FROM rows WHERE id = from_row_id) AND NOT EXISTS (SELECT 1 FROM rows WHERE id = to_row_id)`).run(...chunk, ...chunk)
    })
  }
  const pinned = db.prepare("SELECT value FROM settings WHERE key = 'dashboard_reports'").get() as { value: string } | undefined
  if (!pinned) return
  let ids: unknown
  try { ids = JSON.parse(pinned.value) } catch { return }
  if (!Array.isArray(ids)) return
  const exists = db.prepare('SELECT 1 FROM report_definitions WHERE id = ?')
  const next = ids.filter(id => typeof id === 'number' && exists.get(id))
  if (next.length !== ids.length) db.prepare("UPDATE settings SET value = ? WHERE key = 'dashboard_reports'").run(JSON.stringify(next))
}
