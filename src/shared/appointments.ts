/**
 * Appointments (generalization W07): types, validation and the date math for
 * recurring series, shared by main and the window. Times are local wall time
 * with no zone: 'YYYY-MM-DDTHH:MM', or 'YYYY-MM-DD' when all-day.
 */
import { z } from 'zod'
import { dateToYmd, addDays as addYmdDays } from './ymd'
import { LIVE_GRID, LIVE_ROW, NOT_TRASHED_ROW } from './liveRecords'

export const APPT_STATUSES = ['scheduled', 'done', 'cancelled', 'no_show'] as const
export type ApptStatus = typeof APPT_STATUSES[number]
export type EditScope = 'one' | 'following' | 'all'

export interface Appointment {
  id: number
  row_id: number | null
  series_id: number | null
  title: string
  start_at: string
  end_at: string | null
  all_day: 0 | 1
  location: string | null
  activity_type_key: string | null
  status: ApptStatus
  case_log_id: number | null
  notes: string | null
  is_exception: 0 | 1
  created_at: string
  updated_at: string
  /** The record it's about, when there is one (and it isn't in the trash) */
  record_name: string | null
  grid_id: number | null
  grid_name: string | null
  /** Its series' rule (JSON), when it repeats */
  series_rule?: string | null
}

/**
 * Scheduled appointments of an archived record aren't upcoming work any
 * more; what already happened (done, no-show, cancelled) still shows.
 * Nothing shows for a record in the Trash or a record of a list in the
 * Trash (A16-04). Needs `r` (rows) and `g` (grids).
 */
export const OPEN_RECORD_SQL = `(a.row_id IS NULL OR (${NOT_TRASHED_ROW} AND ${LIVE_GRID} AND (a.status != 'scheduled' OR ${LIVE_ROW})))`

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
export const TIME_RE = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional().transform(v => (v ? v : null))

export const apptInputSchema = z.object({
  row_id: z.number().int().positive().nullable().optional(),
  title: z.string().trim().min(1).max(200),
  start_at: z.string(),
  end_at: z.string().nullable().optional(),
  all_day: z.boolean().optional(),
  location: optionalText(300),
  activity_type_key: z.string().regex(/^[a-z0-9_]{1,30}$/).nullable().optional(),
  notes: optionalText(5000),
}).strict().superRefine((v, ctx) => {
  const re = v.all_day ? DATE_RE : TIME_RE
  if (!re.test(v.start_at) || !validWallTime(v.start_at)) ctx.addIssue({ code: 'custom', message: 'Choose a start date and time.' })
  if (v.end_at != null && (!re.test(v.end_at) || !validWallTime(v.end_at))) ctx.addIssue({ code: 'custom', message: 'Choose an end date and time.' })
  if (v.end_at != null && v.end_at < v.start_at) ctx.addIssue({ code: 'custom', message: 'The end has to be after the start.' })
  if (v.end_at != null && !v.all_day && v.end_at === v.start_at) ctx.addIssue({ code: 'custom', message: 'The end has to be after the start.' })
})
export type ApptInput = z.input<typeof apptInputSchema>

export const apptPatchSchema = z.object({
  row_id: z.number().int().positive().nullable().optional(),
  title: z.string().trim().min(1).max(200).optional(),
  start_at: z.string().optional(),
  end_at: z.string().nullable().optional(),
  all_day: z.boolean().optional(),
  location: optionalText(300),
  activity_type_key: z.string().regex(/^[a-z0-9_]{1,30}$/).nullable().optional(),
  notes: optionalText(5000),
}).strict()
export type ApptPatch = z.input<typeof apptPatchSchema>

/** A real calendar date and time (no Feb 30, no 25:00) */
export function validWallTime(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(s)
  if (!m) return false
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3])
}

// ── Recurring series ─────────────────────────────────────────────────────────

export const seriesRuleSchema = z.object({
  freq: z.enum(['daily', 'weekly', 'monthly']),
  interval: z.number().int().min(1).max(12),
  /** Weekly: days of the week, 0 = Sunday … 6 = Saturday (default: the start's day) */
  byDay: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
  until: z.string().regex(DATE_RE).optional(),
  count: z.number().int().min(1).max(500).optional(),
  /** Stop on the date in this column of the record ("until the authorization ends") */
  untilColumnId: z.number().int().positive().optional(),
}).strict()
export type SeriesRule = z.infer<typeof seriesRuleSchema>

/** The most times a "N times" series can have */
export const MAX_OCCURRENCES = 500
/** A guard against runaway loops for series with no end (about 27 years of days) */
const MAX_DATES = 10_000
/** Occurrences are made this far ahead, and never more than two years past today */
export const MATERIALIZE_MONTHS = 6
export const MAX_HORIZON_MONTHS = 24

const pad = (n: number) => String(n).padStart(2, '0')
export const ymd = dateToYmd

export function parseYmd(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d)
}

/** The same day N months on, or that month's last day when it's shorter (Jan 31 + 1 = Feb 28, A21b-07) */
export function addMonths(date: string, months: number): string {
  const d = parseYmd(date)
  const lastDay = new Date(d.getFullYear(), d.getMonth() + months + 1, 0).getDate()
  return ymd(new Date(d.getFullYear(), d.getMonth() + months, Math.min(d.getDate(), lastDay)))
}

export function addDays(date: string, days: number): string {
  return addYmdDays(date.slice(0, 10), days)
}

/** Minutes between two wall times on any days (DST doesn't change wall-clock length here) */
export function minutesBetween(a: string, b: string): number {
  const toMin = (s: string) => {
    // Day numbers from UTC midnights: local midnights shift by an hour across DST,
    // which in UTC+13 is enough to round to the wrong day
    const [y, mo, d] = s.slice(0, 10).split('-').map(Number) as [number, number, number]
    const days = Date.UTC(y, mo - 1, d) / 86_400_000
    const [h, m] = (s.slice(11) || '00:00').split(':').map(Number) as [number, number]
    return days * 1440 + h * 60 + m
  }
  return toMin(b) - toMin(a)
}

/** A wall time moved by some minutes */
export function addMinutes(s: string, minutes: number): string {
  const d = parseYmd(s)
  const [h, m] = (s.slice(11) || '00:00').split(':').map(Number) as [number, number]
  const total = h * 60 + m + minutes
  const dayShift = Math.floor(total / 1440)
  const rest = ((total % 1440) + 1440) % 1440
  const day = ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + dayShift))
  return s.length > 10 ? `${day}T${pad(Math.floor(rest / 60))}:${pad(rest % 60)}` : day
}

/**
 * The start dates of a series, from its first start, up to and including
 * `through` (a date), honoring until/count. A series with no end keeps
 * going; the caller decides how far ahead to look (two years past today).
 * Monthly on the 31st lands on the last day of shorter months.
 */
export function seriesDates(rule: SeriesRule, firstStart: string, through: string, untilFromColumn?: string | null): string[] {
  const first = firstStart.slice(0, 10)
  const ends = [through, rule.until, untilFromColumn ?? undefined].filter((x): x is string => !!x && DATE_RE.test(x))
  const end = ends.sort()[0]!
  const max = rule.count ? Math.min(rule.count, MAX_OCCURRENCES) : MAX_DATES
  const out: string[] = []
  const f = parseYmd(first)
  if (rule.freq === 'daily') {
    for (let i = 0; out.length < max; i++) {
      const d = ymd(new Date(f.getFullYear(), f.getMonth(), f.getDate() + i * rule.interval))
      if (d > end) break
      out.push(d)
    }
  } else if (rule.freq === 'weekly') {
    const days = [...new Set(rule.byDay ?? [f.getDay()])].sort()
    // Weeks counted from the week of the first start (Sunday-based)
    const weekStart = new Date(f.getFullYear(), f.getMonth(), f.getDate() - f.getDay())
    for (let w = 0; out.length < max; w += rule.interval) {
      let past = false
      for (const day of days) {
        const d = ymd(new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + w * 7 + day))
        if (d < first) continue
        if (d > end) { past = true; break }
        out.push(d)
        if (out.length >= max) break
      }
      if (past) break
    }
  } else {
    for (let i = 0; out.length < max; i++) {
      const target = new Date(f.getFullYear(), f.getMonth() + i * rule.interval, 1)
      const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
      const d = ymd(new Date(target.getFullYear(), target.getMonth(), Math.min(f.getDate(), last)))
      if (d > end) break
      out.push(d)
    }
  }
  return out
}

/** What an appointment template carries into each occurrence */
export interface SeriesTemplate {
  row_id: number | null
  title: string
  /** 'HH:MM', or null for all-day */
  time: string | null
  duration_min: number | null
  location: string | null
  activity_type_key: string | null
  notes: string | null
}

/** "Every week on Tue, Thu" / "Every 2 months · until Mar 3, 2027" / "Every week · 10 times" */
export function describeRule(rule: SeriesRule): string {
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const unit = rule.freq === 'daily' ? 'day' : rule.freq === 'weekly' ? 'week' : 'month'
  let s = rule.interval === 1 ? `Every ${unit}` : `Every ${rule.interval} ${unit}s`
  if (rule.freq === 'weekly' && rule.byDay?.length) s += ` on ${[...rule.byDay].sort().map(d => DAYS[d]).join(', ')}`
  if (rule.count) s += ` · ${rule.count} ${rule.count === 1 ? 'time' : 'times'}`
  else if (rule.until) s += ` · until ${parseYmd(rule.until).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
  else if (rule.untilColumnId) s += ' · until a date in a column'
  return s
}

/** "Every week on Tue · until Mar 3, 2027" for a repeating appointment; null otherwise */
export function seriesRuleText(a: Pick<Appointment, 'series_id' | 'series_rule'>): string | null {
  if (a.series_id === null || !a.series_rule) return null
  try {
    const r = seriesRuleSchema.safeParse(JSON.parse(a.series_rule))
    return r.success ? describeRule(r.data) : null
  } catch { return null }
}
