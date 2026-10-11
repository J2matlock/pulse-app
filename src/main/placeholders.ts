/**
 * Document placeholders (generalization W10 §3): `{{name}}`,
 * `{{field:Column}}`, `{{linked:Owner.Phone}}`, `{{my_name}}`, `{{today}}`,
 * `{{deadline:Column}}`, plus every placeholder older letters use, kept
 * forever. Unknown placeholders stay visible and are reported.
 */
import { getDb } from './database'
import { loadDeadlines } from './deadlines'
import { listLinkTypes } from './links'
import { holdsOne, linkValueText } from '../shared/links'
import { formatDue } from '../shared/deadlineEngine'
import { formatTime } from '../shared/calendar'
import { featureOn, word } from './vocab'

interface Col { id: number; grid_id: number; name: string; column_type: string; is_name_column: number; config: string | null }

const LONG = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

function longDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd)
  if (!m) return ymd
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? ymd : LONG.format(d)
}

/** A value as a document shows it */
function formatValue(value: string | null | undefined, type: string): string {
  if (value == null || value === '') return ''
  switch (type) {
    case 'date': case 'deadline': return longDate(value)
    case 'checkbox': return value === 'true' || value === '1' ? 'Yes' : 'No'
    case 'currency': {
      const n = Number(value)
      return Number.isFinite(n) ? n.toLocaleString('en-US', { style: 'currency', currency: 'USD' }) : value
    }
    case 'link': return linkValueText(value)
    default: return value
  }
}

const snake = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
const norm = (s: string) => s.trim().toLowerCase()

export interface ResolveResult {
  text: string
  /** Placeholders that matched nothing, as typed */
  unknown: string[]
}

/** Fill a document's placeholders for one record. */
export function resolvePlaceholders(content: string, rowId: number, gridId: number, today = new Date()): ResolveResult {
  const db = getDb()
  const columns = db.prepare('SELECT id, grid_id, name, column_type, is_name_column, config FROM columns WHERE grid_id = ? ORDER BY position').all(gridId) as Col[]
  const cellOf = db.prepare('SELECT value FROM cells WHERE row_id = ? AND column_id = ?')
  const cells = new Map((db.prepare('SELECT column_id, value FROM cells WHERE row_id = ?').all(rowId) as Array<{ column_id: number; value: string | null }>).map(c => [c.column_id, c.value]))
  const row = db.prepare('SELECT display_name FROM rows WHERE id = ?').get(rowId) as { display_name: string | null } | undefined
  const nameCol = columns.find(c => c.is_name_column === 1)
  // "(unnamed)" is the list's stand-in; a document leaves it blank
  const display = row?.display_name && row.display_name !== '(unnamed)' ? row.display_name : ''
  const name = display || (nameCol ? cells.get(nameCol.id) ?? '' : '')
  const profile = Object.fromEntries((db.prepare("SELECT key, value FROM settings WHERE key LIKE 'profile_%'").all() as Array<{ key: string; value: string }>).map(r => [r.key, r.value]))
  const ymdToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

  // The fixed placeholders, new names and old ones
  const fixed: Record<string, string> = {
    name, client_name: name,
    my_name: profile.profile_name ?? '', my_title: profile.profile_title ?? '', my_org: profile.profile_org ?? '',
    my_phone: profile.profile_phone ?? '', my_email: profile.profile_email ?? '',
    case_manager_name: profile.profile_name ?? '', case_manager_title: profile.profile_title ?? '', case_manager_org: profile.profile_org ?? '',
    case_manager_phone: profile.profile_phone ?? '', case_manager_email: profile.profile_email ?? '',
    today: formatDue(ymdToday), 'today:long': longDate(ymdToday), today_date: longDate(ymdToday),
  }
  // Older letters name columns in snake case ({{date_of_birth}}), with a few well-known extras
  for (const c of columns) {
    const raw = cells.get(c.id) ?? null
    const shown = formatValue(raw, c.column_type)
    fixed[snake(c.name)] ??= shown
    const lower = c.name.toLowerCase()
    if (lower.includes('dob') || lower.includes('birth')) {
      fixed.dob = shown
      const m = raw ? /^(\d{4})-(\d{2})-(\d{2})/.exec(raw) : null
      if (m) {
        const born = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
        let age = today.getFullYear() - born.getFullYear()
        if (today.getMonth() < born.getMonth() || (today.getMonth() === born.getMonth() && today.getDate() < born.getDate())) age--
        fixed.age = String(age)
      }
    }
    if (lower.includes('medicaid') || lower.includes('cin')) fixed.medicaid_cin = raw ?? ''
  }

  // The record's next scheduled appointment (W07 §7)
  let nextAppt: { start_at: string; all_day: number; location: string | null } | null | undefined
  const appointment = () => {
    if (nextAppt === undefined) {
      const nowWall = `${ymdToday}T${String(today.getHours()).padStart(2, '0')}:${String(today.getMinutes()).padStart(2, '0')}`
      nextAppt = (db.prepare("SELECT start_at, all_day, location FROM appointments WHERE row_id = ? AND status = 'scheduled' AND (start_at >= ? OR (all_day = 1 AND start_at >= ?)) ORDER BY start_at LIMIT 1")
        .get(rowId, nowWall, ymdToday) as { start_at: string; all_day: number; location: string | null } | undefined) ?? null
    }
    return nextAppt
  }
  fixed['appointment.date'] = ''
  fixed['appointment.time'] = ''
  fixed['appointment.location'] = ''

  let deadlines: Map<number, string | null> | null = null
  const deadlineOf = (columnId: number): string | null => {
    deadlines ??= new Map(loadDeadlines({ rowIds: [rowId], includePaused: true }).map(d => [d.column_id, d.due]))
    return deadlines.get(columnId) ?? null
  }

  const resolveOne = (key: string): string | undefined => {
    if (key.startsWith('appointment.') && key in fixed) {
      const a = appointment()
      if (!a) return ''
      if (key === 'appointment.date') return longDate(a.start_at)
      if (key === 'appointment.time') return a.all_day ? 'all day' : formatTime(a.start_at, '12h')
      return a.location ?? ''
    }
    if (key in fixed) return fixed[key]
    const [kind, ...rest] = key.split(':')
    const arg = rest.join(':').trim()
    if (!arg) return undefined
    if (kind === 'field') {
      const c = columns.find(x => norm(x.name) === norm(arg))
      return c ? formatValue(cells.get(c.id) ?? null, c.column_type) : undefined
    }
    if (kind === 'deadline') {
      const c = columns.find(x => norm(x.name) === norm(arg) && (x.column_type === 'date' || x.column_type === 'deadline'))
      if (!c) return undefined
      const due = deadlineOf(c.id)
      return due ? longDate(due) : ''
    }
    if (kind === 'linked') {
      // "Owner.Phone": the record this one links to as its Owner, then its Phone
      const dot = arg.lastIndexOf('.')
      if (dot < 1) return undefined
      const label = norm(arg.slice(0, dot)), field = norm(arg.slice(dot + 1))
      for (const lt of listLinkTypes(gridId)) {
        const side = lt.from_grid_id === gridId && norm(lt.label_forward) === label && holdsOne(lt.cardinality, 'forward') ? 'forward'
          : lt.to_grid_id === gridId && norm(lt.label_backward) === label && holdsOne(lt.cardinality, 'backward') ? 'backward' : null
        if (!side) continue
        const otherGrid = side === 'forward' ? lt.to_grid_id : lt.from_grid_id
        const target = (side === 'forward'
          ? db.prepare('SELECT l.to_row_id AS id FROM record_links l JOIN rows t ON t.id = l.to_row_id WHERE l.link_type_id = ? AND l.from_row_id = ? AND t.deleted_at IS NULL').get(lt.id, rowId)
          : db.prepare('SELECT l.from_row_id AS id FROM record_links l JOIN rows t ON t.id = l.from_row_id WHERE l.link_type_id = ? AND l.to_row_id = ? AND t.deleted_at IS NULL').get(lt.id, rowId)) as { id: number } | undefined
        if (field === 'name') return target ? (db.prepare('SELECT display_name FROM rows WHERE id = ?').get(target.id) as { display_name: string | null }).display_name ?? '' : ''
        const col = db.prepare('SELECT id, column_type FROM columns WHERE grid_id = ? AND LOWER(TRIM(name)) = ?').get(otherGrid, field) as { id: number; column_type: string } | undefined
        if (!col) return undefined
        return target ? formatValue((cellOf.get(target.id, col.id) as { value: string | null } | undefined)?.value ?? null, col.column_type) : ''
      }
      return undefined
    }
    return undefined
  }

  const unknown = new Set<string>()
  const text = content.replace(/\{\{\s*([^{}\n]{1,200}?)\s*\}\}/g, (whole, key: string) => {
    const v = resolveOne(key.trim())
    if (v === undefined) { unknown.add(whole); return whole }
    return v
  })
  return { text, unknown: [...unknown] }
}

export interface FieldGroup { label: string; items: Array<{ key: string; desc: string }> }

/** "Insert field" groups for a list: its columns, deadlines, and linked records' columns */
export function placeholderFields(gridId: number): FieldGroup[] {
  const db = getDb()
  const columns = db.prepare("SELECT id, name, column_type, config FROM columns WHERE grid_id = ? AND is_visible = 1 ORDER BY position").all(gridId) as Array<{ id: number; name: string; column_type: string; config: string | null }>
  const groups: FieldGroup[] = [{ label: 'Columns', items: columns.map(c => ({ key: `{{field:${c.name}}}`, desc: c.name })) }]
  const withRules = columns.filter(c => (c.column_type === 'date' || c.column_type === 'deadline') && /"alert_rule_id"\s*:\s*\d/.test(c.config ?? ''))
  if (withRules.length) groups.push({ label: 'Deadlines', items: withRules.map(c => ({ key: `{{deadline:${c.name}}}`, desc: `When ${c.name} is due` })) })
  const linked: FieldGroup['items'] = []
  for (const lt of listLinkTypes(gridId)) {
    for (const side of ['forward', 'backward'] as const) {
      const mine = side === 'forward' ? lt.from_grid_id : lt.to_grid_id
      if (mine !== gridId || !holdsOne(lt.cardinality, side)) continue
      const label = side === 'forward' ? lt.label_forward : lt.label_backward
      const other = side === 'forward' ? lt.to_grid_id : lt.from_grid_id
      linked.push({ key: `{{linked:${label}.name}}`, desc: `${label}: name` })
      for (const c of db.prepare("SELECT name FROM columns WHERE grid_id = ? AND is_visible = 1 AND is_name_column = 0 AND column_type != 'link' ORDER BY position LIMIT 12").all(other) as Array<{ name: string }>) {
        linked.push({ key: `{{linked:${label}.${c.name}}}`, desc: `${label}: ${c.name}` })
      }
    }
  }
  if (linked.length) groups.push({ label: 'Linked', items: linked })
  if (featureOn('appointments')) groups.push({ label: `Next ${word('appointment')}`, items: [
    { key: '{{appointment.date}}', desc: `Date of the next ${word('appointment')}` },
    { key: '{{appointment.time}}', desc: 'Its time' },
    { key: '{{appointment.location}}', desc: 'Where it is' },
  ] })
  return groups
}
