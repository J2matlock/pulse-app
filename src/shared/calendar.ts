/** Calendar view helpers (W07 §6): items besides appointments, and the date math for grids. */
import type { DeadlineState } from './deadlineEngine'
import { addDays, parseYmd, ymd } from './appointments'

/** 'events' are appointments with no record: their own layer, on even with the Appointments feature off */
export const CALENDAR_LAYERS = ['appointments', 'events', 'deadlines', 'followups', 'tasks'] as const
export type CalendarLayer = typeof CALENDAR_LAYERS[number]

export interface CalendarItem {
  kind: 'deadline' | 'followup' | 'task'
  key: string
  date: string
  title: string
  rowId?: number
  gridId?: number
  recordName?: string
  state?: DeadlineState
  daysUntil?: number | null
  columnId?: number
  /** Tasks: which one, so clicking it opens it */
  taskId?: number
}

/** The first day shown for a week containing `date` */
export function startOfWeek(date: string, weekStart: 'sunday' | 'monday'): string {
  const d = parseYmd(date)
  const back = weekStart === 'monday' ? (d.getDay() + 6) % 7 : d.getDay()
  return addDays(date, -back)
}

/** Six weeks covering the month of `date`, as rows of seven dates */
export function monthGrid(date: string, weekStart: 'sunday' | 'monday'): string[][] {
  const d = parseYmd(date)
  const first = ymd(new Date(d.getFullYear(), d.getMonth(), 1))
  const start = startOfWeek(first, weekStart)
  return Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, i) => addDays(start, w * 7 + i)))
}

export function sameMonth(a: string, b: string): boolean { return a.slice(0, 7) === b.slice(0, 7) }

/** "3:00 pm" or "15:00" */
export function formatTime(wall: string, clock: '12h' | '24h'): string {
  if (wall.length <= 10) return 'All day'
  const [h, m] = wall.slice(11, 16).split(':').map(Number) as [number, number]
  if (clock === '24h') return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  const hh = h % 12 === 0 ? 12 : h % 12
  return `${hh}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
}

const LONG_DAY = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
export const longDay = (date: string) => LONG_DAY.format(parseYmd(date))
const MONTH = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' })
export const monthTitle = (date: string) => MONTH.format(parseYmd(date))

// ── Which deadline columns show (calendar-flexibility plan, Part 1) ─────────
// The setting holds the columns turned OFF, so a column added later shows by
// default, and with no setting at all everything shows, as it always did.

export const HIDDEN_DEADLINES_KEY = 'calendar_hidden_deadline_columns'
export const MAX_HIDDEN_DEADLINE_COLUMNS = 5000

/** Strict: what the settings handler accepts, a JSON list of column ids */
export function validHiddenColumns(raw: string): boolean {
  try {
    const v = JSON.parse(raw) as unknown
    return Array.isArray(v) && v.length <= MAX_HIDDEN_DEADLINE_COLUMNS && v.every(x => Number.isSafeInteger(x) && (x as number) > 0)
  } catch { return false }
}

/** Lenient: the hidden columns, or none when the setting is missing or unreadable */
export function parseHiddenColumns(raw: string | null | undefined): Set<number> {
  if (!raw || !validHiddenColumns(raw)) return new Set()
  return new Set(JSON.parse(raw) as number[])
}

/** Which layer an appointment belongs to */
export function apptLayer(a: { row_id: number | null }): 'appointments' | 'events' {
  return a.row_id === null ? 'events' : 'appointments'
}

/**
 * The layers turned on, from the saved setting. It used to hold the layers
 * that were on; now it holds the ones turned off ({"hidden": [...]}), so a
 * layer added later (Events) shows for everyone until they turn it off.
 */
export function readCalendarLayers(raw: string | null | undefined): Set<CalendarLayer> {
  const all = new Set<CalendarLayer>(CALENDAR_LAYERS)
  try {
    const v = raw ? JSON.parse(raw) as unknown : null
    const known = (x: unknown): x is CalendarLayer => CALENDAR_LAYERS.includes(x as CalendarLayer)
    // The old list of layers that were on: those, plus layers it didn't know about
    if (Array.isArray(v)) return new Set([...v.filter(known), 'events'])
    if (v && typeof v === 'object' && Array.isArray((v as { hidden?: unknown }).hidden)) {
      for (const l of (v as { hidden: unknown[] }).hidden) if (known(l)) all.delete(l)
    }
  } catch { /* everything on */ }
  return all
}

export function writeCalendarLayers(on: Set<CalendarLayer>): string {
  return JSON.stringify({ hidden: CALENDAR_LAYERS.filter(l => !on.has(l)) })
}

/** One of a record's deadline columns, for "Deadline for a record" on a chosen day */
export interface DeadlineDayOption {
  columnId: number
  columnName: string
  /** What the column holds now */
  current: string | null
  /** The date to store so it's due that day; null when it can't be set that way */
  value: string | null
  /** Why not, in plain words */
  reason: string | null
  /** Days it could be due instead, nearest first */
  nearest: string[]
}
