/**
 * Document placeholders (generalization W10 §3): `{{name}}`,
 * `{{field:Column}}`, `{{linked:Owner.Phone}}`, `{{my_name}}`, `{{today}}`,
 * `{{deadline:Column}}`, plus every placeholder older letters use, kept
 * forever. Unknown placeholders stay visible and are reported.
 */
import { getDb } from './database'
import { loadDeadlines, type DeadlineItem } from './deadlines'
import { daysUntilText } from './export-shared'
import { listLinkTypes } from './links'
import { holdsOne, linkValueText, linkColumnSpecs, linkSelectSql } from '../shared/links'
import { formatDue } from '../shared/deadlineEngine'
import { formatTime } from '../shared/calendar'
import { featureOn, word } from './vocab'
import { tagText } from '../shared/tagValue'

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
    case 'tag': return tagText(value)
    default: return value
  }
}

/** Whole years from a "YYYY-MM-DD" birth date to `today`; '' when there's no date */
function ageOn(dob: string | null | undefined, today: Date): string {
  const m = dob ? /^(\d{4})-(\d{2})-(\d{2})/.exec(dob) : null
  if (!m) return ''
  let age = today.getFullYear() - Number(m[1])
  const month = today.getMonth() + 1, day = today.getDate()
  if (month < Number(m[2]) || (month === Number(m[2]) && day < Number(m[3]))) age--
  return age >= 0 ? String(age) : ''
}

/** "5 days", "Due today", "3 days overdue", as the list shows a Days-until column */
function daysText(target: string | null | undefined, today: Date): string {
  const m = target ? /^(\d{4})-(\d{2})-(\d{2})/.exec(target) : null
  if (!m) return ''
  const due = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  return daysUntilText(Math.round((due - now) / 86_400_000))
}

const sourceOf = (config: string | null): number | null => {
  try {
    const id = (JSON.parse(config || '{}') as { source_column_id?: unknown }).source_column_id
    return typeof id === 'number' ? id : null
  } catch { return null }
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
  const cellsOfRow = (id: number) => new Map((db.prepare('SELECT column_id, value FROM cells WHERE row_id = ?').all(id) as Array<{ column_id: number; value: string | null }>).map(c => [c.column_id, c.value]))
  const cells = cellsOfRow(rowId)
  const ymdToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  // A Days-until column whose source date has a deadline rule counts to when
  // it's due, as the list and the exports do, not to the date itself
  const ruled = new Map<number, boolean>()
  const hasRule = (columnId: number): boolean => {
    let r = ruled.get(columnId)
    if (r === undefined) {
      const config = (db.prepare('SELECT config FROM columns WHERE id = ?').get(columnId) as { config: string | null } | undefined)?.config ?? null
      try { r = typeof (JSON.parse(config || '{}') as { alert_rule_id?: unknown }).alert_rule_id === 'number' } catch { r = false }
      ruled.set(columnId, r)
    }
    return r
  }
  const rowDeadlines = new Map<number, Map<number, DeadlineItem>>()
  const deadlineItem = (id: number, columnId: number): DeadlineItem | undefined => {
    let m = rowDeadlines.get(id)
    if (!m) {
      m = new Map(loadDeadlines({ rowIds: [id], today: ymdToday, includeDone: true, includePaused: true }).map(d => [d.column_id, d]))
      rowDeadlines.set(id, m)
    }
    return m.get(columnId)
  }
  /**
   * A column's value as the document shows it. Links, file counts, Age and
   * Days-until have no cell of their own; they're worked out here, as the grid does.
   */
  const columnText = (c: Col, id: number, rowCells: Map<number, string | null>): string => {
    switch (c.column_type) {
      case 'link': {
        const specs = linkColumnSpecs([c])
        if (specs.length === 0) return ''
        const r = db.prepare(`SELECT ${linkSelectSql(specs)} FROM rows r WHERE r.id = ?`).get(id) as Record<string, string | null> | undefined
        return formatValue(r?.[`col_${Math.trunc(c.id)}`] ?? null, 'link')
      }
      case 'file_count':
        return String((db.prepare('SELECT COUNT(*) AS n FROM attachments WHERE row_id = ? AND deleted_at IS NULL').get(id) as { n: number }).n)
      case 'age_from_dob': {
        const src = sourceOf(c.config)
        return src ? ageOn(rowCells.get(src), today) : ''
      }
      case 'calculated_days': {
        const src = sourceOf(c.config)
        if (!src) return ''
        if (!hasRule(src)) return daysText(rowCells.get(src), today)
        const d = deadlineItem(id, src)
        return d && d.state !== 'done' && d.state !== 'paused' && d.daysUntil != null ? daysUntilText(d.daysUntil) : ''
      }
      default:
        return formatValue(rowCells.get(c.id) ?? null, c.column_type)
    }
  }
  const row = db.prepare('SELECT display_name FROM rows WHERE id = ?').get(rowId) as { display_name: string | null } | undefined
  const nameCol = columns.find(c => c.is_name_column === 1)
  // "(unnamed)" is the list's stand-in; a document leaves it blank
  const display = row?.display_name && row.display_name !== '(unnamed)' ? row.display_name : ''
  const name = display || (nameCol ? cells.get(nameCol.id) ?? '' : '')
  const profile = Object.fromEntries((db.prepare("SELECT key, value FROM settings WHERE key LIKE 'profile_%'").all() as Array<{ key: string; value: string }>).map(r => [r.key, r.value]))

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
  for (const c of columns) fixed[snake(c.name)] ??= columnText(c, rowId, cells)
  // {{dob}}/{{age}}: the birth-date column, preferring a Date column, so a
  // "Birth certificate received" checkbox after it can't make {{dob}} print "Yes"
  const birthCols = columns.filter(c => /dob|birth/i.test(c.name) && c.column_type !== 'checkbox')
  const dobCol = birthCols.find(c => c.column_type === 'date') ?? birthCols[0]
  fixed.dob = dobCol ? formatValue(cells.get(dobCol.id) ?? null, dobCol.column_type) : ''
  fixed.age = dobCol ? ageOn(cells.get(dobCol.id), today) : ''
  // {{medicaid_cin}}: "CIN" as a whole word, so "Vaccine date" or "Medicine" don't match; the first column wins
  const cinCol = columns.find(c => /medicaid|\bcin\b/i.test(c.name))
  fixed.medicaid_cin = cinCol ? cells.get(cinCol.id) ?? '' : ''

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
      return c ? columnText(c, rowId, cells) : undefined
    }
    if (kind === 'deadline') {
      const c = columns.find(x => norm(x.name) === norm(arg) && (x.column_type === 'date' || x.column_type === 'deadline'))
      if (!c) return undefined
      const due = deadlineOf(c.id)
      return due ? longDate(due) : ''
    }
    if (kind === 'linked') {
      // "Owner.Phone": the record this one links to as its Owner, then its Phone.
      // The label is matched as a prefix, so a column named "D.O.B." or "Policy No." still works.
      const whole = norm(arg)
      const sides: Array<{ lt: ReturnType<typeof listLinkTypes>[number]; side: 'forward' | 'backward'; label: string }> = []
      for (const lt of listLinkTypes(gridId)) {
        if (lt.from_grid_id === gridId && holdsOne(lt.cardinality, 'forward')) sides.push({ lt, side: 'forward', label: norm(lt.label_forward) })
        if (lt.to_grid_id === gridId && holdsOne(lt.cardinality, 'backward')) sides.push({ lt, side: 'backward', label: norm(lt.label_backward) })
      }
      // The longest label first, so "Owner" doesn't swallow "Owner.Billing"
      sides.sort((a, b) => b.label.length - a.label.length)
      for (const { lt, side, label } of sides) {
        if (!label || !whole.startsWith(label + '.')) continue
        const field = norm(whole.slice(label.length + 1))
        if (!field) continue
        const otherGrid = side === 'forward' ? lt.to_grid_id : lt.from_grid_id
        const target = (side === 'forward'
          ? db.prepare('SELECT l.to_row_id AS id FROM record_links l JOIN rows t ON t.id = l.to_row_id WHERE l.link_type_id = ? AND l.from_row_id = ? AND t.deleted_at IS NULL').get(lt.id, rowId)
          : db.prepare('SELECT l.from_row_id AS id FROM record_links l JOIN rows t ON t.id = l.from_row_id WHERE l.link_type_id = ? AND l.to_row_id = ? AND t.deleted_at IS NULL').get(lt.id, rowId)) as { id: number } | undefined
        if (field === 'name') return target ? (db.prepare('SELECT display_name FROM rows WHERE id = ?').get(target.id) as { display_name: string | null }).display_name ?? '' : ''
        const col = db.prepare('SELECT id, grid_id, name, column_type, is_name_column, config FROM columns WHERE grid_id = ? AND LOWER(TRIM(name)) = ?').get(otherGrid, field) as Col | undefined
        if (!col) return undefined
        return target ? columnText(col, target.id, cellsOfRow(target.id)) : ''
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
