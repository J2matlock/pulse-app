/**
 * Reading a typed or pasted date as YYYY-MM-DD (shared by Import and the
 * grid's paste, audit G-14). Handles Excel serials, ISO dates (with or
 * without a time), M/D/Y with slashes, dashes or dots (2- or 4-digit years),
 * and written months ("Feb 19, 2026", "19 Feb 2026", "19-Feb-26").
 */
import { MS_PER_DAY } from './constants'

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
}

function monthFromName(name: string): number | undefined {
  const n = name.toLowerCase().replace(/\.$/, '')
  return MONTHS[n] ?? MONTHS[n.slice(0, 3)]
}

/**
 * Two-digit years: up to this year means this century, otherwise last. A
 * spreadsheet's "3/15/30" is far more often a 1930 birthday than a date four
 * years away. Birth-date columns get a further check in executeImport.
 */
function fullYear(y: number): number {
  if (y >= 100) return y
  return y <= new Date().getFullYear() % 100 ? 2000 + y : 1900 + y
}

/** Validated YYYY-MM-DD from calendar parts (rejects 02/30 etc.), or null. */
export function toYmd(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** YYYY-MM-DD, or null when the value isn't a recognizable date. */
export function parseDate(value: string, order: 'mdy' | 'dmy' = 'mdy'): string | null {
  const v = value.trim()
  // Excel serial date (5-digit number). Computed entirely in UTC so no local
  // offset can shift the calendar day.
  if (/^\d{5}$/.test(v)) {
    const serial = parseInt(v, 10)
    // Excel epoch: Jan 1 1900 = serial 1 (with the Lotus 1-2-3 bug: serial 60 = Feb 29 1900)
    const d = new Date(Date.UTC(1899, 11, 30) + serial * MS_PER_DAY)
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
  }
  // ISO 8601 (YYYY-MM-DD or YYYY/MM/DD), optionally followed by a time
  const isoMatch = v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/)
  if (isoMatch) {
    const ymd = toYmd(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]))
    if (ymd) return ymd
  }
  // Numeric M/D/Y or D/M/Y with / - or . separators, optionally followed by a time
  const numMatch = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AaPp][Mm])?)?$/)
  if (numMatch) {
    const a = Number(numMatch[1]), b = Number(numMatch[2]), y = fullYear(Number(numMatch[3]))
    const dayFirst = a > 12 ? true : b > 12 ? false : order === 'dmy'
    const ymd = dayFirst ? toYmd(y, b, a) : toYmd(y, a, b)
    if (ymd) return ymd
  }
  // Written month first: "Feb 19, 2026", "February 19 2026", "Feb-19-26"
  const monFirst = v.match(/^([A-Za-z]{3,9}\.?)[\s-]+(\d{1,2})(?:st|nd|rd|th)?,?[\s-]+(\d{2}|\d{4})$/)
  if (monFirst) {
    const m = monthFromName(monFirst[1]!)
    const ymd = m ? toYmd(fullYear(Number(monFirst[3])), m, Number(monFirst[2])) : null
    if (ymd) return ymd
  }
  // Day first: "19 Feb 2026", "19-Feb-26"
  const dayFirstMatch = v.match(/^(\d{1,2})[\s-]+([A-Za-z]{3,9}\.?)[\s-]+(\d{2}|\d{4})$/)
  if (dayFirstMatch) {
    const m = monthFromName(dayFirstMatch[2]!)
    const ymd = m ? toYmd(fullYear(Number(dayFirstMatch[3])), m, Number(dayFirstMatch[1])) : null
    if (ymd) return ymd
  }
  // Don't fall through to `new Date(v)` — ambiguous formats parse non-deterministically
  return null
}
