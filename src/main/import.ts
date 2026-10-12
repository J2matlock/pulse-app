/**
 * import.ts — CSV and Excel (xlsx) import for the main process.
 * Steps: parse file → detect columns → map columns → import rows.
 *
 * Uses exceljs for Excel parsing (replaces xlsx/SheetJS which has unpatched CVEs).
 */

import { statSync } from 'fs'
import { readFile } from 'fs/promises'
import { TextDecoder } from 'util'
import Papa from 'papaparse'
import { parseDate, ymdFromParts, hasTwoDigitYear, looksLikeBirthColumn, analyzeDateOrder, type DateOrderAnalysis } from '../shared/parseDate'
import { localDateString } from '../shared/dates'
import { LAST_DONE_SUFFIX } from '../shared/constants'
import { VALID_COLUMN_TYPES, canImportInto } from '../shared/types'
import type { ColumnType } from '../shared/types'
import ExcelJS from 'exceljs'
import { unguardCsvFormula } from '../shared/csvGuard'
import { zipUncompressedSize } from './zip-size'

import { getDb } from './database'
import { logger } from './logger'
import type { Column } from '../shared/types'
import { hasDisplayFormat, refreshDisplayNames } from './display-names'
import { assignAutoNumbers, bumpAutoNumbersPastValues } from './auto-number'
import { addLink, createLinkedRecord, getLinkType, otherGridOf } from './links'
import { holdsOne, linkColumnSpecs, type LinkDirection } from '../shared/links'
import { LIVE_ROW, notTrashedRow } from '../shared/liveRecords'

/** Type guard: checks if a string is a valid ColumnType. */
function isValidColumnType(s: string): s is ColumnType {
  return VALID_COLUMN_TYPES.has(s as ColumnType)
}

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export interface DetectedColumn {
  index: number
  originalName: string
  detectedType: 'text' | 'date' | 'number' | 'phone' | 'email' | 'currency' | 'checkbox'
  samples: string[]  // first 5 non-empty values
  /** Most values look like "Smith, Jane" (offered: import as "Jane Smith") */
  lastFirstNames?: boolean
}

export interface ImportPreview {
  /** Sheet names (Excel only) */
  sheets: string[]
  /** Selected sheet index */
  activeSheet: number
  headers: string[]
  /** First 20 data rows (as parallel string arrays) */
  rows: string[][]
  detectedColumns: DetectedColumn[]
  /** 0-based index of detected/selected header row */
  detectedHeaderRow: number
  /** Confidence of header detection */
  headerDetectionConfidence: 'high' | 'medium' | 'low'
  /** Total raw rows before header split */
  rawRowCount: number
  /** First ~20 raw rows for preview display */
  rawPreviewRows?: string[][]
  /** Things about the file itself worth checking (its text format, rows past the limit) */
  warnings?: string[]
  /** Data rows hidden in the spreadsheet (Excel only). They import unless skipHiddenRows is set (AUDIT-127) */
  hiddenRowCount?: number
  /** Headers of columns hidden in the spreadsheet (Excel only) */
  hiddenColumns?: string[]
}

export interface ColumnMapping {
  /** Index in import file headers */
  sourceIndex: number
  /** 'create' | 'skip' | number (existing column ID) */
  action: 'create' | 'skip' | number
  /** Name to use when action = 'create' */
  newName?: string
  /** Type to use when action = 'create' */
  newType?: string
}

export interface ImportOptions {
  gridId: number
  /** File path to import */
  filePath: string
  /** For Excel: sheet name */
  sheetName?: string
  columnMappings: ColumnMapping[]
  /** Duplicate detection strategy */
  duplicateStrategy: 'none' | 'by_name' | 'by_column' | 'name_and_dob'
  /** Column ID to use for 'by_column' dedup */
  duplicateColumnId?: number
  /** If true, auto-trim whitespace and normalize dates/phones */
  cleanData: boolean
  /** 0-based header row index. If omitted, auto-detect. */
  headerRowIndex?: number
  /** Turn "Smith, Jane" into "Jane Smith" in columns flagged lastFirstNames */
  flipLastFirst?: boolean
  /** Link columns (W04): add a record to the other list for names that match no one */
  createMissingLinks?: boolean
  /** Leave out rows hidden in the spreadsheet (AUDIT-127) */
  skipHiddenRows?: boolean
}

export interface ImportResult {
  imported: number
  skipped: number
  warnings: string[]
  /** Names of the rows skipped as duplicates, in file order */
  skippedNames: string[]
  /** The records this import added, so it can be undone (moved to Trash) */
  newRowIds: number[]
}

export interface HeaderDetectionResult {
  headerRowIndex: number    // 0-based index into raw rows array
  confidence: 'high' | 'medium' | 'low'
  reason: string
}

interface MergedCellInfo {
  row: number      // 0-based
  startCol: number
  endCol: number
  /** Row of the merge's top-left cell, which holds its value */
  anchorRow: number
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

export { looksLikeBirthColumn }

/** An Excel date serial (5 digits, 1900–2100) */
function looksLikeDateSerial(s: string): boolean {
  const v = s.trim()
  if (!/^\d{5}$/.test(v)) return false
  const n = parseInt(v, 10)
  return n >= 1 && n <= 73050 // 73050 ≈ year 2100
}

/**
 * A written date. A bare 5-digit number counts only when `allowSerial` is set
 * (the header names a date): otherwise zip codes and ID numbers would be read
 * as dates. Real Excel date cells arrive as YYYY-MM-DD, not serials.
 */
function looksLikeDate(s: string, allowSerial = false): boolean {
  const v = s.trim()
  if (/^\d{5}$/.test(v)) return allowSerial && looksLikeDateSerial(v)
  return parseDate(v) !== null
}

/** Values that read as a ticked checkbox; anything else in CHECKBOX_FALSE is unticked */
const CHECKBOX_TRUE = new Set(['yes', 'y', 'true', '1', 'x', '✓', '✔', '☑', '✅', 'done', 'checked', 'complete', 'completed', 'on'])
const CHECKBOX_FALSE = new Set(['no', 'n', 'false', '0', 'off', 'unchecked', 'not done', 'incomplete', '✗', '✘', '☐'])
/** Values that make a column look like a checkbox (words like "done" are too common in text columns) */
const CHECKBOX_DETECT = new Set(['yes', 'no', 'y', 'n', 'true', 'false', '1', '0', 'x', '✓', '✔'])

function detectColumnType(samples: string[]): DetectedColumn['detectedType'] {
  if (samples.length === 0) return 'text'

  const nonEmpty = samples.filter(s => s.trim() !== '')
  if (nonEmpty.length === 0) return 'text'

  // Phone: (xxx) xxx-xxxx or xxx-xxx-xxxx or 10 digits
  const phoneRe = /^(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}$/
  if (nonEmpty.every(s => phoneRe.test(s.trim()))) return 'phone'

  // Email
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (nonEmpty.every(s => emailRe.test(s.trim()))) return 'email'

  // Date: check before number so "2026-01-15" isn't caught as number
  if (nonEmpty.every(s => looksLikeDate(s))) return 'date'

  // Checkbox: yes/no, y/n, true/false, x. A column of only 1s and 0s counts when it has both,
  // so a column of counts that happen to be 1 stays a number.
  const lower = nonEmpty.map(s => s.toLowerCase().trim())
  if (lower.every(v => CHECKBOX_DETECT.has(v))) {
    const onlyDigits = lower.every(v => v === '1' || v === '0')
    if (!onlyDigits || (lower.includes('1') && lower.includes('0'))) return 'checkbox'
  }

  // A leading zero (zip 02134, ID 0042) would be lost as a number
  if (nonEmpty.some(s => /^0\d+$/.test(s.trim()))) return 'text'

  // Money needs a currency sign somewhere, or every value written with exactly two decimals.
  // Plain whole numbers (household size, zip codes, IDs) are not money.
  const amountRe = /^-?\$?-?[\d,]+(\.\d{2})?$/
  if (nonEmpty.every(s => amountRe.test(s.trim()))
    && (nonEmpty.some(s => s.includes('$')) || nonEmpty.every(s => /\.\d{2}$/.test(s.trim())))) return 'currency'

  // Number
  if (nonEmpty.every(s => !isNaN(Number(s.trim().replace(/,/g, ''))) && s.trim() !== '')) return 'number'

  // Heuristic: if column name suggests a date AND most values parse as dates, treat as date
  // (handled at call site via header name check)

  return 'text'
}

function isShortDistinctText(value: string): boolean {
  const v = value.trim()
  if (!v) return false
  if (v.length > 40) return false
  if (/^\d+\.?\d*$/.test(v)) return false  // purely numeric
  if (looksLikeDate(v)) return false
  return true
}

export function extractMergedRanges(ws: ExcelJS.Worksheet): MergedCellInfo[] {
  const result: MergedCellInfo[] = []
  // ExcelJS stores merged cells as an object with address-range keys
  // e.g. ws.model.merges = ['A1:D1', 'B3:E3']
  const merges: string[] = (ws.model as { merges?: string[] }).merges ?? []
  for (const range of merges) {
    // Parse "A1:D4" style ranges
    const match = range.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/)
    if (!match) continue
    const startCol = colLetterToIndex(match[1]!)
    const row = parseInt(match[2]!, 10) - 1  // 0-based
    const endCol = colLetterToIndex(match[3]!)
    const endRow = parseInt(match[4]!, 10) - 1
    // Add entry for each row in the merge
    for (let r = row; r <= endRow; r++) {
      result.push({ row: r, startCol, endCol, anchorRow: row })
    }
  }
  return result
}

function colLetterToIndex(letters: string): number {
  let idx = 0
  for (let i = 0; i < letters.length; i++) {
    idx = idx * 26 + (letters.charCodeAt(i) - 64)
  }
  return idx - 1  // 0-based
}

export function detectHeaderRow(rawRows: string[][], mergedRanges?: MergedCellInfo[]): HeaderDetectionResult {
  const scanLimit = Math.min(rawRows.length, 20)

  let bestScore = -1
  let bestIndex = 0
  let bestReason = 'defaulted to row 1'

  // Determine total column count from widest row
  const totalCols = rawRows.reduce((max, r) => Math.max(max, r.length), 0)

  for (let i = 0; i < scanLimit; i++) {
    const row = rawRows[i]!

    // Skip completely empty rows
    const nonEmptyCells = row.filter(c => c.trim() !== '')
    const nonEmptyCount = nonEmptyCells.length
    if (nonEmptyCount === 0) continue

    // Skip rows with only 1 non-empty cell (likely a title row)
    if (nonEmptyCount === 1) continue

    // Skip rows with a merged cell spanning >50% of columns
    if (mergedRanges && totalCols > 0) {
      const rowMerges = mergedRanges.filter(m => m.row === i)
      const hasBigMerge = rowMerges.some(m => (m.endCol - m.startCol + 1) > totalCols * 0.5)
      if (hasBigMerge) continue
    }

    // Count "short distinct text" cells
    const textCount = row.filter(c => isShortDistinctText(c)).length

    // Must have at least 3 text cells and at least 50% text
    if (textCount < 3 || textCount < nonEmptyCount * 0.5) continue

    // Score the row
    const uniqueNonEmpty = new Set(nonEmptyCells.map(c => c.trim().toLowerCase()))
    const distinctRatio = uniqueNonEmpty.size / nonEmptyCount
    const textRatio = textCount / nonEmptyCount

    // Check next row for data-like content (mix of types)
    let nextRowDataScore = 0
    if (i + 1 < rawRows.length) {
      const nextRow = rawRows[i + 1]!
      const nextNonEmpty = nextRow.filter(c => c.trim() !== '')
      if (nextNonEmpty.length > 0) {
        let hasText = false, hasNumeric = false, hasDate = false
        for (const cell of nextNonEmpty) {
          const v = cell.trim()
          if (/^\d+\.?\d*$/.test(v)) hasNumeric = true
          else if (looksLikeDate(v)) hasDate = true
          else if (v) hasText = true
        }
        const typeCount = (hasText ? 1 : 0) + (hasNumeric ? 1 : 0) + (hasDate ? 1 : 0)
        nextRowDataScore = typeCount >= 2 ? 1.0 : typeCount === 1 ? 0.5 : 0
      }
    }

    const score = textRatio * 0.4 + distinctRatio * 0.3 + nextRowDataScore * 0.3

    if (score > bestScore) {
      bestScore = score
      bestIndex = i
      bestReason = `row ${i + 1}: ${textCount} text headers, score ${score.toFixed(2)}`
    }
  }

  const confidence: HeaderDetectionResult['confidence'] =
    bestScore >= 0.8 ? 'high' : bestScore >= 0.5 ? 'medium' : 'low'

  return { headerRowIndex: bestIndex, confidence, reason: bestReason }
}

/** Normalize a phone number to (xxx) xxx-xxxx format */
function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, '')
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  if (digits.length === 11 && digits[0] === '1') {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }
  return value
}

export { parseDate }

/**
 * Normalize a date to YYYY-MM-DD. Handles Excel serials, ISO dates (with or
 * without a time), M/D/Y with slashes, dashes or dots (2- or 4-digit years),
 * and written months ("Feb 19, 2026", "19 Feb 2026", "19-Feb-26").
 * `order` decides ambiguous numeric dates; a day over 12 settles it per value.
 * Anything unrecognized is returned unchanged.
 */
export function normalizeDate(value: string, order: 'mdy' | 'dmy' = 'mdy'): string {
  return parseDate(value, order, { allowSerial: true }) ?? value
}


// Day-first or month-first for a whole column: shared with changing a column's type (F-027)
export { detectDateOrder, analyzeDateOrder, type DateOrderAnalysis } from '../shared/parseDate'

/** What to tell the person when a column's date order was a guess or a vote (F-026); null when it was clear */
export function dateOrderWarning(column: string, a: DateOrderAnalysis): string | null {
  const how = a.order === 'dmy' ? 'day first' : 'month first'
  const other = a.order === 'dmy' ? 'month first' : 'day first'
  if (a.ambiguous === 0) return null
  const n = `${a.ambiguous} date${a.ambiguous === 1 ? '' : 's'}`
  const were = a.ambiguous === 1 ? 'was' : 'were'
  // Dates only one order can read are read that way; the either-way ones follow the majority
  if (a.dayFirst > 0 && a.monthFirst > 0) {
    return `"${column}" has dates written both day first (like ${a.examples.dayFirst}) and month first (like ${a.examples.monthFirst}). ${n} that could be read either way (like ${a.examples.ambiguous}) ${were} read ${how}. Check ${a.ambiguous === 1 ? 'it' : 'them'} in the list.`
  }
  if (a.settledBy === 'fallback') {
    return `${n} in "${column}" (like ${a.examples.ambiguous}) could be read either way and ${were} read ${how}, as Settings → Appearance → Date Format says. If your dates are written ${other}, change Date Format and import again.`
  }
  return null
}

/** Column types that store a calendar date (a deadline column stores the date last done) */
function holdsDate(type: string): boolean {
  return type === 'date' || type === 'deadline'
}

/** Settings → Date format decides dates like 03/04/2026 that a column doesn't settle itself */
function preferredDateOrder(): 'mdy' | 'dmy' {
  try {
    const v = (getDb().prepare("SELECT value FROM settings WHERE key = 'date_format'").get() as { value: string } | undefined)?.value
    return v === 'eu' ? 'dmy' : 'mdy'
  } catch { return 'mdy' }
}

const LAST_FIRST_RE = /^([A-Za-z][A-Za-z'’ .-]*),\s*([A-Za-z][A-Za-z'’ .-]*)$/

/** "Smith, Jane" → "Jane Smith"; anything else unchanged. */
export function flipLastFirst(value: string): string {
  const m = value.trim().match(LAST_FIRST_RE)
  return m ? `${m[2]!.trim()} ${m[1]!.trim()}` : value
}

function looksLastFirst(samples: string[]): boolean {
  const vals = samples.filter(s => s.trim() !== '')
  return vals.length > 0 && vals.filter(s => LAST_FIRST_RE.test(s.trim())).length / vals.length >= 0.6
}

/**
 * Turn raw rows into headers + data:
 * - a merged group cell above the header row ("Annual Review" over "Due" and
 *   "Done") is prefixed to the headers it spans;
 * - merged cells in the data are copied into every cell they cover, so a
 *   "Program" merged down ten rows applies to all ten clients;
 * - blank headers become "Column N" and repeated ones get a number.
 */
export function buildTable(rawRows: string[][], headerIdx: number, mergedRanges?: MergedCellInfo[], hiddenRawRows?: ReadonlySet<number>): { headers: string[]; allRows: string[][]; hiddenRows: boolean[]; rowNumbers: number[] } {
  const rows = rawRows.map(r => [...r])
  for (const m of mergedRanges ?? []) {
    if (m.row <= headerIdx) continue
    const value = rawRows[m.anchorRow]?.[m.startCol] ?? ''
    if (!value) continue
    for (let c = m.startCol; c <= m.endCol; c++) {
      if (rows[m.row] && !rows[m.row]![c]?.trim()) rows[m.row]![c] = value
    }
  }

  const width = rows.reduce((max, r) => Math.max(max, r.length), 0)
  const headerRow = rows[headerIdx] ?? []
  const groupRow = headerIdx > 0 ? rows[headerIdx - 1] : undefined
  const groupFor = (c: number): string => {
    if (!groupRow || !mergedRanges) return ''
    const m = mergedRanges.find(x => x.row === headerIdx - 1 && x.startCol <= c && c <= x.endCol && x.endCol > x.startCol)
    // Wide merges are titles, not groups
    if (!m || (m.endCol - m.startCol + 1) > width * 0.5) return ''
    return (rawRows[m.anchorRow]?.[m.startCol] ?? '').trim()
  }
  // A repeated header gets " 2", " 3"…, skipping any name already taken, so
  // ["Name", "Name", "Name 2"] can't give two "Name 2" columns (Q-080)
  const used = new Set<string>()
  const headers = Array.from({ length: Math.max(width, headerRow.length) }, (_, c) => {
    const sub = (headerRow[c] ?? '').trim()
    const group = groupFor(c)
    let h = group && sub && !sub.toLowerCase().includes(group.toLowerCase()) ? `${group} ${sub}` : (sub || group)
    if (!h) h = `Column ${c + 1}`
    let name = h
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${h} ${n}`
    used.add(name.toLowerCase())
    return name
  })
  // Trailing columns with no header and no data are just sheet width
  let keep = headers.length
  while (keep > 0 && !(headerRow[keep - 1] ?? '').trim() && !groupFor(keep - 1) && rows.slice(headerIdx + 1).every(r => !(r[keep - 1] ?? '').trim())) keep--
  const kept = rows.map((row, i) => ({ row, i })).slice(headerIdx + 1).filter(({ row }) => row.some(c => c.trim() !== ''))
  return {
    headers: headers.slice(0, keep),
    allRows: kept.map(k => k.row),
    // Parallel to allRows: which rows the spreadsheet hides
    hiddenRows: kept.map(k => hiddenRawRows?.has(k.i) ?? false),
    // Parallel to allRows: each row's line in the file, for messages (Q-041)
    rowNumbers: kept.map(k => k.i + 1),
  }
}

/** Normalize a checkbox value to 'true' or 'false' (matching the app's internal format) */
function normalizeCheckbox(value: string): string {
  return CHECKBOX_TRUE.has(value.toLowerCase().trim()) ? 'true' : 'false'
}

/** A checkbox value that is neither clearly ticked nor clearly unticked */
function unclearCheckbox(value: string): boolean {
  const v = value.toLowerCase().trim()
  return v !== '' && !CHECKBOX_TRUE.has(v) && !CHECKBOX_FALSE.has(v)
}

/**
 * A money amount as a plain number: currency signs and spaces dropped,
 * accounting negatives "(50.00)" made negative, and a European "1.234,56"
 * read with a decimal comma. Anything else is left as typed.
 */
function normalizeCurrency(value: string): string {
  let v = value.replace(/[$€£¥\s]/g, '')
  let negative = false
  const paren = /^\((.*)\)$/.exec(v)
  if (paren) { negative = true; v = paren[1]! }
  if (/^-?\d{1,3}(\.\d{3})*,\d{1,2}$/.test(v) || (/^-?\d+,\d{1,2}$/.test(v) && !v.includes('.'))) {
    v = v.replace(/\./g, '').replace(',', '.')
  } else {
    v = v.replace(/,/g, '')
  }
  if (negative && !v.startsWith('-')) v = `-${v}`
  return v
}

/** Normalize a cell value based on detected type */
function normalizeValue(value: string, type: string, cleanData: boolean, dateOrder: 'mdy' | 'dmy' = 'mdy'): string {
  let v = cleanData ? value.trim() : value
  if (!v) return ''
  switch (type) {
    case 'phone': return cleanData ? normalizePhone(v) : v
    // Date columns always store YYYY-MM-DD; other text would sort and alert wrongly
    case 'date':
    case 'deadline': return normalizeDate(v, dateOrder)
    case 'checkbox': return normalizeCheckbox(v)
    case 'currency': return normalizeCurrency(v)
    default: return v
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Parse file and return preview
// ──────────────────────────────────────────────────────────────────────────────

/** Maximum import file size: 100 MB */
const MAX_IMPORT_FILE_SIZE = 100 * 1024 * 1024

/** Maximum cell value length stored in the database */
const MAX_CELL_VALUE_LENGTH = 10_000

/** The first `max` UTF-16 units, without splitting an emoji or other surrogate pair in half (Q-081) */
export function cutToLength(text: string, max: number): string {
  if (text.length <= max) return text
  const last = text.charCodeAt(max - 1)
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? max - 1 : max)
}

/** Maximum number of data rows to import (excludes header) */
const MAX_IMPORT_ROWS = 50_000
/** Raw rows read from a file: the data rows plus room for titles above the headers */
const MAX_RAW_ROWS = MAX_IMPORT_ROWS + 20
/**
 * Files read as delimited text. Papa finds the delimiter, so .tsv and Excel's
 * "Unicode Text" (.txt: tab-separated UTF-16 with a byte order mark) read like a CSV (Q-081)
 */
const TEXT_IMPORT_EXTENSIONS = new Set(['csv', 'tsv', 'txt'])
/** An .xlsx is a zip; more than this unpacked is refused before reading (Q-043) */
const MAX_XLSX_UNPACKED_BYTES = 500 * 1024 * 1024

function rowCapWarning(): string {
  return `This file has more than ${MAX_IMPORT_ROWS.toLocaleString('en-US')} rows. Pulse brings in up to ${MAX_IMPORT_ROWS.toLocaleString('en-US')} at a time, so rows after row ${MAX_RAW_ROWS.toLocaleString('en-US')} weren't read. Split the file and import the rest separately.`
}

/**
 * A CSV file's bytes as text. A byte order mark settles it (UTF-8 or UTF-16);
 * otherwise bytes that are valid UTF-8 are UTF-8, and anything else is
 * Windows-1252, which is what Excel's "CSV (Comma delimited)" writes.
 */
export function decodeCsvBytes(buf: Uint8Array): { text: string; encoding: 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252' } {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(buf.subarray(3)), encoding: 'utf-8' }
  }
  if (buf[0] === 0xff && buf[1] === 0xfe) return { text: new TextDecoder('utf-16le', { ignoreBOM: true }).decode(buf.subarray(2)), encoding: 'utf-16le' }
  if (buf[0] === 0xfe && buf[1] === 0xff) return { text: new TextDecoder('utf-16be', { ignoreBOM: true }).decode(buf.subarray(2)), encoding: 'utf-16be' }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), encoding: 'utf-8' }
  } catch {
    return { text: decodeWindows1252(buf), encoding: 'windows-1252' }
  }
}

/** Windows-1252 bytes 0x80–0x9F (curly quotes, dashes, €…); 0 = unused byte */
const CP1252_HIGH = [
  0x20ac, 0, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0, 0x017d, 0,
  0, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0, 0x017e, 0x0178,
]

/**
 * Decoded by hand: some Node builds treat TextDecoder('windows-1252') as
 * Latin-1, which turns Excel's curly quotes into invisible control characters.
 */
function decodeWindows1252(buf: Uint8Array): string {
  let out = ''
  for (let i = 0; i < buf.length; i += 8192) {
    const codes = Array.from(buf.subarray(i, i + 8192), b => (b >= 0x80 && b <= 0x9f ? CP1252_HIGH[b - 0x80] || b : b))
    out += String.fromCharCode(...codes)
  }
  return out
}

/** Thrown with a message written for the person importing */
export class ImportFileError extends Error {}

/**
 * Parse CSV text into raw rows (empty lines kept, so row indices stay stable
 * for header detection). A quote that isn't closed properly would swallow the
 * rest of the file into one cell, so it stops with the line to fix instead.
 */
function parseCsvText(text: string, delimiter?: string): { rows: string[][]; truncated: boolean } {
  const rows: string[][] = []
  let truncated = false
  let rowStart = 0
  let badQuoteAt: number | null = null
  Papa.parse<string[]>(text, {
    delimiter,
    skipEmptyLines: false,
    header: false,
    step: (result, parser) => {
      if (result.errors.some(e => e.type === 'Quotes')) {
        badQuoteAt = rowStart
        parser.abort()
        return
      }
      if (rows.length >= MAX_RAW_ROWS) {
        if (result.data.some(c => c.trim() !== '')) {
          truncated = true
          parser.abort()
        }
        return
      }
      // Undo the export's formula guard ('=1+1 back to =1+1) so Pulse files round-trip (AUDIT-037)
      rows.push(result.data.map(unguardCsvFormula))
      rowStart = result.meta.cursor
    },
  })
  if (badQuoteAt !== null) {
    const line = text.slice(0, badQuoteAt).split('\n').length
    throw new ImportFileError(`Line ${line} of the file has a quote mark (") that isn't closed properly, so Pulse can't tell where that line ends. Open the file, fix the quote marks on that line (or save it again from Excel), then try again.`)
  }
  return { rows, truncated }
}

// Cache parsed file data between preview and execute to avoid re-parsing
/** `sheet` is the sheet the rows came from, so going back and choosing another sheet re-reads it */
let _parsedCache: { filePath: string; mtime: number; sheet: string; rawRows: string[][]; sheets: string[]; mergedRanges?: MergedCellInfo[]; warnings: string[]; hiddenRawRows: Set<number>; hiddenCols: number[] } | null = null
let _parsedCacheTimer: ReturnType<typeof setTimeout> | null = null
let _importInProgress = false // prevents concurrent executeImport calls
const IMPORT_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes
const MAX_CACHE_ROWS = 10_000 // Don't cache parsed data exceeding this row count

/**
 * ExcelJS hands a date cell over as UTC midnight of that calendar day, so the
 * day is read with UTC getters. Local getters put it a day early west of UTC.
 */
function excelDateToYmd(d: Date): string {
  if (isNaN(d.getTime())) return ''
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/** Cells an Excel read couldn't turn into a value, for the preview's warnings */
interface ExcelReadNotes { errors: number; noResult: number }

/** "9:30 AM" or "14:05", following the cell's format */
function excelTime(d: Date, numFmt: string): string {
  const h = d.getUTCHours(), m = String(d.getUTCMinutes()).padStart(2, '0')
  if (/AM\/PM|A\/P/i.test(numFmt)) return `${h % 12 || 12}:${m} ${h < 12 ? 'AM' : 'PM'}`
  return `${String(h).padStart(2, '0')}:${m}`
}

/** A number as the sheet shows it where that matters: zip codes with leading zeros, percents */
function excelNumber(n: number, numFmt: string): string {
  const fmt = numFmt.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '').split(';')[0] ?? ''
  if (/^0+$/.test(fmt) && Number.isInteger(n) && n >= 0) return String(n).padStart(fmt.length, '0')
  if (/%$/.test(fmt)) {
    const decimals = (/\.(0+)%$/.exec(fmt)?.[1] ?? '').length
    return `${Number((n * 100).toFixed(decimals))}%`
  }
  return String(n)
}

/** Convert an ExcelJS cell value to a plain string */
function excelValueToString(v: ExcelJS.CellValue | undefined, numFmt: string, notes: ExcelReadNotes, date1904 = false): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number') return excelNumber(v, numFmt)
  if (typeof v === 'boolean') return String(v)
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return ''
    // A time with no date sits on Excel's day zero: 1899-12-30, or 1904-01-01 in a
    // workbook using the 1904 date system (older Mac Excel, A21b-08)
    const dayZero = date1904
      ? v.getUTCFullYear() === 1904 && v.getUTCMonth() === 0 && v.getUTCDate() === 1
      : v.getUTCFullYear() === 1899 && v.getUTCMonth() === 11 && v.getUTCDate() >= 30
    if (dayZero) return excelTime(v, numFmt)
    return excelDateToYmd(v)
  }
  if (typeof v !== 'object') return ''
  if ('error' in v) { notes.errors++; return '' }
  // ExcelJS rich text: { richText: [{text: '...'}] }
  if ('richText' in v && Array.isArray(v.richText)) return v.richText.map(r => r.text).join('')
  // Formulas: the value Excel saved. =A2+90, =EDATE(...) and =TODAY() give a Date result
  if ('formula' in v || 'sharedFormula' in v || 'result' in v) {
    const result = (v as { result?: ExcelJS.CellValue }).result
    if (result === undefined || result === null) { notes.noResult++; return '' }
    return excelValueToString(result, numFmt, notes, date1904)
  }
  // Hyperlinks: the text shown, which may itself be rich text
  if ('hyperlink' in v && 'text' in v) return excelValueToString((v as { text: ExcelJS.CellValue }).text, numFmt, notes, date1904)
  return ''
}

function excelReadWarnings(notes: ExcelReadNotes): string[] {
  const out: string[] = []
  const e = notes.errors, f = notes.noResult
  if (e > 0) out.push(`${e} cell${e === 1 ? '' : 's'} showed a spreadsheet error (like #N/A) and came in blank.`)
  if (f > 0) out.push(`${f} formula${f === 1 ? '' : 's'} had no saved value and came in blank. Open the file in Excel, save it, then import it again.`)
  return out
}

interface ParseResult {
  headers: string[]
  allRows: string[][]
  sheets: string[]
  rawRows: string[][]
  detectedHeaderRow: number
  headerDetectionConfidence: HeaderDetectionResult['confidence']
  mergedRanges?: MergedCellInfo[]
  warnings: string[]
  /** Parallel to allRows: hidden in the spreadsheet */
  hiddenRows: boolean[]
  /** Parallel to allRows: the row's line in the file (1-based) */
  rowNumbers: number[]
  /** 0-based indexes of hidden columns */
  hiddenCols: number[]
}

async function getCachedOrParse(filePath: string, sheetName?: string, headerRowIndex?: number): Promise<ParseResult> {
  const mtime = statSync(filePath).mtimeMs

  // Derive from cache if available
  const cacheHit = !!_parsedCache && _parsedCache.filePath === filePath && _parsedCache.mtime === mtime
    && (sheetName ? _parsedCache.sheet === sheetName : _parsedCache.sheet === (_parsedCache.sheets[0] ?? ''))
  if (!_importInProgress && _parsedCache && cacheHit) {
    const rawRows = _parsedCache.rawRows
    const mergedRanges = _parsedCache.mergedRanges
    const clampedIdx = headerRowIndex != null ? Math.min(headerRowIndex, Math.max(rawRows.length - 2, 0)) : undefined
    const detection = clampedIdx != null
      ? { headerRowIndex: clampedIdx, confidence: 'high' as const, reason: 'user override' }
      : detectHeaderRow(rawRows, mergedRanges)
    const { headers, allRows, hiddenRows, rowNumbers } = buildTable(rawRows, detection.headerRowIndex, mergedRanges, _parsedCache.hiddenRawRows)
    return {
      headers, allRows, hiddenRows, rowNumbers, hiddenCols: _parsedCache.hiddenCols.filter(c => c < headers.length),
      sheets: _parsedCache.sheets, rawRows, mergedRanges, warnings: _parsedCache.warnings,
      detectedHeaderRow: detection.headerRowIndex, headerDetectionConfidence: detection.confidence,
    }
  }

  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  let rawRows: string[][] = []
  let sheets: string[] = []
  let parsedSheet = ''
  let mergedRanges: MergedCellInfo[] | undefined
  const parseWarnings: string[] = []
  const hiddenRawRows = new Set<number>()
  const hiddenCols: number[] = []

  if (TEXT_IMPORT_EXTENSIONS.has(ext)) {
    // The whole file is decoded before parsing: decoding read-stream chunks one by one
    // broke a character split across two chunks, and Excel's "CSV" isn't UTF-8
    const decoded = decodeCsvBytes(await readFile(filePath))
    if (decoded.encoding === 'windows-1252') {
      parseWarnings.push('This file wasn\'t saved in the usual text format, so Pulse converted it. Check that accented letters (like é or ñ) look right.')
    }
    // Papa's guess needs about two fields a line and otherwise falls back to commas, so a
    // two-column tab file would come in as one column: .tsv is tabs, and a .txt whose first
    // line has a tab is Excel's "Unicode Text"
    const firstLine = decoded.text.slice(0, decoded.text.search(/\r?\n|$/))
    const delimiter = ext === 'tsv' || (ext === 'txt' && firstLine.includes('\t')) ? '\t' : undefined
    const parsed = parseCsvText(decoded.text, delimiter)
    rawRows = parsed.rows
    if (parsed.truncated) parseWarnings.push(rowCapWarning())
    sheets = ['Sheet1']
    parsedSheet = 'Sheet1'
  } else {
    // M11: Reject Excel files over 50 MB to prevent excessive memory usage
    const fileSize = statSync(filePath).size
    if (fileSize > 50 * 1024 * 1024) {
      throw new Error(`Excel file is too large (${Math.round(fileSize / 1024 / 1024)} MB). Maximum size is 50 MB.`)
    }
    // exceljs unpacks the whole workbook into memory: the 50 MB above is the packed
    // size, so a small file that unpacks to gigabytes would crash Pulse (Q-043)
    const unpacked = await zipUncompressedSize(filePath)
    if (unpacked !== null && unpacked > MAX_XLSX_UNPACKED_BYTES) {
      throw new ImportFileError('This Excel file is too big to import: it unpacks to more than 500 MB. Save just the sheet you need as a CSV file (or split it into smaller files), then import that.')
    }
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(filePath)
    sheets = wb.worksheets.map(ws => ws.name)
    const targetSheetName = sheetName || sheets[0]
    const ws = wb.worksheets.find(s => s.name === targetSheetName) || wb.worksheets[0]
    parsedSheet = ws?.name ?? ''

    if (ws && ws.rowCount > 0) {
      mergedRanges = extractMergedRanges(ws)
      const colCount = ws.columnCount
      const maxRow = Math.min(ws.rowCount, MAX_RAW_ROWS)
      if (ws.rowCount > MAX_RAW_ROWS) parseWarnings.push(rowCapWarning())
      const notes: ExcelReadNotes = { errors: 0, noResult: 0 }
      const date1904 = wb.properties?.date1904 === true
      for (let c = 1; c <= colCount; c++) if (ws.getColumn(c).hidden) hiddenCols.push(c - 1)
      for (let r = 1; r <= maxRow; r++) {
        const row = ws.getRow(r)
        if (row.hidden) hiddenRawRows.add(r - 1)
        const rowData: string[] = []
        for (let c = 1; c <= colCount; c++) {
          const cell = row.getCell(c)
          rowData.push(unguardCsvFormula(excelValueToString(cell.value, cell.numFmt ?? '', notes, date1904)))
        }
        rawRows.push(rowData)
      }
      parseWarnings.push(...excelReadWarnings(notes))
    }
  }

  // Detect or use provided header row index
  const clampedIdx = headerRowIndex != null ? Math.min(headerRowIndex, Math.max(rawRows.length - 2, 0)) : undefined
  const detection = clampedIdx != null
    ? { headerRowIndex: clampedIdx, confidence: 'high' as const, reason: 'user override' }
    : detectHeaderRow(rawRows, mergedRanges)

  const { headers, allRows, hiddenRows, rowNumbers } = buildTable(rawRows, detection.headerRowIndex, mergedRanges, hiddenRawRows)

  // Only cache if row count is within the size limit to avoid unbounded memory use
  if (rawRows.length <= MAX_CACHE_ROWS) {
    _parsedCache = { filePath, mtime, sheet: parsedSheet, rawRows, sheets, mergedRanges, warnings: parseWarnings, hiddenRawRows, hiddenCols }
    resetImportCacheTTL()
  } else {
    clearImportCache()
  }

  return {
    headers, allRows, hiddenRows, rowNumbers, hiddenCols: hiddenCols.filter(c => c < headers.length),
    sheets, rawRows, mergedRanges, warnings: parseWarnings,
    detectedHeaderRow: detection.headerRowIndex, headerDetectionConfidence: detection.confidence,
  }
}

export function clearImportCache(): void {
  _parsedCache = null
  if (_parsedCacheTimer) {
    clearTimeout(_parsedCacheTimer)
    _parsedCacheTimer = null
  }
}

function resetImportCacheTTL(): void {
  if (_parsedCacheTimer) clearTimeout(_parsedCacheTimer)
  _parsedCacheTimer = setTimeout(() => clearImportCache(), IMPORT_CACHE_TTL_MS)
}

/**
 * `sheetNameOverride` picks the sheet by name (the import itself passes the
 * sheet the user chose, so types and name flipping come from that sheet).
 */
export async function parseImportFile(filePath: string, sheetIndex = 0, headerRowIndex?: number, sheetNameOverride?: string): Promise<ImportPreview> {
  const fileSize = statSync(filePath).size
  if (fileSize > MAX_IMPORT_FILE_SIZE) {
    throw new Error(`File is too large (${Math.round(fileSize / 1024 / 1024)} MB). Maximum size is 100 MB.`)
  }

  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''

  // ExcelJS reads only .xlsx; .xls and .ods failed with a raw zip error
  if (ext === 'xls' || ext === 'ods') {
    throw new Error('This is an older spreadsheet file. Open it in Excel (or LibreOffice) and choose Save As → Excel Workbook (.xlsx), then try again.')
  }
  if (!TEXT_IMPORT_EXTENSIONS.has(ext) && ext !== 'xlsx') {
    throw new Error(`Pulse can't read .${ext} files. Save it as a .csv or .xlsx file, then try again.`)
  }

  logger.info('import', 'Parsing import file', { format: ext })

  // For Excel with non-default sheet index, we need the sheet name
  const isText = TEXT_IMPORT_EXTENSIONS.has(ext)
  let sheetName: string | undefined = isText ? undefined : sheetNameOverride
  if (!isText && !sheetName && sheetIndex > 0) {
    // Pre-parse to get sheet names for selecting the target sheet
    const preParsed = await getCachedOrParse(filePath, undefined, headerRowIndex)
    sheetName = preParsed.sheets[sheetIndex] || preParsed.sheets[0]
  }

  const cached = await getCachedOrParse(filePath, sheetName, headerRowIndex)
  const headers = cached.headers
  const dataRows = cached.allRows
  const sheets = cached.sheets
  const rawRows = cached.rawRows
  if (sheetName) sheetIndex = Math.max(0, sheets.indexOf(sheetName))
  const hiddenInfo = {
    hiddenRowCount: cached.hiddenRows.filter(Boolean).length,
    hiddenColumns: cached.hiddenCols.map(c => headers[c] ?? `Column ${c + 1}`),
  }

  if (dataRows.length === 0) return {
    sheets, activeSheet: sheetIndex, headers, rows: [], detectedColumns: [],
    detectedHeaderRow: cached.detectedHeaderRow,
    headerDetectionConfidence: cached.headerDetectionConfidence,
    rawRowCount: rawRows.length,
    rawPreviewRows: rawRows.slice(0, Math.min(20, rawRows.length)),
    warnings: cached.warnings,
    ...hiddenInfo,
  }

  const previewRows = dataRows.slice(0, 20)

  const detectedColumns: DetectedColumn[] = headers.map((name, i) => {
    const samples = dataRows.slice(0, 20)
      .map(row => String(row[i] || '').trim())
      .filter(s => s !== '')
      .slice(0, 5)
    let type = detectColumnType(samples)

    // Header-name hint: if the column name strongly suggests a date, and at least some
    // non-empty/non-dash values parse as dates, override to 'date'
    const nameLower = name.toLowerCase()
    const dateKeywords = ['date', 'due', 'dob', 'birth', 'expir', 'review', 'deadline', 'assessment', 'contact due',
      'plan of care', 'last contact', 'start date', 'end date', 'created', 'updated', 'scheduled']
    const looksLikeDateCol = dateKeywords.some(kw => nameLower.includes(kw))
    if (looksLikeDateCol) {
      const meaningful = samples.filter(s => s !== '—' && s !== '-' && s !== 'N/A' && s !== '')
      if (type === 'text' && meaningful.length > 0 && meaningful.some(s => looksLikeDate(s, true))) {
        type = 'date'
      }
      // A date column saved as plain Excel serials (46096) reads as numbers. Only a header
      // that says "date" or "birth" counts here, so "Amount due" stays a number.
      if ((type === 'number' || type === 'currency') && (nameLower.includes('date') || looksLikeBirthColumn(name))
        && meaningful.length > 0 && meaningful.every(looksLikeDateSerial)) {
        type = 'date'
      }
    }

    // Zip codes and ID numbers are labels, not quantities
    if (type === 'number' && /\b(zip|postal|id|ssn|mrn|medicaid)\b|#/i.test(name) && samples.every(v => /^\d+$/.test(v))) {
      type = 'text'
    }

    const nameSamples = dataRows.slice(0, 50).map(row => String(row[i] || '').trim()).filter(Boolean)
    return {
      index: i,
      originalName: name,
      detectedType: type,
      samples,
      ...(type === 'text' && looksLastFirst(nameSamples) ? { lastFirstNames: true } : {}),
    }
  })

  return {
    sheets,
    activeSheet: sheetIndex,
    headers,
    rows: previewRows.map(row => headers.map((_, i) => String(row[i] || ''))),
    detectedColumns,
    detectedHeaderRow: cached.detectedHeaderRow,
    headerDetectionConfidence: cached.headerDetectionConfidence,
    rawRowCount: rawRows.length,
    rawPreviewRows: rawRows.slice(0, Math.min(20, rawRows.length)),
    warnings: cached.warnings,
    ...hiddenInfo,
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Auto-match source columns to existing grid columns by name
// ──────────────────────────────────────────────────────────────────────────────

export function autoMatchColumns(gridId: number, headers: string[]): ColumnMapping[] {
  const db = getDb()
  const existingCols = (db.prepare('SELECT * FROM columns WHERE grid_id = ? ORDER BY position').all(gridId) as Column[])
    .filter(c => canImportInto(c.column_type))
  const usedColIds = new Set<number>()
  // Export All's "<deadline> (last done)" holds the stored date: it goes into the deadline
  // column, and the "<deadline>" column next to it (the "Due …" text) is left out (P-002)
  const lastDoneFor = (header: string): Column | undefined => {
    const h = header.toLowerCase().trim()
    if (!h.endsWith(LAST_DONE_SUFFIX.trim())) return undefined
    const base = h.slice(0, -LAST_DONE_SUFFIX.trim().length).trim()
    return existingCols.find(c => c.column_type === 'deadline' && c.name.toLowerCase().trim() === base)
  }
  const restored = new Set(headers.map(lastDoneFor).filter((c): c is Column => !!c).map(c => c.name.toLowerCase().trim()))

  const result = headers.map((header, i) => {
    const h = header.toLowerCase().trim()

    const lastDone = lastDoneFor(header)
    if (lastDone && !usedColIds.has(lastDone.id)) {
      usedColIds.add(lastDone.id)
      return { sourceIndex: i, action: lastDone.id as number }
    }
    if (restored.has(h)) return { sourceIndex: i, action: 'skip' as const }

    // 1. Exact match
    let match = existingCols.find(c => !usedColIds.has(c.id) && c.name.toLowerCase().trim() === h)

    // 2. Fuzzy: match if the existing column's name column flag aligns with a name-like header
    if (!match) {
      const isNameHeader = /^(client\s+name|full\s*name|name|student\s+name|participant\s+name|member\s+name|resident\s+name)$/i.test(header.trim())
      if (isNameHeader) {
        match = existingCols.find(c => !usedColIds.has(c.id) && c.is_name_column === 1)
      }
    }

    // 3. Fuzzy: header contains or is contained by an existing column name
    if (!match) {
      match = existingCols.find(c => {
        if (usedColIds.has(c.id)) return false
        const cn = c.name.toLowerCase().trim()
        return (h.includes(cn) || cn.includes(h)) && cn.length > 1 && h.length > 1
      })
    }

    if (match) {
      usedColIds.add(match.id)
      return { sourceIndex: i, action: match.id as number }
    }

    // Skip columns with no meaningful header (e.g. Excel row-number columns)
    if (!header.trim()) {
      return { sourceIndex: i, action: 'skip' as const }
    }

    // Don't set newType here — let the renderer use the preview's detectedType
    return { sourceIndex: i, action: 'create' as const, newName: header }
  })

  // Fallback: if the grid's name column was never matched by any import header, auto-assign
  // it to the first unmapped column. This prevents an empty "Name" column from appearing to
  // the left of all imported data when none of the file's headers look like a name column.
  const nameCol = existingCols.find(c => c.is_name_column === 1)
  if (nameCol && !usedColIds.has(nameCol.id)) {
    const firstCreate = result.findIndex(m => m.action === 'create')
    if (firstCreate !== -1) {
      result[firstCreate] = { sourceIndex: firstCreate, action: nameCol.id }
    }
  }

  return result
}

// ──────────────────────────────────────────────────────────────────────────────
// Execute the import
// ──────────────────────────────────────────────────────────────────────────────

const IMPORT_CHUNK_SIZE = 50

export async function executeImport(options: ImportOptions, preview: ImportPreview, onProgress?: (imported: number, total: number) => void): Promise<ImportResult> {
  const { gridId, filePath, sheetName, columnMappings, duplicateStrategy, duplicateColumnId, cleanData } = options
  const warnings: string[] = []
  /** The file line being saved, to name it if saving fails */
  let currentRow: number | null = null
  let began = false

  // Prevent concurrent imports — the cache and DB state are not safe for parallel access
  if (_importInProgress) throw new Error('An import is already in progress')
  _importInProgress = true
  const importStart = Date.now()
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  logger.info('import', 'Starting import', { format: ext, rowCount: preview.rows.length })
  try {
    const cached = await getCachedOrParse(filePath, sheetName, options.headerRowIndex)
    warnings.push(...cached.warnings)
    // Fetched after reading the file: Pulse may have locked meanwhile
    const db = getDb()
    // One transaction for the whole import (columns, rows, names, numbers): a failure
    // anywhere rolls all of it back. Nested db.transaction() calls become savepoints.
    db.exec('BEGIN')
    began = true
  const headers = cached.headers
  const allRows = options.skipHiddenRows ? cached.allRows.filter((_, i) => !cached.hiddenRows[i]) : cached.allRows
  const rowNumbers = options.skipHiddenRows ? cached.rowNumbers.filter((_, i) => !cached.hiddenRows[i]) : cached.rowNumbers
  /** The row's line in the file, as the person sees it in their spreadsheet */
  const lineOf = (i: number): number => rowNumbers[i] ?? i + 2
  const leftOutHidden = cached.allRows.length - allRows.length
  if (leftOutHidden > 0) warnings.push(`Left out ${leftOutHidden} row${leftOutHidden === 1 ? '' : 's'} hidden in the spreadsheet, as you chose.`)

  // Build column map: sourceIndex → {columnId, type}
  // Create new columns as needed
  const colMap = new Map<number, { columnId: number; type: string }>()

  // Get max existing column position
  const maxPosRow = db.prepare('SELECT MAX(position) as p FROM columns WHERE grid_id = ?').get(gridId) as { p: number | null }
  let nextPos = (maxPosRow.p ?? -1) + 1

  // --- Column creation + name column reassignment (small, fast — single transaction) ---
  const setupColumns = () => {
    for (const mapping of columnMappings) {
      if (mapping.action === 'skip') continue
      if (mapping.action === 'create') {
        const detected = preview.detectedColumns[mapping.sourceIndex]
        const colType = mapping.newType || detected?.detectedType || 'text'
        if (!isValidColumnType(colType) || colType === 'link') {
          throw new Error(`Invalid column type: ${colType}`)
        }
        const colName = mapping.newName || headers[mapping.sourceIndex] || `Column ${mapping.sourceIndex + 1}`
        const result = db.prepare(`
          INSERT INTO columns (grid_id, name, column_type, position, created_at)
          VALUES (?, ?, ?, ?, datetime('now'))
        `).run(gridId, colName, colType, nextPos++)
        colMap.set(mapping.sourceIndex, { columnId: result.lastInsertRowid as number, type: colType })
      } else {
        // Existing column. One Pulse works out itself can't take imported values.
        const col = db.prepare('SELECT column_type FROM columns WHERE id = ?').get(mapping.action as number) as { column_type: string } | undefined
        if (col && !canImportInto(col.column_type)) continue
        colMap.set(mapping.sourceIndex, { columnId: mapping.action as number, type: col?.column_type || 'text' })
      }
    }

    // --- Column reassignment safety net ---
    // If the name column was never consumed by any mapping (user overrode the
    // auto-suggestion) and the grid has no rows yet (truly fresh), delete the orphaned empty
    // Name column and promote the first imported column to is_name_column = 1.
    let nameColIdInner = (db.prepare('SELECT id FROM columns WHERE grid_id = ? AND is_name_column = 1 LIMIT 1').get(gridId) as { id: number } | undefined)?.id
    if (nameColIdInner) {
      const nameColMapped = [...colMap.values()].some(info => info.columnId === nameColIdInner)
      if (!nameColMapped) {
        const nameColCellCount = (db.prepare('SELECT COUNT(*) as c FROM cells WHERE column_id = ?').get(nameColIdInner) as { c: number }).c
        const gridRowCount = (db.prepare('SELECT COUNT(*) as c FROM rows WHERE grid_id = ?').get(gridId) as { c: number }).c
        if (nameColCellCount === 0 && gridRowCount === 0) {
          db.prepare('DELETE FROM columns WHERE id = ?').run(nameColIdInner)
          const firstEntry = [...colMap.entries()][0]
          if (firstEntry) {
            db.prepare('UPDATE columns SET is_name_column = 1 WHERE id = ?').run(firstEntry[1].columnId)
            nameColIdInner = firstEntry[1].columnId
          } else {
            nameColIdInner = undefined
          }
        }
      }
    }
    return nameColIdInner
  }

  const nameColId = setupColumns()

    // Find the name column mapping (source index for the name column in import)
    let nameSourceIndex: number | null = null
    for (const [srcIdx, info] of colMap.entries()) {
      if (info.columnId === nameColId) {
        nameSourceIndex = srcIdx
        break
      }
    }
    const sourceFor = (columnId: number | undefined): number | null => {
      if (columnId === undefined) return null
      for (const [srcIdx, info] of colMap.entries()) if (info.columnId === columnId) return srcIdx
      return null
    }

    // Birth-date columns: a two-digit year that would land in the future means the 1900s
    const birthCols = new Set<number>()
    for (const [srcIdx, info] of colMap.entries()) {
      if (info.type !== 'date') continue
      const target = db.prepare('SELECT name FROM columns WHERE id = ?').get(info.columnId) as { name: string } | undefined
      if (looksLikeBirthColumn(headers[srcIdx] ?? '') || looksLikeBirthColumn(target?.name ?? '')) birthCols.add(srcIdx)
    }

    // Duplicate detection. Keys are compared lower-cased and trimmed; rows in
    // Trash don't count, and each imported row joins the lookup so the same
    // person twice in one file is caught too.
    let dupKeys: Set<string> | null = null
    let dupKeyOf: ((row: string[]) => string | null) | null = null
    let dupLabelSrc: number | null = null
    if (duplicateStrategy !== 'none') {
      const existingCells = (columnId: number) => db.prepare(`
        SELECT r.id, c.value FROM rows r
        JOIN cells c ON c.row_id = r.id AND c.column_id = ?
        WHERE r.grid_id = ? AND ${LIVE_ROW}
      `).all(columnId, gridId) as Array<{ id: number; value: string }>
      const norm = (v: string) => v.toLowerCase().trim()

      let keyColId: number | undefined = duplicateStrategy === 'by_column' ? (duplicateColumnId ?? nameColId) : nameColId
      let keySrc = sourceFor(keyColId)
      if (keySrc === null && duplicateStrategy === 'by_column') {
        warnings.push('The column chosen for spotting duplicates wasn\'t imported, so duplicates were matched by name.')
        keyColId = nameColId
        keySrc = nameSourceIndex
      }

      let dobColId: number | undefined
      let dobSrc: number | null = null
      if (duplicateStrategy === 'name_and_dob') {
        for (const srcIdx of birthCols) { dobSrc = srcIdx; dobColId = colMap.get(srcIdx)!.columnId; break }
        if (dobSrc === null) {
          warnings.push('No date-of-birth column was imported, so duplicates were matched by name only.')
        }
      }

      if (keyColId && keySrc !== null) {
        dupKeys = new Set()
        const dobByRow = new Map<number, string>()
        if (dobColId) for (const c of existingCells(dobColId)) dobByRow.set(c.id, norm(c.value || ''))
        for (const c of existingCells(keyColId)) {
          dupKeys.add(dobColId ? `${norm(c.value || '')}|${dobByRow.get(c.id) ?? ''}` : norm(c.value || ''))
        }
        const src = keySrc
        dupLabelSrc = nameSourceIndex ?? keySrc
        // Compared as it will be stored ("555.123.4567" is kept as "(555) 123-4567",
        // "3/15/2026" as "2026-03-15"), since that's what the existing cells hold (Q-040)
        const stored = (row: string[], srcIdx: number): string => {
          const type = colMap.get(srcIdx)?.type
          const raw = cellValue(row, srcIdx)
          if (!type || !raw) return raw
          return holdsDate(type) ? importedDate(row, srcIdx) : normalizeValue(raw, type, cleanData, dateOrders.get(srcIdx))
        }
        dupKeyOf = (row) => {
          const name = norm(stored(row, src))
          if (!name) return null
          if (dobSrc === null) return name
          return `${name}|${norm(importedDate(row, dobSrc))}`
        }
      }
    }

    let imported = 0
    let skipped = 0
    const skippedNames: string[] = []

    // Day-first or month-first, decided per date column from all of its values
    const dateOrders = new Map<number, 'mdy' | 'dmy'>()
    const dateOrderWarnings: string[] = []
    const fallbackOrder = preferredDateOrder()
    for (const [srcIdx, info] of colMap.entries()) {
      if (!holdsDate(info.type)) continue
      const a = analyzeDateOrder(allRows.map(r => String(r[srcIdx] ?? '')), fallbackOrder)
      dateOrders.set(srcIdx, a.order)
      const w = dateOrderWarning(headers[srcIdx] ?? `Column ${srcIdx + 1}`, a)
      if (w) dateOrderWarnings.push(w)
    }
    const flipCols = new Set(options.flipLastFirst
      ? preview.detectedColumns.filter(c => c.lastFirstNames).map(c => c.index)
      : [])
    const unreadableDates = new Map<number, number>()
    const unclearChecks = new Map<number, number>()
    /** Cells cut to the length limit, per column: how many and the first file row (Q-081) */
    const cutCells = new Map<number, { n: number; firstRow: number }>()
    const cellValue = (row: string[], srcIdx: number): string => {
      const raw = String(row[srcIdx] || '').trim()
      return flipCols.has(srcIdx) ? flipLastFirst(raw) : raw
    }
    const birthAs1900s = new Map<number, number>()
    const today = localDateString()
    /** A date cell as stored: YYYY-MM-DD where readable, and a birthday never in the future */
    const importedDate = (row: string[], srcIdx: number, count = false): string => {
      const raw = cellValue(row, srcIdx)
      let v = normalizeValue(raw, 'date', cleanData, dateOrders.get(srcIdx))
      if (!birthCols.has(srcIdx) || !/^\d{4}-\d{2}-\d{2}$/.test(v) || !hasTwoDigitYear(raw)) return v
      if (v > today) {
        const earlier = ymdFromParts(Number(v.slice(0, 4)) - 100, Number(v.slice(5, 7)), Number(v.slice(8, 10)))
        if (earlier) v = earlier
      }
      if (count && v.startsWith('19')) birthAs1900s.set(srcIdx, (birthAs1900s.get(srcIdx) ?? 0) + 1)
      return v
    }

    // Link columns (W04): names are matched to the other list's records, exactly but ignoring case
    const linkCols = new Map<number, { typeId: number; direction: LinkDirection; single: boolean; otherGridId: number; label: string; byName: Map<string, number>; unmatched: Set<string> }>()
    for (const [srcIdx, info] of colMap.entries()) {
      if (info.type !== 'link') continue
      const cfg = linkColumnSpecs([{ id: info.columnId, column_type: 'link', config: (db.prepare('SELECT config FROM columns WHERE id = ?').get(info.columnId) as { config: string | null } | undefined)?.config ?? null }])[0]
      const type = cfg ? getLinkType(cfg.typeId) : undefined
      if (!cfg || !type) continue
      const otherGridId = otherGridOf(type, cfg.direction)
      const byName = new Map<string, number>()
      for (const r of db.prepare(`SELECT id, display_name FROM rows WHERE grid_id = ? AND ${notTrashedRow('')} AND COALESCE(display_name, '') != '' ORDER BY is_active DESC, id`).all(otherGridId) as Array<{ id: number; display_name: string }>) {
        const k = r.display_name.trim().toLowerCase()
        if (!byName.has(k)) byName.set(k, r.id)
      }
      linkCols.set(srcIdx, { typeId: type.id, direction: cfg.direction, single: holdsOne(type.cardinality, cfg.direction), otherGridId,
        label: cfg.direction === 'forward' ? type.label_forward : type.label_backward, byName, unmatched: new Set() })
    }
    const importLinks = (rowId: number, srcIdx: number, raw: string) => {
      const lc = linkCols.get(srcIdx)
      if (!lc) return
      // A side that holds many takes "Jane Smith; Bob Lee"
      const names = (lc.single ? [raw] : raw.split(';')).map(n => n.trim()).filter(Boolean)
      for (const name of names) {
        const key = name.toLowerCase()
        let target = lc.byName.get(key)
        if (target === undefined && options.createMissingLinks) {
          target = createLinkedRecord(lc.typeId, lc.direction, rowId, name, { quiet: true }).rowId
          lc.byName.set(key, target)
          continue
        }
        if (target === undefined) { lc.unmatched.add(name); continue }
        if (lc.direction === 'forward') addLink(lc.typeId, rowId, target, { quiet: true })
        else addLink(lc.typeId, target, rowId, { quiet: true })
      }
    }

    const newRowIds: number[] = []

    // Get current max row position
    const maxRowPos = (db.prepare('SELECT MAX(position) as p FROM rows WHERE grid_id = ?').get(gridId) as { p: number | null }).p ?? -1
    let nextRowPos = maxRowPos + 1

    // Hoist prepared statements outside the loop — the SQL never changes,
    // so re-preparing per row wastes ~20–100µs × (rows × columns) of compilation time.
    const insertRow = db.prepare(
      `INSERT INTO rows (grid_id, position, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))`
    )
    const insertCell = db.prepare(
      `INSERT OR REPLACE INTO cells (row_id, column_id, value, updated_at) VALUES (?, ?, ?, datetime('now'))`
    )

    // Every row goes in inside the one transaction around the whole import, so an import
    // that fails part-way leaves nothing behind. There's no await in here: a lock
    // (sleep, screen lock) waits until the import is done instead of closing the
    // database under it. Progress messages are still sent every 50 rows.
    for (let i = 0; i < allRows.length; i++) {
      currentRow = lineOf(i)
      if (onProgress && i > 0 && i % IMPORT_CHUNK_SIZE === 0) onProgress(imported, allRows.length)
      const importRow = allRows[i]!
      if (importRow.every(c => String(c).trim() === '')) continue // skip blank rows

      // Duplicate detection
      if (dupKeys && dupKeyOf) {
        const key = dupKeyOf(importRow)
        if (key !== null) {
          if (dupKeys.has(key)) {
            skippedNames.push(cellValue(importRow, dupLabelSrc ?? 0) || `Row ${lineOf(i)}`)
            skipped++
            continue
          }
          dupKeys.add(key)
        }
      }

      // Create row
      const rowResult = insertRow.run(gridId, nextRowPos++)
      const rowId = rowResult.lastInsertRowid as number
      newRowIds.push(rowId)

      // Insert cell values
      for (const [srcIdx, info] of colMap.entries()) {
        const rawVal = cellValue(importRow, srcIdx)
        if (!rawVal) continue
        if (info.type === 'link') { importLinks(rowId, srcIdx, rawVal); continue }

        // The destination column's type decides the format (an existing date
        // column gets YYYY-MM-DD even if the samples looked like text)
        const normalized = holdsDate(info.type)
          ? importedDate(importRow, srcIdx, true)
          : normalizeValue(rawVal, info.type, cleanData, dateOrders.get(srcIdx))
        if (holdsDate(info.type) && !/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
          unreadableDates.set(srcIdx, (unreadableDates.get(srcIdx) ?? 0) + 1)
        }
        if (info.type === 'checkbox' && unclearCheckbox(rawVal)) {
          unclearChecks.set(srcIdx, (unclearChecks.get(srcIdx) ?? 0) + 1)
        }

        if (normalized) {
          let cellValue = normalized
          if (cellValue.length > MAX_CELL_VALUE_LENGTH) {
            cellValue = cutToLength(cellValue, MAX_CELL_VALUE_LENGTH)
            const cut = cutCells.get(srcIdx)
            if (cut) cut.n++
            else cutCells.set(srcIdx, { n: 1, firstRow: lineOf(i) })
          }
          insertCell.run(rowId, info.columnId, cellValue)
        }
      }

      imported++
    }
    currentRow = null
    if (onProgress) onProgress(imported, allRows.length)

  // Backfill display_name for all rows in this grid — the SQLite trigger fires on cell
  // INSERT/UPDATE, but if is_name_column was reassigned during import setup, rows inserted
  // before the reassignment may have stale display_name values.
  // Combines first-name (is_name_column) + last-name column when both exist.
  if (nameColId) {
    const backfillDisplayName = db.transaction(() => {
      db.prepare(`
        UPDATE rows SET display_name = COALESCE(
          (SELECT
            CASE WHEN last_c.value IS NOT NULL AND TRIM(last_c.value) != ''
              THEN TRIM(COALESCE(fn_c.value, '')) || ' ' || TRIM(last_c.value)
              ELSE TRIM(fn_c.value)
            END
           FROM cells fn_c
           JOIN columns fn_col ON fn_col.id = fn_c.column_id
             AND fn_col.grid_id = ? AND fn_col.is_name_column = 1
           LEFT JOIN columns last_col ON last_col.grid_id = fn_col.grid_id
             AND last_col.id != fn_col.id AND last_col.is_visible = 1
             AND LOWER(TRIM(last_col.name)) IN ('last','last name','lastname','surname','family name','lname')
           LEFT JOIN cells last_c ON last_c.row_id = rows.id AND last_c.column_id = last_col.id
           WHERE fn_c.row_id = rows.id
           LIMIT 1),
          display_name
        )
        WHERE grid_id = ?
      `).run(gridId, gridId)
    })
    backfillDisplayName()
  }
  // Imported numbers are kept; numbering carries on after the highest, and rows without one get one
  db.transaction(() => {
    bumpAutoNumbersPastValues(gridId)
    assignAutoNumbers(gridId, newRowIds)
  })()
  if (hasDisplayFormat(gridId)) db.transaction(() => refreshDisplayNames(gridId))()
  db.exec('COMMIT')
  began = false

  warnings.push(...dateOrderWarnings)
  for (const [srcIdx, n] of birthAs1900s) {
    warnings.push(`${n} date${n === 1 ? '' : 's'} in "${headers[srcIdx] ?? `Column ${srcIdx + 1}`}" had a two-digit year and ${n === 1 ? 'was' : 'were'} read as 19xx. Check ${n === 1 ? 'it' : 'them'}.`)
  }
  for (const [srcIdx, n] of unreadableDates) {
    warnings.push(`${n} value${n === 1 ? '' : 's'} in "${headers[srcIdx] ?? `Column ${srcIdx + 1}`}" didn't look like ${n === 1 ? 'a date' : 'dates'} and ${n === 1 ? 'was' : 'were'} kept as typed. Check ${n === 1 ? 'it' : 'them'} in the list.`)
  }

  for (const [srcIdx, { n, firstRow }] of cutCells) {
    warnings.push(`${n} value${n === 1 ? '' : 's'} in "${headers[srcIdx] ?? `Column ${srcIdx + 1}`}" ${n === 1 ? 'was' : 'were'} longer than ${MAX_CELL_VALUE_LENGTH.toLocaleString('en-US')} characters and ${n === 1 ? 'was' : 'were'} cut short${n === 1 ? ` (row ${firstRow})` : `, starting at row ${firstRow}`}.`)
  }
  for (const [srcIdx, n] of unclearChecks) {
    warnings.push(`${n} value${n === 1 ? '' : 's'} in "${headers[srcIdx] ?? `Column ${srcIdx + 1}`}" ${n === 1 ? 'wasn\'t' : 'weren\'t'} clearly yes or no and ${n === 1 ? 'was' : 'were'} left unticked. Check ${n === 1 ? 'it' : 'them'} in the list.`)
  }
  for (const [srcIdx, lc] of linkCols) {
    if (lc.unmatched.size === 0) continue
    const names = [...lc.unmatched]
    const shown = names.slice(0, 5).map(n => `"${n}"`).join(', ') + (names.length > 5 ? `, and ${names.length - 5} more` : '')
    warnings.push(`${names.length} name${names.length === 1 ? '' : 's'} in "${headers[srcIdx] ?? lc.label}" didn't match anyone, so ${names.length === 1 ? 'it wasn\'t' : 'they weren\'t'} linked: ${shown}.`)
  }
  // Clear cache after import to free memory
  clearImportCache()

  logger.info('import', 'Import complete', { rowsImported: imported, skipped, warningCount: warnings.length, durationMs: Date.now() - importStart })
  return { imported, skipped, warnings, skippedNames, newRowIds }
  } catch (err) {
    logger.error('import', 'Import failed', { error: err instanceof Error ? err.message : String(err), row: currentRow === null ? undefined : currentRow })
    if (began) {
      try {
        const db = getDb()
        if (db.inTransaction) db.exec('ROLLBACK')
      } catch (rollbackErr) {
        logger.warn('import', 'Rollback after failed import', { error: rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr) })
      }
    }
    // The SQLite text is in the log; the person sees which row to check
    if (currentRow !== null) {
      throw new ImportFileError(`Nothing was imported, because row ${currentRow} couldn't be saved. Check that row in the file, then try again.`)
    }
    throw err
  } finally {
    _importInProgress = false
  }
}
