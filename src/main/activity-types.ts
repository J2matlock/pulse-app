/**
 * People's own note types (plans/generalization/W03-activity.md §2.4).
 * Keys are made once from the first label and never change, so old notes,
 * requirements and date-column rules keep pointing at the right type.
 */
import { getDb } from './database'
import { word } from './vocab'
import {
  ACTIVITY_COLORS, ACTIVITY_ICON_MAX, ACTIVITY_LABEL_MAX, SYSTEM_ACTIVITY_TYPES,
  keyFromLabel, labelFor, type ActivityColor, type ActivityType,
} from '../shared/activityTypes'

/** A problem the person can fix; the message is shown as is. */
export class ActivityTypeError extends Error {}

// Cached per connection: a closed or replaced database (restore, lock) starts fresh
interface Cache { active: Set<string>; all: Set<string>; labels: Array<{ key: string; label: string }> }
const caches = new WeakMap<object, Cache>()

function cache(): Cache {
  const db = getDb()
  let c = caches.get(db)
  if (!c) {
    const rows = db.prepare('SELECT key, label, is_archived FROM activity_types').all() as Array<{ key: string; label: string; is_archived: number }>
    c = { active: new Set(rows.filter(r => !r.is_archived).map(r => r.key)), all: new Set(rows.map(r => r.key)), labels: rows }
    caches.set(db, c)
  }
  return c
}

function invalidate(): void { caches.delete(getDb()) }

/** The label people see for a note type key (archived, system and unknown keys included). */
export function activityLabel(key: string): string {
  return labelFor(cache().labels, key)
}

export function listActivityTypes(includeArchived = false): ActivityType[] {
  return getDb().prepare(`
    SELECT id, key, label, icon, color, position, is_archived FROM activity_types
    ${includeArchived ? '' : 'WHERE is_archived = 0'}
    ORDER BY position, id
  `).all() as ActivityType[]
}

/** Keys people can pick (active), or every key they ever made (archived too). */
export function userTypeKeys(includeArchived = false): Set<string> {
  return includeArchived ? cache().all : cache().active
}

/** Valid log_type for a new note: system types and active user types. Edits and restores also allow archived ones. */
export function isValidLogType(key: unknown, opts: { allowArchived?: boolean } = {}): key is string {
  if (typeof key !== 'string') return false
  return (SYSTEM_ACTIVITY_TYPES as readonly string[]).includes(key) || userTypeKeys(!!opts.allowArchived).has(key)
}

function byId(id: number): ActivityType | undefined {
  return getDb().prepare('SELECT id, key, label, icon, color, position, is_archived FROM activity_types WHERE id = ?').get(id) as ActivityType | undefined
}

export interface ActivityTypeInput { id?: number; label: unknown; icon?: unknown; color?: unknown }

export function saveActivityType(input: ActivityTypeInput): ActivityType {
  const db = getDb()
  const label = typeof input.label === 'string' ? input.label.replace(/\s+/g, ' ').trim() : ''
  if (!label) throw new ActivityTypeError('Give the type a name.')
  if (label.length > ACTIVITY_LABEL_MAX) throw new ActivityTypeError(`Type names can be up to ${ACTIVITY_LABEL_MAX} characters.`)
  const icon = typeof input.icon === 'string' && input.icon.trim() ? input.icon.trim() : null
  if (icon && [...icon].length > ACTIVITY_ICON_MAX) throw new ActivityTypeError('Pick a single emoji or symbol for the icon.')
  const color = typeof input.color === 'string' && (ACTIVITY_COLORS as readonly string[]).includes(input.color) ? input.color as ActivityColor : null

  const clash = db.prepare('SELECT id FROM activity_types WHERE LOWER(label) = LOWER(?) AND is_archived = 0').get(label) as { id: number } | undefined
  if (clash && clash.id !== input.id) throw new ActivityTypeError(`There's already a type called "${label}".`)

  if (input.id !== undefined) {
    if (!byId(input.id)) throw new ActivityTypeError('That type no longer exists.')
    db.prepare('UPDATE activity_types SET label = ?, icon = ?, color = ? WHERE id = ?').run(label, icon, color, input.id)
    invalidate()
    return byId(input.id)!
  }

  const id = db.transaction(() => {
    const taken = new Set((db.prepare('SELECT key FROM activity_types').all() as Array<{ key: string }>).map(r => r.key))
    const key = keyFromLabel(label, taken)
    const pos = (db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM activity_types').get() as { p: number }).p
    return Number(db.prepare('INSERT INTO activity_types (key, label, icon, color, position) VALUES (?, ?, ?, ?, ?)').run(key, label, icon, color, pos).lastInsertRowid)
  })()
  invalidate()
  return byId(id)!
}

export function setActivityTypeArchived(id: number, archived: boolean): void {
  const db = getDb()
  const type = byId(id)
  if (!type) throw new ActivityTypeError('That type no longer exists.')
  if (archived && !type.is_archived) {
    const active = (db.prepare('SELECT COUNT(*) AS n FROM activity_types WHERE is_archived = 0').get() as { n: number }).n
    if (active <= 1) throw new ActivityTypeError('Keep at least one type to choose from.')
  }
  db.prepare('UPDATE activity_types SET is_archived = ? WHERE id = ?').run(archived ? 1 : 0, id)
  invalidate()
}

/** How many notes, requirements and date-column rules use a key. */
export function activityTypeUsage(key: string): { notes: number; rules: number } {
  const db = getDb()
  const notes = (db.prepare('SELECT COUNT(*) AS n FROM case_log WHERE log_type = ?').get(key) as { n: number }).n
  // Stored JSON could be malformed; treat that as "uses nothing" rather than failing
  const reqs = (db.prepare(`SELECT COUNT(*) AS n FROM contact_requirements r,
    json_each(CASE WHEN json_valid(r.note_types) THEN r.note_types ELSE '[]' END) j WHERE j.value = ?`).get(key) as { n: number }).n
  const cols = (db.prepare(`SELECT COUNT(*) AS n FROM columns c,
    json_each(CASE WHEN json_valid(c.config) AND json_type(c.config, '$.note_updates') = 'array' THEN json_extract(c.config, '$.note_updates') ELSE '[]' END) j
    WHERE j.value = ?`).get(key) as { n: number }).n
  return { notes, rules: reqs + cols }
}

/** Only a type nothing uses can be deleted; anything else is archived instead. */
export function deleteActivityType(id: number): void {
  const db = getDb()
  const type = byId(id)
  if (!type) throw new ActivityTypeError('That type no longer exists.')
  const { notes, rules } = activityTypeUsage(type.key)
  if (notes > 0) throw new ActivityTypeError(`This type is used by ${notes} ${word('activity', { count: notes })}. Archive it instead.`)
  if (rules > 0) throw new ActivityTypeError(`This type is used by ${word('requirement', { article: true })} or a date column. Archive it instead.`)
  if (!type.is_archived) {
    const active = (db.prepare('SELECT COUNT(*) AS n FROM activity_types WHERE is_archived = 0').get() as { n: number }).n
    if (active <= 1) throw new ActivityTypeError('Keep at least one type to choose from.')
  }
  db.prepare('DELETE FROM activity_types WHERE id = ?').run(id)
  invalidate()
}

/**
 * Add an example's note types that the workspace doesn't have yet (by key).
 * Existing types are never renamed or recolored. Returns how many were added.
 */
export function addMissingActivityTypes(types: Array<{ key: string; label: string; icon?: string; color?: ActivityColor }>): number {
  const db = getDb()
  const have = new Set((db.prepare('SELECT key FROM activity_types').all() as Array<{ key: string }>).map(r => r.key))
  const labels = new Set((db.prepare('SELECT LOWER(label) AS l FROM activity_types WHERE is_archived = 0').all() as Array<{ l: string }>).map(r => r.l))
  let pos = (db.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM activity_types').get() as { p: number }).p
  const insert = db.prepare('INSERT INTO activity_types (key, label, icon, color, position) VALUES (?, ?, ?, ?, ?)')
  let added = 0
  for (const t of types) {
    if (have.has(t.key) || (SYSTEM_ACTIVITY_TYPES as readonly string[]).includes(t.key)) continue
    // A same-named type with another key would be two "Session" chips; keep theirs
    if (labels.has(t.label.toLowerCase())) continue
    insert.run(t.key, t.label, t.icon ?? null, t.color ?? null, ++pos)
    have.add(t.key); labels.add(t.label.toLowerCase())
    added++
  }
  if (added) invalidate()
  return added
}

/** The people-centric types every new workspace starts with (besides Note) */
const STARTING_TYPES = ['phone', 'meeting', 'email', 'visit']

/**
 * An example that lists its own full set of note types (it includes "note")
 * replaces the starting ones in a fresh workspace, so a tree service doesn't
 * get both Phone and Call, or Visit and Site visit. Only starting types no
 * note, requirement or rule uses are archived (never deleted), and only while
 * the workspace has no notes of its own. Returns how many were archived.
 */
export function replaceStartingTypes(exampleKeys: string[]): number {
  if (!exampleKeys.includes('note')) return 0
  const db = getDb()
  const ownNotes = (db.prepare("SELECT COUNT(*) AS n FROM case_log WHERE log_type != 'system'").get() as { n: number }).n
  if (ownNotes > 0) return 0
  const archive = db.prepare('UPDATE activity_types SET is_archived = 1 WHERE key = ? AND is_archived = 0')
  let archived = 0
  for (const key of STARTING_TYPES) {
    if (exampleKeys.includes(key)) continue
    const use = activityTypeUsage(key)
    if (use.notes > 0 || use.rules > 0) continue
    archived += archive.run(key).changes
  }
  if (archived) invalidate()
  return archived
}

export function reorderActivityTypes(ids: number[]): void {
  const db = getDb()
  const update = db.prepare('UPDATE activity_types SET position = ? WHERE id = ?')
  db.transaction(() => ids.forEach((id, i) => update.run(i, id)))()
  invalidate()
}
