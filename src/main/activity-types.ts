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

/**
 * How many notes use a key, and what else depends on it: requirements,
 * date columns, deadline rules that count it, forms that log it, stage
 * steps that write it, and appointments. `uses` names the non-note ones.
 */
export function activityTypeUsage(key: string): { notes: number; rules: number; uses: string[] } {
  const db = getDb()
  const notes = (db.prepare('SELECT COUNT(*) AS n FROM case_log WHERE log_type = ?').get(key) as { n: number }).n
  const uses: string[] = []
  // Stored JSON could be malformed; treat that as "uses nothing" rather than failing
  const reqs = db.prepare(`SELECT DISTINCT r.label FROM contact_requirements r,
    json_each(CASE WHEN json_valid(r.note_types) THEN r.note_types ELSE '[]' END) j WHERE j.value = ?`).all(key) as Array<{ label: string }>
  for (const r of reqs) uses.push(`${word('requirement')} "${r.label}"`)
  const cols = db.prepare(`SELECT DISTINCT c.name FROM columns c,
    json_each(CASE WHEN json_valid(c.config) AND json_type(c.config, '$.note_updates') = 'array' THEN json_extract(c.config, '$.note_updates') ELSE '[]' END) j
    WHERE j.value = ?`).all(key) as Array<{ name: string }>
  for (const c of cols) uses.push(`date column "${c.name}"`)
  const rules = db.prepare(`SELECT DISTINCT a.name FROM alert_rules a,
    json_each(CASE WHEN a.kind = 'quota' AND json_valid(a.rule_config) AND json_type(a.rule_config, '$.activityTypes') = 'array'
      THEN json_extract(a.rule_config, '$.activityTypes') ELSE '[]' END) j WHERE j.value = ?`).all(key) as Array<{ name: string }>
  for (const r of rules) uses.push(`deadline rule "${r.name}"`)
  const forms = db.prepare('SELECT name FROM forms WHERE log_activity_type = ?').all(key) as Array<{ name: string }>
  for (const f of forms) uses.push(`form "${f.name}"`)
  const stageCols = db.prepare(`SELECT DISTINCT c.name FROM columns c,
    json_each(CASE WHEN json_valid(c.config) AND json_type(c.config, '$.stage.options') = 'array' THEN json_extract(c.config, '$.stage.options') ELSE '[]' END) o
    WHERE json_extract(o.value, '$.onEnter.activityTypeKey') = ?`).all(key) as Array<{ name: string }>
  for (const c of stageCols) uses.push(`${word('stage')} column "${c.name}"`)
  const appts = (db.prepare('SELECT COUNT(*) AS n FROM appointments WHERE activity_type_key = ?').get(key) as { n: number }).n
    + (db.prepare("SELECT COUNT(*) AS n FROM appointment_series WHERE json_valid(template) AND json_extract(template, '$.activity_type_key') = ?").get(key) as { n: number }).n
  if (appts > 0) uses.push(`${appts} ${word('appointment', { count: appts })}`)
  return { notes, rules: uses.length, uses }
}

/** Only a type nothing uses can be deleted; anything else is archived instead. */
export function deleteActivityType(id: number): void {
  const db = getDb()
  const type = byId(id)
  if (!type) throw new ActivityTypeError('That type no longer exists.')
  const { notes, uses } = activityTypeUsage(type.key)
  if (notes > 0) throw new ActivityTypeError(`This type is used by ${notes} ${word('activity', { count: notes })}. Archive it instead.`)
  if (uses.length > 0) {
    const named = uses.length > 3 ? `${uses.slice(0, 3).join(', ')} and ${uses.length - 3} more` : uses.join(', ')
    throw new ActivityTypeError(`This type is used by ${named}. Archive it instead.`)
  }
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

export function reorderActivityTypes(ids: number[]): void {
  const db = getDb()
  const update = db.prepare('UPDATE activity_types SET position = ? WHERE id = ?')
  db.transaction(() => ids.forEach((id, i) => update.run(i, id)))()
  invalidate()
}
