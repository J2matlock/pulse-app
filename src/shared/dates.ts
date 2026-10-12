/**
 * Calendar-date helpers shared by main and renderer.
 *
 * Deadlines, due dates, and follow-ups are local calendar dates (YYYY-MM-DD).
 * Never derive one with `toISOString().slice(0, 10)`: that converts to UTC, so
 * "today" flips to tomorrow in US evenings and dates shift a day early east of UTC.
 */

/** Local calendar date of `d` as YYYY-MM-DD. */
export function localDateString(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Local calendar date `days` from today (negative for the past). */
export function localDateFromToday(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return localDateString(d)
}

const SHORT_DATE: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }

/** "Oct 14, 2026": the fixed US-English short date the app's labels use */
export function shortDate(d: Date): string {
  return d.toLocaleDateString('en-US', SHORT_DATE)
}

/**
 * A 'YYYY-MM-DD' calendar date as a local Date (never shifted by UTC); a value
 * that isn't one gives an Invalid Date. (ymdToDate in ymd.ts is the deadline
 * engine's reader, which also keeps years below 100.)
 */
export function ymdLocalDate(ymd: string): Date {
  const [y = NaN, m = NaN, d = NaN] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** A 'YYYY-MM-DD' calendar date as "Oct 14, 2026" */
export function shortYmd(ymd: string): string {
  return shortDate(ymdLocalDate(ymd))
}

/**
 * Parse a SQLite `datetime('now')` timestamp ("YYYY-MM-DD HH:MM:SS", stored in UTC
 * with no zone suffix) into a Date. `new Date()` alone would read it as local time
 * and shift it by the UTC offset. ISO strings that already carry a zone pass through.
 */
export function parseDbTimestamp(value: string): Date {
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(value)) {
    return new Date(value.replace(' ', 'T') + 'Z')
  }
  return new Date(value)
}

/** Whole years from a date of birth to today, or null when it can't be read or is in the future */
export function ageInYears(dobValue: string, today: Date = new Date()): number | null {
  const dob = new Date(dobValue.includes('T') ? dobValue : `${dobValue}T00:00:00`)
  if (isNaN(dob.getTime())) return null
  let age = today.getFullYear() - dob.getFullYear()
  const m = today.getMonth() - dob.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--
  return age < 0 ? null : age
}
