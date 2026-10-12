/**
 * Report builder (generalization W10 §6.2). The source rows come from fixed,
 * parameterized queries (the list's one grid query, notes, appointments,
 * or the deadline engine); filters, date ranges, grouping and values are
 * then worked out here over a whitelist of fields. No text from a report
 * ever goes into SQL.
 */
import { getDb, buildGridQuery } from './database'
import { loadDeadlines } from './deadlines'
import { listActivityTypes } from './activity-types'
import { listMeasures } from './measures'
import { stageDurations } from './stages'
import { word } from './vocab'
import { linkColumnSpecs, linkValueText } from '../shared/links'
import { fileCountColumnIds } from '../shared/attachments'
import { stageColumnOf, columnOptionLabels } from '../shared/stages'
import { labelFor } from '../shared/activityTypes'
import { localDateString } from '../shared/dates'
import type { Column, GridRow } from '../shared/types'
import {
  REPORT_LIMITS, bucketDate, isFilterActive, matchReportFilter, presetRange, reportConfigSchema, toNumber, valueKey, valueLabel,
  type ReportCell, type ReportColumn, type ReportConfig, type ReportField, type ReportFieldKind, type ReportResult, type ReportSource, type SavedReport,
} from '../shared/reports'

/** A problem the person can fix; the message is shown as is. */
export class ReportError extends Error {}

const APPT_STATUS_LABELS: Record<string, string> = { scheduled: 'Scheduled', done: 'Done', cancelled: 'Cancelled', no_show: 'No-show' }
const DEADLINE_STATE_LABELS: Record<string, string> = { none: 'Nothing due', ok: 'On track', soon: 'Coming up', due: 'Due', overdue: 'Overdue', paused: 'Paused', done: 'Done' }
/** Most urgent first, so a report grouped by state reads top-down */
const DEADLINE_STATE_ORDER = ['Overdue', 'Due', 'Coming up', 'On track', 'Paused', 'Done', 'Nothing due']

/** Columns a report can read; read-only types Pulse works out in the window aren't stored, except age */
const SKIP_TYPES = new Set(['calculated_days'])

function columnKind(c: Column): ReportFieldKind {
  switch (c.column_type) {
    case 'number': case 'auto_number': case 'file_count': case 'age_from_dob': return 'number'
    case 'currency': return 'currency'
    case 'date': case 'deadline': return 'date'
    default: return 'text'
  }
}

function gridColumns(gridId: number): Column[] {
  return getDb().prepare('SELECT * FROM columns WHERE grid_id = ? ORDER BY position').all(gridId) as Column[]
}

/** A column's fixed choices, for pick-lists and grouping order */
function columnOptions(c: Column): string[] | undefined {
  if (c.column_type === 'checkbox') return ['Yes', 'No']
  if (c.column_type === 'dropdown' || c.column_type === 'status') {
    const opts = columnOptionLabels(c)
    return opts.length ? opts : undefined
  }
  return undefined
}

/** Every field a report on this list and source can use */
export function reportFields(gridId: number, source: ReportSource): ReportField[] {
  const cols = gridColumns(gridId).filter(c => !SKIP_TYPES.has(c.column_type))
  const rec = word('record', { cap: true }, gridId)
  const fields: ReportField[] = []
  const typeLabels = () => listActivityTypes(true).filter(t => !t.is_archived).map(t => t.label)
  if (source === 'activities') {
    const act = word('activity', { cap: true }, gridId)
    fields.push(
      { id: 'act:date', label: 'Date', kind: 'date', group: act },
      { id: 'act:type', label: 'Type', kind: 'text', group: act, options: typeLabels() },
      { id: 'act:minutes', label: 'Minutes', kind: 'number', group: act },
      { id: 'act:miles', label: 'Miles', kind: 'number', group: act },
    )
    for (const m of listMeasures().filter(m => !m.archived)) fields.push({ id: `act:m:${m.key}`, label: m.label, kind: m.kind === 'currency' ? 'currency' : 'number', group: act })
  } else if (source === 'appointments') {
    const ap = word('appointment', { cap: true }, gridId)
    fields.push(
      { id: 'appt:date', label: 'Date', kind: 'date', group: ap },
      { id: 'appt:title', label: 'Title', kind: 'text', group: ap },
      { id: 'appt:status', label: 'Status', kind: 'text', group: ap, options: Object.values(APPT_STATUS_LABELS) },
      { id: 'appt:type', label: 'Type', kind: 'text', group: ap, options: typeLabels() },
      { id: 'appt:minutes', label: 'Length (minutes)', kind: 'number', group: ap },
    )
  } else if (source === 'deadlines') {
    fields.push(
      { id: 'dl:rule', label: 'Deadline', kind: 'text', group: 'Deadline', options: cols.filter(isDeadlineColumn).map(c => c.name) },
      { id: 'dl:state', label: 'State', kind: 'text', group: 'Deadline', options: DEADLINE_STATE_ORDER },
      { id: 'dl:due', label: 'Due date', kind: 'date', group: 'Deadline' },
      { id: 'dl:overdue', label: 'Days overdue', kind: 'number', group: 'Deadline', hint: 'derived' },
    )
  }
  const stage = stageColumnOf(cols)
  fields.push({ id: 'rec:created', label: 'Date added', kind: 'date', group: rec })
  if (stage) fields.push({ id: 'rec:stage_days', label: `Days in ${word('stage', {}, gridId)}`, kind: 'number', group: rec, hint: 'derived' })
  for (const c of cols) {
    const options = columnOptions(c)
    const hint = c.id === stage?.id ? 'stage' as const : c.is_name_column ? 'name' as const : c.column_type === 'age_from_dob' ? 'derived' as const : undefined
    // A Deadline column stores the day it was last done, not when it's due (Decision E1)
    const label = c.column_type === 'deadline' ? `${c.name} (last done)` : c.name
    fields.push({ id: `col:${c.id}`, label, kind: columnKind(c), group: rec, ...(options ? { options } : {}), ...(hint ? { hint } : {}) })
  }
  return fields
}

/** A column that carries a deadline (its own type, or a date with a rule) */
function isDeadlineColumn(c: Column): boolean {
  if (c.column_type === 'deadline') return true
  if (c.column_type !== 'date' || !c.config) return false
  // The rule is set by id (column menu, Add column); a name alone is stale once the rule is removed
  try { return !!(JSON.parse(c.config) as { alert_rule_id?: number }).alert_rule_id } catch { return false }
}

/** What each line of a report is, in the list's words: "Jobs", "Notes", "Deadlines" */
export function sourceWord(source: ReportSource, gridId: number): string {
  switch (source) {
    case 'records': return word('record', { many: true, cap: true }, gridId)
    case 'activities': return word('activity', { many: true, cap: true }, gridId)
    case 'appointments': return word('appointment', { many: true, cap: true }, gridId)
    default: return 'Deadlines'
  }
}

/** One line of a report, in the list's words: "Job", "Note", "Deadline" */
export function sourceWordOne(source: ReportSource, gridId: number): string {
  switch (source) {
    case 'records': return word('record', { cap: true }, gridId)
    case 'activities': return word('activity', { cap: true }, gridId)
    case 'appointments': return word('appointment', { cap: true }, gridId)
    default: return 'Deadline'
  }
}

/** Check a config and every field it names against the list */
export function validateReportConfig(gridId: number, input: unknown): { config: ReportConfig; fields: ReportField[] } {
  const parsed = reportConfigSchema.safeParse(input)
  if (!parsed.success) throw new ReportError("That report's settings aren't valid.")
  const config = parsed.data
  const fields = reportFields(gridId, config.source)
  const byId = new Map(fields.map(f => [f.id, f]))
  const need = (id: string | undefined, what: string) => {
    if (id === undefined) return
    if (!byId.has(id)) throw new ReportError(`The ${what} in this report is no longer on the list. Choose another.`)
  }
  config.filters.forEach(f => need(f.field, 'filter field'))
  config.groupBy.forEach(g => need(g.field, 'grouping'))
  config.columns?.forEach(c => need(c, 'column'))
  if (config.dateRange) {
    need(config.dateRange.field, 'date range field')
    if (byId.get(config.dateRange.field)!.kind !== 'date') throw new ReportError('The date range needs a date column.')
  }
  for (const v of config.values) {
    if (v.fn === 'count') continue
    need(v.field, 'value field')
    if (!v.field) throw new ReportError('Choose what to add up.')
    const kind = byId.get(v.field)!.kind
    if (kind !== 'number' && kind !== 'currency') throw new ReportError(`"${byId.get(v.field)!.label}" isn't a number, so it can't be added up.`)
  }
  for (const g of config.groupBy) if (g.bucket && byId.get(g.field)!.kind !== 'date') throw new ReportError('Only dates can be grouped by day, week, month, quarter or year.')
  return { config, fields }
}

type Item = { rowId: number; own: Record<string, ReportCell> }

function ageFrom(dob: string | null, today: string): number | null {
  const m = dob ? /^(\d{4})-(\d{2})-(\d{2})/.exec(dob) : null
  if (!m) return null
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number]
  let age = ty - Number(m[1])
  if (tm < Number(m[2]) || (tm === Number(m[2]) && td < Number(m[3]))) age--
  return age >= 0 ? age : null
}

/** Run a report; throws ReportError for problems the person can fix */
export function runReport(gridId: number, input: unknown, now = new Date()): ReportResult {
  const started = Date.now()
  const tick = () => { if (Date.now() - started > REPORT_LIMITS.timeoutMs) throw new ReportError('This report is taking too long. Add a filter or a shorter date range.') }
  const db = getDb()
  if (!db.prepare('SELECT 1 FROM grids WHERE id = ? AND is_active = 1').get(gridId)) throw new ReportError('That list is no longer available.')
  const { config, fields } = validateReportConfig(gridId, input)
  const byId = new Map(fields.map(f => [f.id, f]))
  const today = localDateString(now)
  let truncated: string | null = null

  // ── Records: the list's one grid query ──
  const cols = gridColumns(gridId)
  const colById = new Map(cols.map(c => [c.id, c]))
  const gridRows = db.prepare(buildGridQuery(cols.map(c => c.id), config.includeArchived === true, linkColumnSpecs(cols), fileCountColumnIds(cols))).all(gridId) as GridRow[]
  const recordById = new Map(gridRows.map(r => [r.row_id, r]))
  const needsCreated = [...byId.keys()].includes('rec:created')
  const created = new Map<number, string>()
  if (needsCreated) {
    for (const r of db.prepare("SELECT id, date(created_at, 'localtime') AS d FROM rows WHERE grid_id = ?").all(gridId) as Array<{ id: number; d: string }>) created.set(r.id, r.d)
  }
  const usedFields = new Set<string>([
    ...config.filters.map(f => f.field), ...config.groupBy.map(g => g.field), ...(config.columns ?? []),
    ...config.values.map(v => v.field).filter((f): f is string => !!f), ...(config.dateRange ? [config.dateRange.field] : []),
  ])
  let stageDays: Record<number, { current: { days: number } }> = {}
  const stageCol = stageColumnOf(cols)
  if (usedFields.has('rec:stage_days') && stageCol) stageDays = stageDurations(gridId, stageCol.id, undefined, now)

  const recordValue = (rowId: number, field: string): ReportCell => {
    const r = recordById.get(rowId)
    if (!r) return null
    if (field === 'rec:created') return created.get(rowId) ?? null
    if (field === 'rec:stage_days') return stageDays[rowId]?.current.days ?? null
    const id = Number(field.slice(4))
    const c = colById.get(id)
    if (!c) return null
    const raw = (r as unknown as Record<string, unknown>)[`col_${id}`]
    switch (c.column_type) {
      case 'link': return linkValueText(raw as string | null) || null
      case 'checkbox': return raw === 'true' || raw === '1' ? 'Yes' : 'No'
      case 'age_from_dob': {
        const src = (JSON.parse(c.config || '{}') as { source_column_id?: number }).source_column_id
        return src ? ageFrom((r as unknown as Record<string, unknown>)[`col_${src}`] as string | null, today) : null
      }
      default: {
        if (raw === null || raw === undefined || raw === '') return null
        if (columnKind(c) === 'number' || columnKind(c) === 'currency') return toNumber(raw as ReportCell) ?? String(raw)
        return String(raw)
      }
    }
  }

  // ── Filters and date range ──
  let range: { from?: string; to?: string } | null = null
  if (config.dateRange) range = config.dateRange.preset ? presetRange(config.dateRange.preset, now) : { from: config.dateRange.from, to: config.dateRange.to }
  // Notes and appointments are capped: a date range on their own date narrows the query itself,
  // and past the cap the latest are kept, so "this month" isn't lost behind years of old ones (F-021)
  const sqlRange = (field: string, expr: string): { where: string; params: Array<string | null> } => {
    if (!range || config.dateRange?.field !== field) return { where: '', params: [] }
    return { where: ` AND (? IS NULL OR ${expr} >= ?) AND (? IS NULL OR ${expr} <= ?)`, params: [range.from ?? null, range.from ?? null, range.to ?? null, range.to ?? null] }
  }

  // ── Source items ──
  const cap = REPORT_LIMITS.sourceRows
  const rowIds = gridRows.map(r => r.row_id)
  let items: Item[] = []
  const inRows = (sql: string) => `WITH rs(id) AS (SELECT value FROM json_each(?)) ${sql}`
  if (config.source === 'records') {
    items = gridRows.slice(0, cap).map(r => ({ rowId: r.row_id, own: {} }))
    if (gridRows.length > cap) truncated = `Only the first ${cap.toLocaleString('en-US')} were counted.`
  } else if (config.source === 'activities') {
    const types = listActivityTypes(true)
    const measures = listMeasures()
    const r = sqlRange('act:date', "date(cl.occurred_at, 'localtime')")
    const notes = db.prepare(inRows(`SELECT cl.row_id, date(cl.occurred_at, 'localtime') AS d, cl.log_type, cl.minutes, cl.miles, cl.extra_measures
      FROM case_log cl JOIN rs ON rs.id = cl.row_id WHERE cl.voided_at IS NULL AND cl.log_type != 'system'${r.where} ORDER BY cl.occurred_at DESC, cl.id DESC LIMIT ?`))
      .all(JSON.stringify(rowIds), ...r.params, cap + 1) as Array<{ row_id: number; d: string; log_type: string; minutes: number | null; miles: number | null; extra_measures: string | null }>
    if (notes.length > cap) { notes.pop(); truncated = `Only the latest ${cap.toLocaleString('en-US')} were counted.` }
    // Back to oldest first, the order the report lists them in
    notes.reverse()
    items = notes.map(n => {
      let extra: Record<string, unknown> = {}
      try { extra = n.extra_measures ? JSON.parse(n.extra_measures) as Record<string, unknown> : {} } catch { /* unreadable numbers count as none */ }
      const own: Record<string, ReportCell> = { 'act:date': n.d, 'act:type': labelFor(types, n.log_type), 'act:minutes': n.minutes, 'act:miles': n.miles }
      for (const m of measures) own[`act:m:${m.key}`] = toNumber((extra[m.key] ?? null) as ReportCell)
      return { rowId: n.row_id, own }
    })
  } else if (config.source === 'appointments') {
    const types = listActivityTypes(true)
    const r = sqlRange('appt:date', 'substr(a.start_at, 1, 10)')
    const appts = db.prepare(inRows(`SELECT a.row_id, a.title, a.start_at, a.end_at, a.all_day, a.status, a.activity_type_key
      FROM appointments a JOIN rs ON rs.id = a.row_id WHERE 1 = 1${r.where} ORDER BY a.start_at DESC, a.id DESC LIMIT ?`))
      .all(JSON.stringify(rowIds), ...r.params, cap + 1) as Array<{ row_id: number; title: string; start_at: string; end_at: string | null; all_day: number; status: string; activity_type_key: string | null }>
    if (appts.length > cap) { appts.pop(); truncated = `Only the latest ${cap.toLocaleString('en-US')} were counted.` }
    appts.reverse()
    items = appts.map(a => {
      const minutes = !a.all_day && a.end_at && a.start_at.length >= 16 && a.end_at.length >= 16
        ? Math.round((new Date(a.end_at).getTime() - new Date(a.start_at).getTime()) / 60000) : null
      return { rowId: a.row_id, own: {
        'appt:date': a.start_at.slice(0, 10), 'appt:title': a.title, 'appt:status': APPT_STATUS_LABELS[a.status] ?? a.status,
        'appt:type': a.activity_type_key ? labelFor(types, a.activity_type_key) : null, 'appt:minutes': minutes,
      } }
    })
  } else {
    const deadlines = loadDeadlines({ gridId, today, includeDone: true, includePaused: true }).filter(d => recordById.has(d.row_id))
    if (deadlines.length > cap) { deadlines.length = cap; truncated = `Only the first ${cap.toLocaleString('en-US')} were counted.` }
    items = deadlines.map(d => ({ rowId: d.row_id, own: {
      'dl:rule': d.column_name, 'dl:state': DEADLINE_STATE_LABELS[d.state] ?? d.state, 'dl:due': d.due,
      // A used-up quota is overdue with its end still ahead: 0 days late, not negative (F-022)
      'dl:overdue': d.state === 'overdue' && d.daysUntil !== null ? Math.max(0, -d.daysUntil) : 0,
    } }))
  }
  tick()

  const get = (item: Item, field: string): ReportCell => field in item.own ? item.own[field] ?? null : recordValue(item.rowId, field)

  // A filter still waiting for its value doesn't narrow anything yet
  const activeFilters = config.filters.filter(isFilterActive)
  const matched = items.filter((item, i) => {
    if (i % 2000 === 0) tick()
    for (const f of activeFilters) if (!matchReportFilter(get(item, f.field), byId.get(f.field)!.kind, f.operator, f.value)) return false
    if (range && config.dateRange) {
      const d = get(item, config.dateRange.field)
      if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(d)) return false
      const day = d.slice(0, 10)
      if (range.from && day < range.from) return false
      if (range.to && day > range.to) return false
    }
    return true
  })

  // ── Values ──
  const aggregate = (group: Item[], v: ReportConfig['values'][number]): ReportCell => {
    if (v.fn === 'count') return group.length
    const nums = group.map(it => toNumber(get(it, v.field!))).filter((n): n is number => n !== null)
    if (nums.length === 0) return null
    switch (v.fn) {
      case 'sum': return round(nums.reduce((a, b) => a + b, 0))
      case 'avg': return round(nums.reduce((a, b) => a + b, 0) / nums.length)
      case 'min': return Math.min(...nums)
      case 'max': return Math.max(...nums)
    }
  }
  const valueCols: ReportColumn[] = config.values.map((v, i) => ({
    key: valueKey(i), label: valueLabel(v, fields),
    kind: v.fn === 'count' ? 'number' : byId.get(v.field!)!.kind,
  }))
  const totals: Record<string, ReportCell> = {}
  config.values.forEach((v, i) => { totals[valueKey(i)] = aggregate(matched, v) })

  let columns: ReportColumn[]
  let rows: Array<Record<string, ReportCell>>
  if (config.groupBy.length > 0) {
    const groupCols: ReportColumn[] = config.groupBy.map((g, i) => {
      const f = byId.get(g.field)!
      return { key: `g${i}`, label: f.label, kind: f.kind, ...(g.bucket && f.kind === 'date' ? { bucket: g.bucket } : {}) }
    })
    const groups = new Map<string, { keys: ReportCell[]; items: Item[] }>()
    for (const item of matched) {
      const keys = config.groupBy.map(g => {
        const v = get(item, g.field)
        if (v === null || v === '') return null
        return g.bucket && typeof v === 'string' ? bucketDate(v, g.bucket) : v
      })
      const k = JSON.stringify(keys)
      let grp = groups.get(k)
      if (!grp) { grp = { keys, items: [] }; groups.set(k, grp) }
      grp.items.push(item)
    }
    tick()
    columns = [...groupCols, ...(valueCols.length ? valueCols : [{ key: valueKey(0), label: 'How many', kind: 'number' as const }])]
    const values = config.values.length ? config.values : [{ fn: 'count' as const }]
    rows = [...groups.values()].map(g => {
      const row: Record<string, ReportCell> = {}
      g.keys.forEach((k, i) => { row[`g${i}`] = k === null ? '(blank)' : k })
      values.forEach((v, i) => { row[valueKey(i)] = aggregate(g.items, v) })
      return row
    })
    if (!config.values.length) totals[valueKey(0)] = matched.length
    // Choices keep their own order (Estimate requested → … → Done); the rest sort as values
    const orders = config.groupBy.map(g => byId.get(g.field)!.options)
    rows.sort((a, b) => {
      for (const [i, c] of groupCols.entries()) {
        const d = compareIn(orders[i], a[c.key] ?? null, b[c.key] ?? null)
        if (d) return d
      }
      return 0
    })
  } else if (config.columns?.length) {
    columns = config.columns.map(id => ({ key: id, label: byId.get(id)!.label, kind: byId.get(id)!.kind }))
    rows = matched.map(item => Object.fromEntries(config.columns!.map(id => [id, get(item, id)])))
  } else {
    // No grouping and no columns: one line of values over everything
    columns = valueCols.length ? valueCols : [{ key: valueKey(0), label: 'How many', kind: 'number' }]
    if (!valueCols.length) totals[valueKey(0)] = matched.length
    rows = [{ ...totals }]
  }

  if (config.sort && columns.some(c => c.key === config.sort!.field)) {
    const { field, dir } = config.sort
    rows.sort((a, b) => compare(a[field] ?? null, b[field] ?? null) * (dir === 'desc' ? -1 : 1))
  }
  if (rows.length > REPORT_LIMITS.outputRows) {
    rows = rows.slice(0, REPORT_LIMITS.outputRows)
    truncated = `Showing the first ${REPORT_LIMITS.outputRows.toLocaleString('en-US')} lines. Add a filter or group the report to see everything.`
  }
  return { columns, rows, totals, matched: matched.length, truncated }
}

function round(n: number): number { return Math.round(n * 100) / 100 }

/** In the order of a field's choices when it has them; values that aren't a choice follow, then blanks */
function compareIn(order: string[] | undefined, a: ReportCell, b: ReportCell): number {
  if (!order) return compare(a, b)
  const blank = (v: ReportCell) => v === null || v === '' || v === '(blank)'
  if (blank(a) || blank(b)) return blank(a) === blank(b) ? 0 : blank(a) ? 1 : -1
  const ia = order.indexOf(String(a)), ib = order.indexOf(String(b))
  if (ia === -1 && ib === -1) return compare(a, b)
  if (ia === -1 || ib === -1) return ia === -1 ? 1 : -1
  return ia - ib
}

/** Blanks last; numbers as numbers; text without regard to case */
function compare(a: ReportCell, b: ReportCell): number {
  const blank = (v: ReportCell) => v === null || v === '' || v === '(blank)'
  if (blank(a) || blank(b)) return blank(a) === blank(b) ? 0 : blank(a) ? 1 : -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), 'en-US', { numeric: true, sensitivity: 'base' })
}

// ── Saved reports ──

function parseSaved(r: { id: number; name: string; grid_id: number; config: string; created_at: string; updated_at: string }): SavedReport | null {
  try {
    const parsed = reportConfigSchema.safeParse(JSON.parse(r.config))
    return parsed.success ? { ...r, config: parsed.data } : null
  } catch { return null }
}

export function listReports(gridId?: number): SavedReport[] {
  const rows = getDb().prepare(`SELECT r.id, r.name, r.grid_id, r.config, r.created_at, r.updated_at FROM report_definitions r JOIN grids g ON g.id = r.grid_id
    WHERE g.is_active = 1 ${gridId ? 'AND r.grid_id = ?' : ''} ORDER BY r.name COLLATE NOCASE`).all(...(gridId ? [gridId] : [])) as Array<Parameters<typeof parseSaved>[0]>
  return rows.map(parseSaved).filter((r): r is SavedReport => r !== null)
}

/** A saved report, while its list is open (not in the Trash), like listReports */
export function getReport(id: number): SavedReport | undefined {
  const r = getDb().prepare(`SELECT r.id, r.name, r.grid_id, r.config, r.created_at, r.updated_at FROM report_definitions r
    JOIN grids g ON g.id = r.grid_id AND g.is_active = 1 WHERE r.id = ?`).get(id) as Parameters<typeof parseSaved>[0] | undefined
  return r ? parseSaved(r) ?? undefined : undefined
}

export function saveReport(input: { id?: number; name: unknown; gridId: number; config: unknown }): SavedReport {
  const name = typeof input.name === 'string' ? input.name.replace(/\s+/g, ' ').trim() : ''
  if (!name) throw new ReportError('Give the report a name.')
  if (name.length > 100) throw new ReportError('Keep the name under 100 characters.')
  const db = getDb()
  if (!db.prepare('SELECT 1 FROM grids WHERE id = ? AND is_active = 1').get(input.gridId)) throw new ReportError('That list is no longer available.')
  const { config } = validateReportConfig(input.gridId, input.config)
  const json = JSON.stringify(config)
  if (input.id !== undefined) {
    const changed = db.prepare("UPDATE report_definitions SET name = ?, grid_id = ?, config = ?, updated_at = datetime('now') WHERE id = ?").run(name, input.gridId, json, input.id).changes
    if (!changed) throw new ReportError('That report is no longer available.')
    return getReport(input.id)!
  }
  const id = Number(db.prepare('INSERT INTO report_definitions (name, grid_id, config) VALUES (?, ?, ?)').run(name, input.gridId, json).lastInsertRowid)
  return getReport(id)!
}

export function deleteReport(id: number): void {
  const db = getDb()
  db.transaction(() => {
    if (db.prepare('DELETE FROM report_definitions WHERE id = ?').run(id).changes === 0) throw new ReportError('That report is no longer available.')
    // Take it off the dashboard too
    const pinned = db.prepare("SELECT value FROM settings WHERE key = 'dashboard_reports'").get() as { value: string } | undefined
    if (pinned) {
      let ids: unknown = []
      try { ids = JSON.parse(pinned.value) } catch { /* unreadable: reset */ }
      const next = Array.isArray(ids) ? ids.filter(x => x !== id) : []
      db.prepare("UPDATE settings SET value = ? WHERE key = 'dashboard_reports'").run(JSON.stringify(next))
    }
  })()
}
