/**
 * Local calendar dates as 'YYYY-MM-DD' strings: parsing, converting and
 * counting days, for the deadline engine and the business-day calendar.
 */
import { localDateString } from './dates'

/** The calendar date at the start of a stored value ('2026-03-01' or '2026-03-01T…'), or null. */
export function toYmd(value: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '')
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  // Reject impossible dates like 2026-02-31 rather than letting them roll over
  return d.getMonth() === Number(m[2]) - 1 ? `${m[1]}-${m[2]}-${m[3]}` : null
}

export function ymdToDate(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y!, m! - 1, d!)
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
