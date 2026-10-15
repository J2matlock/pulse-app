/**
 * Saved reports (generalization W10 §6): what each row of the report is
 * (records, notes, appointments or deadlines), filters, an optional date
 * range, up to two groupings and up to six values. Fields are named by id
 * ("col:12", "act:date") and checked against what the list actually has.
 */
import { z } from 'zod'
import { textLength } from './textLength'
import { parseNumberCell } from './numbers'
import { unhandledCase } from './assertNever'

export const REPORT_SOURCES = ['records', 'activities', 'appointments', 'deadlines'] as const
export type ReportSource = typeof REPORT_SOURCES[number]

export type ReportFieldKind = 'text' | 'number' | 'currency' | 'date'

export interface ReportField {
  id: string
  label: string
  kind: ReportFieldKind
  /** Where it comes from, for grouping the picker ("Record", "Note"…) */
  group: string
  /** The choices a status, dropdown, checkbox or type field can hold, in their own order */
  options?: string[]
  /** The record's name, its stage, or a number Pulse works out (not worth adding up) */
  hint?: 'name' | 'stage' | 'derived'
}

export const DATE_BUCKETS = ['day', 'week', 'month', 'quarter', 'year'] as const
export type DateBucket = typeof DATE_BUCKETS[number]
export const DATE_PRESETS = ['this_month', 'last_month', 'this_quarter', 'this_year', 'last_year'] as const
export type DatePreset = typeof DATE_PRESETS[number]
export const VALUE_FNS = ['count', 'sum', 'avg', 'min', 'max'] as const
export type ValueFn = typeof VALUE_FNS[number]

export const REPORT_OPERATORS = ['contains', 'not_contains', 'equals', 'not_equals', 'starts_with', 'is_empty', 'is_not_empty', 'gt', 'lt', 'before', 'after'] as const
export type ReportOperator = (typeof REPORT_OPERATORS)[number]

export const REPORT_LIMITS = { sourceRows: 50_000, outputRows: 2_000, timeoutMs: 5_000, filters: 20, groupBy: 2, values: 6, columns: 30 } as const

const fieldId = z.string().regex(/^[a-z_]+(:[a-z0-9_]+){0,2}$/).check(textLength({ max: 80 }))
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const reportConfigSchema = z.object({
  source: z.enum(REPORT_SOURCES),
  includeArchived: z.boolean().optional(),
  filters: z.array(z.object({ field: fieldId, operator: z.enum(REPORT_OPERATORS), value: z.string().check(textLength({ max: 500 })) })).max(REPORT_LIMITS.filters).default([]),
  dateRange: z.object({
    field: fieldId,
    from: ymd.optional(),
    to: ymd.optional(),
    preset: z.enum(DATE_PRESETS).optional(),
  }).optional(),
  groupBy: z.array(z.object({ field: fieldId, bucket: z.enum(DATE_BUCKETS).optional() })).max(REPORT_LIMITS.groupBy).default([]),
  values: z.array(z.object({ fn: z.enum(VALUE_FNS), field: fieldId.optional(), label: z.string().check(textLength({ max: 60 })).optional() })).max(REPORT_LIMITS.values).default([]),
  columns: z.array(fieldId).max(REPORT_LIMITS.columns).optional(),
  sort: z.object({ field: z.string().check(textLength({ max: 80 })), dir: z.enum(['asc', 'desc']) }).optional(),
  /** One line on the question it answers ("Which estimates still need a call back?") */
  about: z.string().check(textLength({ max: 200 })).optional(),
})
export type ReportConfig = z.infer<typeof reportConfigSchema>

export interface SavedReport {
  id: number
  name: string
  grid_id: number
  config: ReportConfig
  created_at: string
  updated_at: string
}

export interface ReportColumn {
  key: string
  label: string
  kind: ReportFieldKind
  /** Dates grouped by month, week…: the cells hold "2026-10", "2026 Q4" and so on */
  bucket?: DateBucket
}

export type ReportCell = string | number | null

export interface ReportResult {
  columns: ReportColumn[]
  rows: Array<Record<string, ReportCell>>
  /** Each value over everything that matched (for a totals line) */
  totals: Record<string, ReportCell>
  /** How many source items matched the filters */
  matched: number
  /** Stopped at a limit; the note says which */
  truncated: string | null
}

export const SOURCE_LABELS: Record<ReportSource, string> = {
  records: '{record:many}',
  activities: '{activity:many}',
  appointments: '{appointment:many}',
  deadlines: 'deadlines',
}

/** One line of each source, for "Counting 1 …" */
export const SOURCE_LABELS_ONE: Record<ReportSource, string> = {
  records: '{record}',
  activities: '{activity}',
  appointments: '{appointment}',
  deadlines: 'deadline',
}

export const FN_LABELS: Record<ValueFn, string> = { count: 'How many', sum: 'Total', avg: 'Average', min: 'Lowest', max: 'Highest' }

export function valueKey(i: number): string { return `v${i}` }

/** The column heading for a value, e.g. "Total Parts" */
export function valueLabel(v: ReportConfig['values'][number], fields: ReportField[]): string {
  if (v.label?.trim()) return v.label.trim()
  if (v.fn === 'count') return FN_LABELS.count
  const f = fields.find(x => x.id === v.field)
  return `${FN_LABELS[v.fn]} ${f?.label ?? ''}`.trim()
}

const pad = (n: number) => String(n).padStart(2, '0')

/** A date's group label for a bucket; weeks start on the day chosen in Settings (Sunday by default, A21a-10) */
export function bucketDate(ymdValue: string, bucket: DateBucket = 'day', weekStart: 'sunday' | 'monday' = 'sunday'): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymdValue)
  if (!m) return ymdValue
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  switch (bucket) {
    case 'year': return String(y)
    case 'quarter': return `${y} Q${Math.ceil(mo / 3)}`
    case 'month': return `${y}-${pad(mo)}`
    case 'week': {
      const dt = new Date(y, mo - 1, d)
      dt.setDate(dt.getDate() - (weekStart === 'monday' ? (dt.getDay() + 6) % 7 : dt.getDay()))
      return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
    }
    case 'day': return `${y}-${pad(mo)}-${pad(d)}`
    default:
      // A bucket added without a case fails typecheck; saved reports are checked against DATE_BUCKETS
      unhandledCase(bucket)
      return `${y}-${pad(mo)}-${pad(d)}`
  }
}

/** First and last day of a preset range, relative to today */
export function presetRange(preset: DatePreset, today: Date = new Date()): { from: string; to: string } {
  const y = today.getFullYear(), m = today.getMonth()
  const day = (dt: Date) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
  switch (preset) {
    case 'last_month': return { from: day(new Date(y, m - 1, 1)), to: day(new Date(y, m, 0)) }
    case 'this_quarter': { const q = Math.floor(m / 3) * 3; return { from: day(new Date(y, q, 1)), to: day(new Date(y, q + 3, 0)) } }
    case 'this_year': return { from: `${y}-01-01`, to: `${y}-12-31` }
    case 'last_year': return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` }
    case 'this_month': return { from: day(new Date(y, m, 1)), to: day(new Date(y, m + 1, 0)) }
    default:
      // A preset added without a case fails typecheck; saved reports are checked against DATE_PRESETS
      unhandledCase(preset)
      return { from: day(new Date(y, m, 1)), to: day(new Date(y, m + 1, 0)) }
  }
}

export function toNumber(v: ReportCell): number | null {
  if (v === null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  return parseNumberCell(String(v))
}

/** Operators that compare against a value (the rest stand alone) */
export function filterNeedsValue(operator: ReportOperator): boolean {
  return operator !== 'is_empty' && operator !== 'is_not_empty'
}

/** A filter still waiting for its value doesn't narrow anything yet */
export function isFilterActive(f: { operator: ReportOperator; value: string }): boolean {
  return !filterNeedsValue(f.operator) || f.value.trim() !== ''
}

/** Whether one value passes one filter (case-insensitive text; numbers and dates compared as such) */
export function matchReportFilter(raw: ReportCell, kind: ReportFieldKind, operator: ReportOperator, value: string): boolean {
  const text = raw === null ? '' : String(raw)
  const a = text.toLowerCase(), b = value.trim().toLowerCase()
  switch (operator) {
    case 'is_empty': return text.trim() === ''
    case 'is_not_empty': return text.trim() !== ''
    case 'equals':
      if (kind === 'number' || kind === 'currency') { const n = toNumber(raw), m = toNumber(value); return n !== null && m !== null ? n === m : a === b }
      return a === b
    case 'not_equals': return !matchReportFilter(raw, kind, 'equals', value)
    case 'contains': return a.includes(b)
    case 'not_contains': return !a.includes(b)
    case 'starts_with': return a.startsWith(b)
    case 'gt': case 'lt': {
      const n = toNumber(raw), m = toNumber(value)
      if (n === null || m === null) return false
      return operator === 'gt' ? n > m : n < m
    }
    case 'before': case 'after': {
      if (!/^\d{4}-\d{2}-\d{2}/.test(text) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return false
      const d = text.slice(0, 10)
      return operator === 'before' ? d < b : d > b
    }
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-07-31" → "Jul 31, 2026"; anything else unchanged */
export function formatYmd(v: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : v
}

/** The group for records with nothing in that field: "(no status)", not "(blank)" (UX D-44) */
export function noValueLabel(fieldLabel: string): string {
  return `(no ${fieldLabel.toLowerCase()})`
}
const NO_VALUE = /^\(no [^()]*\)$/
/** Whether a report cell is the "(no …)" group or empty: these sort last */
export function isNoValue(v: ReportCell): boolean {
  return v === null || v === '' || (typeof v === 'string' && NO_VALUE.test(v))
}

/** A value as people read it. Dates and date groups are spelled out ("Oct 2026", "Week of Oct 4, 2026"); the CSV keeps the raw values */
export function formatReportCell(v: ReportCell, kind: ReportFieldKind, bucket?: DateBucket): string {
  if (v === null || v === '') return '—'
  if (typeof v === 'number') {
    if (kind === 'currency') return v.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
    return v.toLocaleString('en-US', { maximumFractionDigits: 2 })
  }
  if (kind !== 'date' || isNoValue(v)) return v
  switch (bucket) {
    case 'month': { const m = /^(\d{4})-(\d{2})$/.exec(v); return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : v }
    case 'quarter': { const m = /^(\d{4}) (Q\d)$/.exec(v); return m ? `${m[2]} ${m[1]}` : v }
    case 'week': return /^\d{4}-\d{2}-\d{2}$/.test(v) ? `Week of ${formatYmd(v)}` : v
    case 'year': return v
    case 'day': case undefined: return formatYmd(v.slice(0, 10))
    default:
      unhandledCase(bucket)
      return formatYmd(v.slice(0, 10))
  }
}

/** Which operators make sense for a field (fields with a fixed set of choices: is / isn't) */
export function operatorsFor(kind: ReportFieldKind, hasOptions = false): ReportOperator[] {
  if (hasOptions) return ['equals', 'not_equals', 'is_empty', 'is_not_empty']
  if (kind === 'date') return ['before', 'after', 'equals', 'is_empty', 'is_not_empty']
  if (kind === 'number' || kind === 'currency') return ['equals', 'not_equals', 'gt', 'lt', 'is_empty', 'is_not_empty']
  return ['contains', 'not_contains', 'equals', 'not_equals', 'starts_with', 'is_empty', 'is_not_empty']
}

export const OPERATOR_LABELS: Record<ReportOperator, string> = {
  contains: 'contains', not_contains: "doesn't contain", equals: 'is', not_equals: "isn't", starts_with: 'starts with',
  is_empty: 'is empty', is_not_empty: 'is filled in', gt: 'is more than', lt: 'is less than', before: 'is before', after: 'is after',
}

// ── Sensible defaults for the builder ─────────────────────────────────────

/** What a new filter starts on: the stage, then a field with choices, then the name, never a date */
export function defaultFilterField(fields: ReportField[]): ReportField | undefined {
  return fields.find(f => f.hint === 'stage') ?? fields.find(f => f.options?.length) ?? fields.find(f => f.hint === 'name')
    ?? fields.find(f => f.kind === 'text') ?? fields[0]
}

/** What a new grouping starts on: the source's own kind (note type, status, deadline), the stage, a field with choices; dates last */
export function defaultGroupField(fields: ReportField[], source: ReportSource, taken: string[] = []): ReportField | undefined {
  const free = fields.filter(f => !taken.includes(f.id))
  const own: Partial<Record<ReportSource, string>> = { activities: 'act:type', appointments: 'appt:status', deadlines: 'dl:rule' }
  return free.find(f => f.id === own[source]) ?? free.find(f => f.hint === 'stage') ?? free.find(f => f.options?.length)
    ?? free.find(f => f.kind === 'text' && f.hint !== 'name') ?? free.find(f => f.kind === 'date') ?? free[0]
}

/** What a new total starts on: money first, then a real number; never a number Pulse works out (days in stage) */
export function defaultValueField(fields: ReportField[]): ReportField | undefined {
  const real = fields.filter(f => f.hint !== 'derived')
  return real.find(f => f.kind === 'currency') ?? real.find(f => f.kind === 'number')
}

const PRESET_WORDS: Record<DatePreset, string> = { this_month: 'this month', last_month: 'last month', this_quarter: 'this quarter', this_year: 'this year', last_year: 'last year' }
const BUCKET_WORDS: Record<DateBucket, string> = { day: 'per day', week: 'per week', month: 'per month', quarter: 'per quarter', year: 'per year' }

/** A name for a report from its settings: "Jobs by Stage", "Notes per month", "Total Estimate by Stage" */
export function suggestReportName(config: ReportConfig, fields: ReportField[], sourceWord: string): string {
  const label = (id: string) => fields.find(f => f.id === id)?.label ?? ''
  const what = config.values.length === 1 && config.values[0]!.fn !== 'count' ? valueLabel(config.values[0]!, fields) : sourceWord
  const groups = config.groupBy.map(g => g.bucket ? BUCKET_WORDS[g.bucket] : `by ${label(g.field)}`)
  let name = groups.length ? `${what} ${groups.join(' and ').replace(/ and by /g, ' and ')}` : config.columns?.length ? `${sourceWord} list` : `How many ${sourceWord.toLowerCase()}`
  if (config.dateRange?.preset) name += `, ${PRESET_WORDS[config.dateRange.preset]}`
  return (name.charAt(0).toUpperCase() + name.slice(1)).slice(0, 100)
}

/** One line saying what a report covers, for the PDF: "Jobs · Stage is Done · Date added: this month" */
export function describeReport(config: ReportConfig, fields: ReportField[], listName: string, sourceWord: string): string {
  const label = (id: string) => fields.find(f => f.id === id)?.label ?? id
  const parts = [config.source === 'records' ? listName : `${sourceWord} in ${listName}`]
  for (const f of config.filters.filter(isFilterActive)) {
    const kind = fields.find(x => x.id === f.field)?.kind ?? 'text'
    parts.push(`${label(f.field)} ${OPERATOR_LABELS[f.operator]}${filterNeedsValue(f.operator) ? ` ${kind === 'date' ? formatYmd(f.value) : f.value}` : ''}`)
  }
  if (config.dateRange) {
    const r = config.dateRange
    const when = r.preset ? PRESET_WORDS[r.preset] : [r.from && `from ${formatYmd(r.from)}`, r.to && `to ${formatYmd(r.to)}`].filter(Boolean).join(' ') || 'any time'
    parts.push(`${label(r.field)}: ${when}`)
  }
  if (config.includeArchived) parts.push('including archived')
  return parts.join(' · ')
}

const VALUE_WORDS: Record<ValueFn, string> = { count: 'how many', sum: 'the total', avg: 'the average', min: 'the lowest', max: 'the highest' }
const BUCKET_NOUNS: Record<DateBucket, string> = { day: 'day', week: 'week', month: 'month', quarter: 'quarter', year: 'year' }

function andList(xs: string[]): string {
  return xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`
}

/**
 * The report in a sentence, for people who don't think in "group by":
 * "Counting 10 jobs, one line per Stage, showing how many and the total Estimate."
 */
export function explainReport(config: ReportConfig, fields: ReportField[], sourceWord: { one: string; many: string }, listName: string, matched: number | null = null): string {
  const label = (id: string) => fields.find(f => f.id === id)?.label ?? id
  // Both forms come from the words: "1 property", "1 child", not a guess at the plural
  const src = sourceWord.many.toLowerCase()
  const what = matched === null ? src : `${matched.toLocaleString('en-US')} ${matched === 1 ? sourceWord.one.toLowerCase() : src}`
  const listing = config.groupBy.length === 0 && !!config.columns?.length
  let s = `${listing ? 'Listing' : 'Counting'} ${what}${config.source === 'records' ? '' : ` in ${listName}`}`
  const conds = config.filters.filter(isFilterActive).map(f => {
    const kind = fields.find(x => x.id === f.field)?.kind ?? 'text'
    return `${label(f.field)} ${OPERATOR_LABELS[f.operator]}${filterNeedsValue(f.operator) ? ` ${kind === 'date' ? formatYmd(f.value) : f.value}` : ''}`
  })
  if (conds.length) s += ` where ${conds.join(' and ')}`
  // A note's or appointment's own date goes without saying; any other date is named
  const obvious = (id: string) => id === 'act:date' || id === 'appt:date' || id === 'dl:due'
  if (config.dateRange) {
    const r = config.dateRange
    const when = r.preset ? PRESET_WORDS[r.preset] : [r.from && `from ${formatYmd(r.from)}`, r.to && `to ${formatYmd(r.to)}`].filter(Boolean).join(' ')
    const sameAsGroup = config.groupBy.some(g => g.field === r.field)
    if (when) s += obvious(r.field) || sameAsGroup ? `, ${when}` : `, with ${label(r.field)} ${when}`
  }
  if (config.groupBy.length) {
    s += `, one line per ${andList(config.groupBy.map(g => g.bucket ? `${BUCKET_NOUNS[g.bucket]}${obvious(g.field) ? '' : ` of ${label(g.field)}`}` : label(g.field)))}`
  } else if (listing) {
    s += `, showing ${andList(config.columns!.map(label))}`
    return `${s}.`
  }
  const values = config.values.length ? config.values : [{ fn: 'count' as const }]
  s += `, showing ${andList(values.map(v => v.fn === 'count' ? VALUE_WORDS.count : `${VALUE_WORDS[v.fn]} ${label(v.field ?? '')}`))}`
  return `${s}.`
}

/** A grouped report with one grouping and a number to show can also be drawn as bars */
export function chartableReport(config: ReportConfig, result: ReportResult): boolean {
  return config.groupBy.length === 1 && result.rows.length >= 2 && result.rows.length <= 40
    && result.columns.some(c => /^v\d+$/.test(c.key) && (c.kind === 'number' || c.kind === 'currency'))
}
