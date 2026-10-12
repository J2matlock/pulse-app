/**
 * Reading a typed or pasted date as YYYY-MM-DD (shared by Import and the
 * grid's paste, audit G-14). Handles Excel serials (Import only), ISO dates (with or
 * without a time), M/D/Y with slashes, dashes or dots (2- or 4-digit years),
 * and written months ("Feb 19, 2026", "19 Feb 2026", "19-Feb-26").
 */
import { MS_PER_DAY } from './constants'
import { localDateString } from './dates'

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
}

function monthFromName(name: string): number | undefined {
  const n = name.toLowerCase().replace(/\.$/, '')
  return MONTHS[n] ?? MONTHS[n.slice(0, 3)]
}

/**
 * Two-digit years use a sliding window, as spreadsheets do: up to 20 years
 * ahead of this year is this century's, anything later is the last century's.
 * In 2026, "1/15/27" is 2027 (next year's review date) and "3/15/50" is 1950.
 * Birthdays pass `birth` to parseDate: a two-digit year that would put the
 * date in the future goes back a century ("3/15/40" is 1940, not 2040).
 */
const TWO_DIGIT_YEARS_AHEAD = 20

function fullYear(y: number): number {
  if (y >= 100) return y
  const now = new Date().getFullYear()
  let full = Math.floor(now / 100) * 100 + y
  if (full > now + TWO_DIGIT_YEARS_AHEAD) full -= 100
  else if (full <= now + TWO_DIGIT_YEARS_AHEAD - 100) full += 100
  return full
}

/** A column for birthdays, by its name ("DOB", "Date of birth", "Born") */
export function looksLikeBirthColumn(name: string): boolean {
  return /\b(dob|d\.o\.b\.?|birth\w*|born)\b/i.test(name)
}

/** The value ends in a two-digit year ("3/15/30", "15-Mar-30"), not a 4-digit year or an Excel serial */
export function hasTwoDigitYear(value: string): boolean {
  const v = value.trim()
  return !v.includes(':') && !/^\d{4}[-/.]/.test(v) && /(^|[^\d])\d{2}$/.test(v) && !/^\d+$/.test(v)
}

export interface ParseDateOptions {
  /** A birthday: a two-digit year never puts it in the future (it goes back a century) */
  birth?: boolean
  /**
   * Read a bare 5-digit number as an Excel serial (Import only, Q-033). Pasting
   * or changing a column to Date must not turn a zip code or ID into a date.
   */
  allowSerial?: boolean
}

/** Excel serials Import reads as dates: up to 73050, about the year 2100 */
const MAX_DATE_SERIAL = 73050

/** Validated YYYY-MM-DD from calendar parts (rejects 02/30 etc.), or null. */
export function ymdFromParts(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** YYYY-MM-DD, or null when the value isn't a recognizable date. */
export function parseDate(value: string, order: 'mdy' | 'dmy' = 'mdy', options: ParseDateOptions = {}): string | null {
  const ymd = parseDateRaw(value, order, options.allowSerial === true)
  if (!ymd || !options.birth || !hasTwoDigitYear(value) || ymd <= localDateString()) return ymd
  return ymdFromParts(Number(ymd.slice(0, 4)) - 100, Number(ymd.slice(5, 7)), Number(ymd.slice(8, 10))) ?? ymd
}

function parseDateRaw(value: string, order: 'mdy' | 'dmy', allowSerial: boolean): string | null {
  const v = value.trim()
  // Excel serial date (5-digit number). Computed entirely in UTC so no local
  // offset can shift the calendar day.
  if (/^\d{5}$/.test(v)) {
    const serial = parseInt(v, 10)
    if (!allowSerial || serial > MAX_DATE_SERIAL) return null
    // Excel epoch: Jan 1 1900 = serial 1 (with the Lotus 1-2-3 bug: serial 60 = Feb 29 1900)
    const d = new Date(Date.UTC(1899, 11, 30) + serial * MS_PER_DAY)
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
  }
  // ISO 8601 (YYYY-MM-DD or YYYY/MM/DD), optionally followed by a time
  const isoMatch = v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/)
  if (isoMatch) {
    const ymd = ymdFromParts(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]))
    if (ymd) return ymd
  }
  // Numeric M/D/Y or D/M/Y with / - or . separators, optionally followed by a time
  const numMatch = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AaPp][Mm])?)?$/)
  if (numMatch) {
    const a = Number(numMatch[1]), b = Number(numMatch[2]), y = fullYear(Number(numMatch[3]))
    const dayFirst = a > 12 ? true : b > 12 ? false : order === 'dmy'
    const ymd = dayFirst ? ymdFromParts(y, b, a) : ymdFromParts(y, a, b)
    if (ymd) return ymd
  }
  // Written month first: "Feb 19, 2026", "February 19 2026", "Feb-19-26"
  const monFirst = v.match(/^([A-Za-z]{3,9}\.?)[\s-]+(\d{1,2})(?:st|nd|rd|th)?,?[\s-]+(\d{2}|\d{4})$/)
  if (monFirst) {
    const m = monthFromName(monFirst[1]!)
    const ymd = m ? ymdFromParts(fullYear(Number(monFirst[3])), m, Number(monFirst[2])) : null
    if (ymd) return ymd
  }
  // Day first: "19 Feb 2026", "19-Feb-26"
  const dayFirstMatch = v.match(/^(\d{1,2})[\s-]+([A-Za-z]{3,9}\.?)[\s-]+(\d{2}|\d{4})$/)
  if (dayFirstMatch) {
    const m = monthFromName(dayFirstMatch[2]!)
    const ymd = m ? ymdFromParts(fullYear(Number(dayFirstMatch[3])), m, Number(dayFirstMatch[1])) : null
    if (ymd) return ymd
  }
  // Don't fall through to `new Date(v)` — ambiguous formats parse non-deterministically
  return null
}

/**
 * Day-first or month-first for a whole column: any value with a first number
 * over 12 means day-first (e.g. 25/03/2026). US order otherwise.
 */
export function detectDateOrder(values: string[], fallback: 'mdy' | 'dmy' = 'mdy'): 'mdy' | 'dmy' {
  return analyzeDateOrder(values, fallback).order
}

export interface DateOrderAnalysis {
  order: 'mdy' | 'dmy'
  /** Values only day-first can read (25/03/2026), and only month-first (03/25/2026) */
  dayFirst: number
  monthFirst: number
  /** Values either order reads, differently (03/04/2026) */
  ambiguous: number
  /** An example of each, for the warning */
  examples: { dayFirst?: string; monthFirst?: string; ambiguous?: string }
  /** Whether the column's own values chose the order, or Settings did */
  settledBy: 'data' | 'fallback'
}

/** detectDateOrder with what it saw, so the import can say when the order was a guess (F-026) */
export function analyzeDateOrder(values: string[], fallback: 'mdy' | 'dmy' = 'mdy'): DateOrderAnalysis {
  let dayFirst = 0, monthFirst = 0, ambiguous = 0
  const examples: DateOrderAnalysis['examples'] = {}
  for (const v of values) {
    const m = v.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-]\d{2,4}/)
    if (!m) continue
    const a = Number(m[1]), b = Number(m[2])
    if (a > 12) { dayFirst++; examples.dayFirst ??= v.trim() }
    else if (b > 12) { monthFirst++; examples.monthFirst ??= v.trim() }
    else if (a !== b && a > 0 && b > 0) { ambiguous++; examples.ambiguous ??= v.trim() }
  }
  const settledBy = dayFirst === monthFirst ? 'fallback' : 'data'
  const order = settledBy === 'fallback' ? fallback : dayFirst > monthFirst ? 'dmy' : 'mdy'
  return { order, dayFirst, monthFirst, ambiguous, examples, settledBy }
}
