/** Calendar view helpers (W07 §6): items besides appointments, and the date math for grids. */
import type { DeadlineState } from './deadlineEngine'
import { addDays, parseYmd, ymd } from './appointments'

export type CalendarLayer = 'appointments' | 'deadlines' | 'followups' | 'tasks'
export const CALENDAR_LAYERS: readonly CalendarLayer[] = ['appointments', 'deadlines', 'followups', 'tasks']

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
