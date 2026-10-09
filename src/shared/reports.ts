/**
 * Saved reports (generalization W10 §6): what each row of the report is
 * (records, notes, appointments or deadlines), filters, an optional date
 * range, up to two groupings and up to six values. Fields are named by id
 * ("col:12", "act:date") and checked against what the list actually has.
 */
import { z } from 'zod'

export type ReportSource = 'records' | 'activities' | 'appointments' | 'deadlines'
export const REPORT_SOURCES: readonly ReportSource[] = ['records', 'activities', 'appointments', 'deadlines']

export type ReportFieldKind = 'text' | 'number' | 'currency' | 'date'

export interface ReportField {
  id: string
  label: string
  kind: ReportFieldKind
  /** Where it comes from, for grouping the picker ("Record", "Note"…) */
  group: string
}

export type DateBucket = 'day' | 'week' | 'month' | 'quarter' | 'year'
export const DATE_BUCKETS: readonly DateBucket[] = ['day', 'week', 'month', 'quarter', 'year']
export type DatePreset = 'this_month' | 'last_month' | 'this_quarter' | 'this_year' | 'last_year'
export type ValueFn = 'count' | 'sum' | 'avg' | 'min' | 'max'

export const REPORT_OPERATORS = ['contains', 'not_contains', 'equals', 'not_equals', 'starts_with', 'is_empty', 'is_not_empty', 'gt', 'lt', 'before', 'after'] as const
export type ReportOperator = (typeof REPORT_OPERATORS)[number]

export const REPORT_LIMITS = { sourceRows: 50_000, outputRows: 2_000, timeoutMs: 5_000, filters: 20, groupBy: 2, values: 6, columns: 30 } as const

const fieldId = z.string().regex(/^[a-z_]+(:[a-z0-9_]+){0,2}$/).max(80)
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const reportConfigSchema = z.object({
  source: z.enum(['records', 'activities', 'appointments', 'deadlines']),
  includeArchived: z.boolean().optional(),
  filters: z.array(z.object({ field: fieldId, operator: z.enum(REPORT_OPERATORS), value: z.string().max(500) })).max(REPORT_LIMITS.filters).default([]),
  dateRange: z.object({
    field: fieldId,
    from: ymd.optional(),
    to: ymd.optional(),
    preset: z.enum(['this_month', 'last_month', 'this_quarter', 'this_year', 'last_year']).optional(),
  }).optional(),
  groupBy: z.array(z.object({ field: fieldId, bucket: z.enum(['day', 'week', 'month', 'quarter', 'year']).optional() })).max(REPORT_LIMITS.groupBy).default([]),
  values: z.array(z.object({ fn: z.enum(['count', 'sum', 'avg', 'min', 'max']), field: fieldId.optional(), label: z.string().max(60).optional() })).max(REPORT_LIMITS.values).default([]),
  columns: z.array(fieldId).max(REPORT_LIMITS.columns).optional(),
  sort: z.object({ field: z.string().max(80), dir: z.enum(['asc', 'desc']) }).optional(),
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

/** A date's group label for a bucket; weeks start on Sunday */
export function bucketDate(ymdValue: string, bucket: DateBucket = 'day'): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymdValue)
  if (!m) return ymdValue
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  switch (bucket) {
    case 'year': return String(y)
    case 'quarter': return `${y} Q${Math.ceil(mo / 3)}`
    case 'month': return `${y}-${pad(mo)}`
    case 'week': {
      const dt = new Date(y, mo - 1, d)
      dt.setDate(dt.getDate() - dt.getDay())
      return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
    }
    default: return `${y}-${pad(mo)}-${pad(d)}`
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
    default: return { from: day(new Date(y, m, 1)), to: day(new Date(y, m + 1, 0)) }
  }
}

export function toNumber(v: ReportCell): number | null {
  if (v === null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const n = Number(String(v).replace(/[$,\s]/g, ''))
  return Number.isFinite(n) ? n : null
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

export function formatReportCell(v: ReportCell, kind: ReportFieldKind): string {
  if (v === null || v === '') return '—'
  if (typeof v === 'number') {
    if (kind === 'currency') return v.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
    return v.toLocaleString('en-US', { maximumFractionDigits: 2 })
  }
  return v
}

/** Which operators make sense for a field */
export function operatorsFor(kind: ReportFieldKind): ReportOperator[] {
  if (kind === 'date') return ['before', 'after', 'equals', 'is_empty', 'is_not_empty']
  if (kind === 'number' || kind === 'currency') return ['equals', 'not_equals', 'gt', 'lt', 'is_empty', 'is_not_empty']
  return ['contains', 'not_contains', 'equals', 'not_equals', 'starts_with', 'is_empty', 'is_not_empty']
}

export const OPERATOR_LABELS: Record<ReportOperator, string> = {
  contains: 'contains', not_contains: "doesn't contain", equals: 'is', not_equals: "isn't", starts_with: 'starts with',
  is_empty: 'is empty', is_not_empty: 'is filled in', gt: 'is more than', lt: 'is less than', before: 'is before', after: 'is after',
}
