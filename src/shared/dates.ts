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
