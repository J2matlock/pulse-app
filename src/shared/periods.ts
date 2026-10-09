/**
 * Calendar periods for requirements: "2 check-ins per week", "1 visit per
 * quarter" (plans/generalization/W03-activity.md §4). All in local time.
 */
import { localDateString } from './dates'

export type Period = 'week' | 'month' | 'quarter' | 'year'
export const PERIODS: readonly Period[] = ['week', 'month', 'quarter', 'year']
export type WeekStart = 'sunday' | 'monday'

/** Most a requirement can ask for in one period */
export const PERIOD_MAX: Record<Period, number> = { week: 14, month: 31, quarter: 92, year: 365 }

export interface PeriodRange {
  period: Period
  /** First and last day, 'YYYY-MM-DD' */
  start: string
  end: string
  /** '2026-W40', '2026-10', '2026-Q4', '2026' */
  key: string
  /** 'Week of Sep 28', 'October 2026', 'Q4 2026', '2026' */
  label: string
}

export function isPeriod(v: unknown): v is Period {
  return typeof v === 'string' && (PERIODS as readonly string[]).includes(v)
}

/** ISO-style week number of the week's middle day, so a week has one number whichever day starts it */
function weekNumber(weekStartDay: Date): { year: number; week: number } {
  const mid = new Date(weekStartDay.getFullYear(), weekStartDay.getMonth(), weekStartDay.getDate() + 3)
  const jan4 = new Date(mid.getFullYear(), 0, 4)
  const firstMid = new Date(jan4.getFullYear(), 0, 4 - ((jan4.getDay() + 6) % 7) + 3)
  return { year: mid.getFullYear(), week: 1 + Math.round((mid.getTime() - firstMid.getTime()) / (7 * 86_400_000)) }
}

/** The period of the given kind that contains `ref`. */
export function periodRange(period: Period, ref: Date, weekStart: WeekStart = 'sunday'): PeriodRange {
  const y = ref.getFullYear()
  const m = ref.getMonth()
  if (period === 'week') {
    const offset = (ref.getDay() - (weekStart === 'monday' ? 1 : 0) + 7) % 7
    const start = new Date(y, m, ref.getDate() - offset)
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6)
    const { year, week } = weekNumber(start)
    return {
      period, start: localDateString(start), end: localDateString(end),
      key: `${year}-W${String(week).padStart(2, '0')}`,
      label: `Week of ${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
    }
  }
  if (period === 'month') {
    return {
      period, start: localDateString(new Date(y, m, 1)), end: localDateString(new Date(y, m + 1, 0)),
      key: `${y}-${String(m + 1).padStart(2, '0')}`,
      label: ref.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    }
  }
  if (period === 'quarter') {
    const q = Math.floor(m / 3)
    return {
      period, start: localDateString(new Date(y, q * 3, 1)), end: localDateString(new Date(y, q * 3 + 3, 0)),
      key: `${y}-Q${q + 1}`, label: `Q${q + 1} ${y}`,
    }
  }
  return { period, start: `${y}-01-01`, end: `${y}-12-31`, key: String(y), label: String(y) }
}

/** Whole days after `today` until the period ends (0 on its last day). */
export function daysLeft(range: PeriodRange, today: Date = new Date()): number {
  const [ey, em, ed] = range.end.split('-').map(Number)
  const end = new Date(ey!, em! - 1, ed!)
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.max(0, Math.round((end.getTime() - t.getTime()) / 86_400_000))
}

/** 'YYYY-MM-DD' as a local date */
export function parseLocalDate(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y!, m! - 1, d!)
}
