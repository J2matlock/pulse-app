/**
 * Unsent note drafts, one per record, in the encrypted database's settings
 * table (key `note_draft:<rowId>`). Same file as the notes themselves, so a
 * draft is encrypted at rest, goes into backups, and never touches the disk
 * in the clear. No schema change: the settings table is key/value.
 *
 * A draft for a record in the Trash (or in a list in the Trash) is hidden,
 * and comes back with the record. Purged records' drafts are swept when the
 * drafts are listed, so the four purge paths need no hook.
 */
import { getDb, cachedStmt } from './database'
import { NOT_TRASHED_ROW, LIVE_GRID } from '../shared/liveRecords'
import {
  NOTE_DRAFT_PREFIX, isEmptyNoteDraft, noteDraftSchema,
  type NoteDraft, type NoteDraftSummary, type SavedNoteDraft,
} from '../shared/noteDraft'

/** SQL: the key is a draft's (LIKE would read the _ as a wildcard) */
const IS_DRAFT_KEY = (col: string) => `substr(${col}, 1, ${NOTE_DRAFT_PREFIX.length}) = '${NOTE_DRAFT_PREFIX}'`

function draftKey(rowId: number): string {
  return `${NOTE_DRAFT_PREFIX}${rowId}`
}

/** A record notes can be written for: not in the Trash, its list not in the Trash */
function recordOpen(rowId: number): boolean {
  return !!cachedStmt('nd_record_open',
    `SELECT 1 FROM rows r JOIN grids g ON g.id = r.grid_id WHERE r.id = ? AND ${NOT_TRASHED_ROW} AND ${LIVE_GRID}`).get(rowId)
}

/** A stored value read back, or null when it isn't a draft this version understands */
function parseStored(value: string): SavedNoteDraft | null {
  try {
    const raw = JSON.parse(value) as unknown
    const draft = noteDraftSchema.safeParse(raw)
    const savedAt = (raw as { savedAt?: unknown } | null)?.savedAt
    if (!draft.success || typeof savedAt !== 'string') return null
    return { ...draft.data, savedAt }
  } catch {
    return null
  }
}

export function getDraft(rowId: number): SavedNoteDraft | null {
  if (!recordOpen(rowId)) return null
  const row = cachedStmt('nd_get', 'SELECT value FROM settings WHERE key = ?').get(draftKey(rowId)) as { value: string } | undefined
  return row ? parseStored(row.value) : null
}

/**
 * Store the draft (an empty one deletes it). Returns false when the record
 * can't take notes now (gone, or in the Trash): nothing is stored then.
 */
export function putDraft(rowId: number, draft: NoteDraft): boolean {
  if (isEmptyNoteDraft(draft)) {
    cachedStmt('nd_delete', 'DELETE FROM settings WHERE key = ?').run(draftKey(rowId))
    return true
  }
  if (!recordOpen(rowId)) return false
  const saved: SavedNoteDraft = { ...draft, savedAt: new Date().toISOString() }
  cachedStmt('nd_put', 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(draftKey(rowId), JSON.stringify(saved))
  return true
}

/** Drafts of records that no longer exist (emptied from the Trash) */
function sweepOrphans(): void {
  cachedStmt('nd_sweep', `DELETE FROM settings WHERE ${IS_DRAFT_KEY('key')}
    AND CAST(substr(key, ${NOTE_DRAFT_PREFIX.length + 1}) AS INTEGER) NOT IN (SELECT id FROM rows)`).run()
}

/** Every record with an unsent note, most recent first */
export function listDrafts(): NoteDraftSummary[] {
  const db = getDb()
  db.transaction(sweepOrphans)()
  const rows = cachedStmt('nd_list', `
    SELECT r.id AS rowId, r.grid_id AS gridId, COALESCE(NULLIF(r.display_name, ''), '(unnamed)') AS name, s.value AS value
    FROM settings s
    JOIN rows r ON r.id = CAST(substr(s.key, ${NOTE_DRAFT_PREFIX.length + 1}) AS INTEGER)
    JOIN grids g ON g.id = r.grid_id
    WHERE ${IS_DRAFT_KEY('s.key')} AND ${NOT_TRASHED_ROW} AND ${LIVE_GRID}`)
    .all() as Array<{ rowId: number; gridId: number; name: string; value: string }>
  const out: NoteDraftSummary[] = []
  for (const r of rows) {
    const d = parseStored(r.value)
    if (d) out.push({ rowId: r.rowId, gridId: r.gridId, name: r.name, savedAt: d.savedAt })
  }
  return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt))
}
