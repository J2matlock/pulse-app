/**
 * Local calendar dates as 'YYYY-MM-DD' strings: parsing, converting and
 * counting days, for the deadline engine and the business-day calendar.
 */
import { localDateString } from './dates'

/** Years a real date can have. A half-typed year (0026) would otherwise be read as 1926. */
export const MIN_YEAR = 1900
export const MAX_YEAR = 2999

/** The calendar date at the start of a stored value ('2026-03-01' or '2026-03-01T…'), or null. */
export function toYmd(value: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '')
  if (!m) return null
  const year = Number(m[1])
  if (year < MIN_YEAR || year > MAX_YEAR) return null
  const d = new Date(year, Number(m[2]) - 1, Number(m[3]))
  // Reject impossible dates like 2026-02-31 rather than letting them roll over
  return d.getMonth() === Number(m[2]) - 1 ? `${m[1]}-${m[2]}-${m[3]}` : null
}

/**
 * A filled-in value that isn't a date toYmd can read ("TBD", "2/30/2026", a 5-digit year).
 * In a column with a deadline rule it means no deadline can be worked out (AUDIT-026).
 */
export function isNotADate(value: string | null | undefined): boolean {
  return !!value && value.trim() !== '' && toYmd(value) === null
}

export function ymdToDate(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number)
  const date = new Date(y!, m! - 1, d!)
  // new Date() maps years 0–99 to 1900–1999; put the real year back
  if (y! < 100) date.setFullYear(y!, m! - 1, d!)
  return date
}

/** The calendar date `days` after a 'YYYY-MM-DD' date (negative for before), safe across daylight saving */
export function addDays(ymd: string, days: number): string {
  const d = ymdToDate(ymd)
  d.setDate(d.getDate() + days)
  return dateToYmd(d)
}

/** The same as localDateString, under the name the deadline code uses */
export function dateToYmd(d: Date): string {
  return localDateString(d)
}

/** Whole calendar days from a to b (b later = positive), safe across daylight-saving changes. */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((Date.UTC(by!, bm! - 1, bd!) - Date.UTC(ay!, am! - 1, ad!)) / 86_400_000)
}
