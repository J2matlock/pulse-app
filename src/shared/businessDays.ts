/**
 * Working days for deadlines: "60 school days", "roll back to the previous
 * business day" (W05 §3.7). Holidays and the weekend come from the
 * workspace (settings `workspace_holidays`, `workspace_weekend`).
 */
import { dateToYmd, ymdToDate } from './ymd'

export interface WorkCalendar {
  holidays: Set<string>
  /** Days of the week that are off: 0 = Sunday … 6 = Saturday */
  weekend: number[]
}

export const DEFAULT_WEEKEND = [0, 6]
export const MAX_HOLIDAYS = 1000

export function isDayOff(ymd: string, cal: WorkCalendar): boolean {
  return cal.weekend.includes(ymdToDate(ymd).getDay()) || cal.holidays.has(ymd)
}

function shift(ymd: string, days: number): string {
  const d = ymdToDate(ymd)
  return dateToYmd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days))
}

/**
 * Move `n` working days from a date (negative = earlier). The start day
 * itself never counts. With every day off (a misconfigured calendar) the
 * plain calendar day count is used rather than looping forever.
 */
export function addBusinessDays(ymd: string, n: number, cal: WorkCalendar): string {
  if (n === 0) return ymd
  if (cal.weekend.length >= 7) return shift(ymd, n)
  const step = n > 0 ? 1 : -1
  let left = Math.abs(n)
  let cur = ymd
  // Holidays are finite, so a run of days off can't be longer than this
  for (let guard = 0; left > 0 && guard < Math.abs(n) * 7 + MAX_HOLIDAYS + 7; guard++) {
    cur = shift(cur, step)
    if (!isDayOff(cur, cal)) left--
  }
  return cur
}

/** The same day if it's a working day, otherwise the working day before it. */
export function rollBackToBusinessDay(ymd: string, cal: WorkCalendar): string {
  if (cal.weekend.length >= 7) return ymd
  let cur = ymd
  for (let guard = 0; isDayOff(cur, cal) && guard < MAX_HOLIDAYS + 7; guard++) cur = shift(cur, -1)
  return cur
}

function nthWeekday(year: number, month: number, weekday: number, n: number): string {
  const first = new Date(year, month, 1)
  const day = 1 + ((weekday - first.getDay() + 7) % 7) + (n - 1) * 7
  return dateToYmd(new Date(year, month, day))
}

function lastWeekday(year: number, month: number, weekday: number): string {
  const last = new Date(year, month + 1, 0)
  return dateToYmd(new Date(year, month, last.getDate() - ((last.getDay() - weekday + 7) % 7)))
}

/** A fixed-date holiday on a weekend is observed on the nearest weekday. */
function observed(year: number, month: number, day: number): string {
  const d = new Date(year, month, day)
  if (d.getDay() === 6) return dateToYmd(new Date(year, month, day - 1))
  if (d.getDay() === 0) return dateToYmd(new Date(year, month, day + 1))
  return dateToYmd(d)
}

/** US federal holidays (observed dates) for a year, worked out locally — no network. */
export function usFederalHolidays(year: number): Array<{ date: string; name: string }> {
  return [
    { date: observed(year, 0, 1), name: "New Year's Day" },
    { date: nthWeekday(year, 0, 1, 3), name: 'Martin Luther King Jr. Day' },
    { date: nthWeekday(year, 1, 1, 3), name: "Washington's Birthday" },
    { date: lastWeekday(year, 4, 1), name: 'Memorial Day' },
    { date: observed(year, 5, 19), name: 'Juneteenth' },
    { date: observed(year, 6, 4), name: 'Independence Day' },
    { date: nthWeekday(year, 8, 1, 1), name: 'Labor Day' },
    { date: nthWeekday(year, 9, 1, 2), name: 'Columbus Day' },
    { date: observed(year, 10, 11), name: 'Veterans Day' },
    { date: nthWeekday(year, 10, 4, 4), name: 'Thanksgiving Day' },
    { date: observed(year, 11, 25), name: 'Christmas Day' },
  ]
}

/** Every day from start to end inclusive, for adding a school break as days off. */
export function daysInRange(start: string, end: string, max = 366): string[] {
  const out: string[] = []
  for (let cur = start; cur <= end && out.length < max; cur = shift(cur, 1)) out.push(cur)
  return out
}
