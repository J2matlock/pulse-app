/**
 * Undo for library items that are deleted for good: checklist, letter and list
 * templates, forms, saved reports and snippets (UX pass Q4, step B2).
 *
 * The delete reads the whole row inside its own transaction and keeps it here,
 * in main's memory, under a random token; the renderer only ever gets the
 * token. Undo hands the token back and the row is put back with the same id,
 * so a column's "add this checklist when done", a form's filled copies and a
 * report's dashboard pin still point at it. Nothing the renderer sends becomes
 * a table name, a column name or a value: those all come from the kept row.
 *
 * Copies live for the session (the newest MAX_KEPT), like the undo history.
 */
import { randomUUID } from 'crypto'
import type { Database } from 'better-sqlite3-multiple-ciphers'
import { getDb, registerCloseHook } from './database'
import type { LibraryKind } from '../shared/libraryKinds'

/** The table for each kind: fixed here, never named by the renderer */
const TABLE: Record<LibraryKind, string> = {
  'checklist-template': 'checklist_templates',
  'letter-template': 'letter_templates',
  'setup-template': 'setup_templates',
  form: 'forms',
  report: 'report_definitions',
  snippet: 'snippets',
}

/** Thrown with a message written for people */
export class LibraryRestoreError extends Error {}

interface Kept {
  kind: LibraryKind
  row: Record<string, unknown>
  /** Where a report sat on the dashboard, to pin it there again */
  pinAt: number | null
}

export const MAX_KEPT = 200
const kept = new Map<string, Kept>()

function dashboardPins(db: Database): number[] {
  const raw = (db.prepare("SELECT value FROM settings WHERE key = 'dashboard_reports'").get() as { value: string } | undefined)?.value
  if (!raw) return []
  try {
    const ids: unknown = JSON.parse(raw)
    return Array.isArray(ids) ? ids.filter((x): x is number => typeof x === 'number') : []
  } catch { return [] }
}

/**
 * Run `del` (the item's own delete) and keep a copy of the row it removed.
 * Returns the token for Undo, or null when there was no such row.
 */
export function deleteKeepingCopy(kind: LibraryKind, id: number, del: () => void): string | null {
  const db = getDb()
  return db.transaction(() => {
    const row = db.prepare(`SELECT * FROM ${TABLE[kind]} WHERE id = ?`).get(id) as Record<string, unknown> | undefined
    const pinAt = kind === 'report' ? dashboardPins(db).indexOf(id) : -1
    del()
    if (!row) return null
    const token = randomUUID()
    kept.set(token, { kind, row, pinAt: pinAt >= 0 ? pinAt : null })
    while (kept.size > MAX_KEPT) {
      const oldest = kept.keys().next().value
      if (oldest === undefined) break
      kept.delete(oldest)
    }
    return token
  })()
}

/** Put a deleted item back under its own id. The token works once. */
export function restoreLibraryItem(token: string): { kind: LibraryKind; id: number } {
  const item = kept.get(token)
  if (!item) throw new LibraryRestoreError("That can't be brought back any more.")
  const db = getDb()
  const table = TABLE[item.kind]
  const id = Number(item.row.id)
  db.transaction(() => {
    if (db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id)) {
      throw new LibraryRestoreError("That can't be brought back: something new is using its place.")
    }
    if (item.kind === 'snippet' && db.prepare('SELECT 1 FROM snippets WHERE trigger_text = ?').get(item.row.trigger_text)) {
      throw new LibraryRestoreError("That snippet can't be brought back: another one uses its shortcut now.")
    }
    // Only columns the table has (all of them, in practice: the copy came from this table this session)
    const cols = (db.prepare('SELECT name FROM pragma_table_info(?)').all(table) as Array<{ name: string }>)
      .map(c => c.name)
      .filter(c => Object.prototype.hasOwnProperty.call(item.row, c))
    const quoted = cols.map(c => `"${c.replace(/"/g, '""')}"`)
    try {
      db.prepare(`INSERT INTO ${table} (${quoted.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map(c => item.row[c]))
    } catch (err) {
      // A list it belonged to was deleted for good meanwhile, or a unique name was taken
      if (err instanceof Error && /constraint/i.test(err.message)) {
        throw new LibraryRestoreError("That can't be brought back: something it belonged to is gone, or something new is using its place.")
      }
      throw err
    }
    if (item.kind === 'report' && item.pinAt !== null) {
      const pins = dashboardPins(db).filter(x => x !== id)
      pins.splice(Math.min(item.pinAt, pins.length), 0, id)
      db.prepare("INSERT INTO settings (key, value) VALUES ('dashboard_reports', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(pins))
    }
  })()
  kept.delete(token)
  return { kind: item.kind, id }
}

/** For tests, and when the data behind the copies is gone */
export function forgetLibraryCopies(): void {
  kept.clear()
}

// Lock, quit and backup restore all close the database: the deleted copies go with it,
// so nothing deleted lingers in memory while Pulse is locked or after a restore
registerCloseHook(forgetLibraryCopies)
