/**
 * import.ts — CSV and Excel (xlsx) import for the main process.
 * Steps: parse file → detect columns → map columns → import rows.
 *
 * Uses exceljs for Excel parsing (replaces xlsx/SheetJS which has unpatched CVEs).
 */

import { statSync, createReadStream } from 'fs'
import Papa from 'papaparse'
import { parseDate, toYmd } from '../shared/parseDate'
import { localDateString } from '../shared/dates'
import { VALID_COLUMN_TYPES } from '../shared/types'
import type { ColumnType } from '../shared/types'
import ExcelJS from 'exceljs'

import { getDb } from './database'
import { logger } from './logger'
import type { Column } from '../shared/types'
import { hasDisplayFormat, refreshDisplayNames } from './display-names'
import { assignAutoNumbers, bumpAutoNumbersPastValues } from './auto-number'
import { addLink, createLinkedRecord, getLinkType, otherGridOf } from './links'
import { holdsOne, linkColumnSpecs, type LinkDirection } from '../shared/links'

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

/** The value ends in a two-digit year ("3/15/30", "15-Mar-30") */
function hasTwoDigitYear(value: string): boolean {
  const v = value.trim()
  return !v.includes(':') && !/^\d{4}[-/.]/.test(v) && /(^|[^\d])\d{2}$/.test(v) && !/^\d+$/.test(v)
}

/** A column for birthdays, by its name */
export function looksLikeBirthColumn(name: string): boolean {
  return /\b(dob|d\.o\.b\.?|birth\w*|born)\b/i.test(name)
}

/** Guess column type from sample values */
function looksLikeDate(s: string): boolean {
  const v = s.trim()
  // Excel serial date (5-digit number in a plausible date range: 1900-2100)
  if (/^\d{5}$/.test(v)) {
    const n = parseInt(v, 10)
    return n >= 1 && n <= 73050 // 73050 ≈ year 2100
  }
  return parseDate(v) !== null
}

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

  // Currency: starts with $ or ends with common amount format
  const currencyRe = /^\$?[\d,]+(\.\d{2})?$/
  if (nonEmpty.every(s => currencyRe.test(s.trim().replace('$', '')))) return 'currency'

  // Number
  if (nonEmpty.every(s => !isNaN(parseFloat(s.trim())) && s.trim() !== '')) return 'number'

  // Checkbox: yes/no, true/false, 1/0
  const checkVals = new Set(['yes', 'no', 'true', 'false', '1', '0', 'x', ''])
  if (nonEmpty.every(s => checkVals.has(s.toLowerCase().trim()))) return 'checkbox'

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
  return parseDate(value, order) ?? value
}


/**
 * Day-first or month-first for a whole column: any value with a first number
 * over 12 means day-first (e.g. 25/03/2026). US order otherwise.
 */
export function detectDateOrder(values: string[]): 'mdy' | 'dmy' {
  let dayFirst = 0, monthFirst = 0
  for (const v of values) {
    const m = v.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-]\d{2,4}/)
    if (!m) continue
    if (Number(m[1]) > 12) dayFirst++
    else if (Number(m[2]) > 12) monthFirst++
  }
  return dayFirst > monthFirst ? 'dmy' : 'mdy'
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
export function buildTable(rawRows: string[][], headerIdx: number, mergedRanges?: MergedCellInfo[]): { headers: string[]; allRows: string[][] } {
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
  const seen = new Map<string, number>()
  const headers = Array.from({ length: Math.max(width, headerRow.length) }, (_, c) => {
    const sub = (headerRow[c] ?? '').trim()
    const group = groupFor(c)
    let h = group && sub && !sub.toLowerCase().includes(group.toLowerCase()) ? `${group} ${sub}` : (sub || group)
    if (!h) h = `Column ${c + 1}`
    const n = (seen.get(h.toLowerCase()) ?? 0) + 1
    seen.set(h.toLowerCase(), n)
    return n > 1 ? `${h} ${n}` : h
  })
  // Trailing columns with no header and no data are just sheet width
  let keep = headers.length
  while (keep > 0 && !(headerRow[keep - 1] ?? '').trim() && !groupFor(keep - 1) && rows.slice(headerIdx + 1).every(r => !(r[keep - 1] ?? '').trim())) keep--
  const allRows = rows.slice(headerIdx + 1).filter(row => row.some(c => c.trim() !== ''))
  return { headers: headers.slice(0, keep), allRows }
}

/** Normalize a checkbox value to 'true' or 'false' (matching the app's internal format) */
function normalizeCheckbox(value: string): string {
  const v = value.toLowerCase().trim()
  return ['yes', 'true', '1', 'x'].includes(v) ? 'true' : 'false'
}

/** Normalize a cell value based on detected type */
function normalizeValue(value: string, type: string, cleanData: boolean, dateOrder: 'mdy' | 'dmy' = 'mdy'): string {
  let v = cleanData ? value.trim() : value
  if (!v) return ''
  switch (type) {
    case 'phone': return cleanData ? normalizePhone(v) : v
    // Date columns always store YYYY-MM-DD; other text would sort and alert wrongly
    case 'date': return normalizeDate(v, dateOrder)
    case 'checkbox': return normalizeCheckbox(v)
    case 'currency': return v.replace(/[$,]/g, '')
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

/** Maximum number of data rows to import (excludes header) */
const MAX_IMPORT_ROWS = 50_000

// Cache parsed file data between preview and execute to avoid re-parsing
/** `sheet` is the sheet the rows came from, so going back and choosing another sheet re-reads it */
let _parsedCache: { filePath: string; mtime: number; sheet: string; rawRows: string[][]; sheets: string[]; mergedRanges?: MergedCellInfo[] } | null = null
let _parsedCacheTimer: ReturnType<typeof setTimeout> | null = null
let _importInProgress = false // prevents concurrent executeImport calls
const IMPORT_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes
const MAX_CACHE_ROWS = 10_000 // Don't cache parsed data exceeding this row count

/** Convert an ExcelJS cell value to a plain string */
function excelCellToString(cell: ExcelJS.Cell): string {
  const v = cell.value
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (v instanceof Date) {
    // Format as YYYY-MM-DD for date cells
    const y = v.getFullYear()
    const m = String(v.getMonth() + 1).padStart(2, '0')
    const d = String(v.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  // ExcelJS rich text: { richText: [{text: '...'}] }
  if (typeof v === 'object' && 'richText' in v && Array.isArray(v.richText)) {
    return v.richText.map((r: { text: string }) => r.text).join('')
  }
  // ExcelJS formula result
  if (typeof v === 'object' && 'result' in v) {
    return String((v as { result: unknown }).result ?? '')
  }
  // ExcelJS hyperlink
  if (typeof v === 'object' && 'hyperlink' in v && 'text' in v) {
    return String((v as { text: unknown }).text ?? '')
  }
  return String(v)
}

interface ParseResult {
  headers: string[]
  allRows: string[][]
  sheets: string[]
  rawRows: string[][]
  detectedHeaderRow: number
  headerDetectionConfidence: HeaderDetectionResult['confidence']
  mergedRanges?: MergedCellInfo[]
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
    const { headers, allRows } = buildTable(rawRows, detection.headerRowIndex, mergedRanges)
    return {
      headers, allRows, sheets: _parsedCache.sheets, rawRows, mergedRanges,
      detectedHeaderRow: detection.headerRowIndex, headerDetectionConfidence: detection.confidence,
    }
  }

  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  let rawRows: string[][] = []
  let sheets: string[] = []
  let parsedSheet = ''
  let mergedRanges: MergedCellInfo[] | undefined

  if (ext === 'csv') {
    // Stream-parse CSV — don't skip empty lines so row indices are stable for detection
    rawRows = await new Promise((resolve, reject) => {
      const rows: string[][] = []
      Papa.parse(createReadStream(filePath), {
        skipEmptyLines: false,
        header: false,
        step: (result: { data: string[] }, parser: { abort: () => void }) => {
          rows.push(result.data)
          if (rows.length > MAX_IMPORT_ROWS + 20) parser.abort()
        },
        complete: () => resolve(rows),
        error: (err: Error) => reject(err),
      })
    })
    sheets = ['Sheet1']
    parsedSheet = 'Sheet1'
  } else {
    // M11: Reject Excel files over 50 MB to prevent excessive memory usage
    const fileSize = statSync(filePath).size
    if (fileSize > 50 * 1024 * 1024) {
      throw new Error(`Excel file is too large (${Math.round(fileSize / 1024 / 1024)} MB). Maximum size is 50 MB.`)
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
      const maxRow = Math.min(ws.rowCount, MAX_IMPORT_ROWS + 20)
      for (let r = 1; r <= maxRow; r++) {
        const row = ws.getRow(r)
        const rowData: string[] = []
        for (let c = 1; c <= colCount; c++) {
          rowData.push(excelCellToString(row.getCell(c)))
        }
        rawRows.push(rowData)
      }
    }
  }

  // Detect or use provided header row index
  const clampedIdx = headerRowIndex != null ? Math.min(headerRowIndex, Math.max(rawRows.length - 2, 0)) : undefined
  const detection = clampedIdx != null
    ? { headerRowIndex: clampedIdx, confidence: 'high' as const, reason: 'user override' }
    : detectHeaderRow(rawRows, mergedRanges)

  const { headers, allRows } = buildTable(rawRows, detection.headerRowIndex, mergedRanges)

  // Only cache if row count is within the size limit to avoid unbounded memory use
  if (rawRows.length <= MAX_CACHE_ROWS) {
    _parsedCache = { filePath, mtime, sheet: parsedSheet, rawRows, sheets, mergedRanges }
    resetImportCacheTTL()
  } else {
    clearImportCache()
  }

  return {
    headers, allRows, sheets, rawRows, mergedRanges,
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
  const VALID_IMPORT_EXTENSIONS = new Set(['csv', 'xlsx'])
  if (!VALID_IMPORT_EXTENSIONS.has(ext)) {
    throw new Error(`Pulse can't read .${ext} files. Save it as a .csv or .xlsx file, then try again.`)
  }

  logger.info('import', 'Parsing import file', { format: ext })

  // For Excel with non-default sheet index, we need the sheet name
  let sheetName: string | undefined = ext === 'csv' ? undefined : sheetNameOverride
  if (ext !== 'csv' && !sheetName && sheetIndex > 0) {
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

  if (dataRows.length === 0) return {
    sheets, activeSheet: sheetIndex, headers, rows: [], detectedColumns: [],
    detectedHeaderRow: cached.detectedHeaderRow,
    headerDetectionConfidence: cached.headerDetectionConfidence,
    rawRowCount: rawRows.length,
    rawPreviewRows: rawRows.slice(0, Math.min(20, rawRows.length)),
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
    if (type === 'text') {
      const nameLower = name.toLowerCase()
      const dateKeywords = ['date', 'due', 'dob', 'birth', 'expir', 'review', 'deadline', 'assessment', 'contact due',
        'plan of care', 'last contact', 'start date', 'end date', 'created', 'updated', 'scheduled']
      const looksLikeDateCol = dateKeywords.some(kw => nameLower.includes(kw))
      if (looksLikeDateCol) {
        const meaningful = samples.filter(s => s !== '—' && s !== '-' && s !== 'N/A' && s !== '')
        if (meaningful.length > 0 && meaningful.some(s => looksLikeDate(s))) {
          type = 'date'
        }
      }
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
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Auto-match source columns to existing grid columns by name
// ──────────────────────────────────────────────────────────────────────────────

export function autoMatchColumns(gridId: number, headers: string[]): ColumnMapping[] {
  const db = getDb()
  const existingCols = db.prepare('SELECT * FROM columns WHERE grid_id = ? ORDER BY position').all(gridId) as Column[]
  const usedColIds = new Set<number>()

  const result = headers.map((header, i) => {
    const h = header.toLowerCase().trim()

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

function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve))
}

export async function executeImport(options: ImportOptions, preview: ImportPreview, onProgress?: (imported: number, total: number) => void): Promise<ImportResult> {
  const { gridId, filePath, sheetName, columnMappings, duplicateStrategy, duplicateColumnId, cleanData } = options
  const db = getDb()
  const warnings: string[] = []

  // Prevent concurrent imports — the cache and DB state are not safe for parallel access
  if (_importInProgress) throw new Error('An import is already in progress')
  _importInProgress = true
  const importStart = Date.now()
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  logger.info('import', 'Starting import', { format: ext, rowCount: preview.rows.length })
  try {
    const cached = await getCachedOrParse(filePath, sheetName, options.headerRowIndex)
  const headers = cached.headers
  const allRows = cached.allRows

  // Build column map: sourceIndex → {columnId, type}
  // Create new columns as needed
  const colMap = new Map<number, { columnId: number; type: string }>()

  // Get max existing column position
  const maxPosRow = db.prepare('SELECT MAX(position) as p FROM columns WHERE grid_id = ?').get(gridId) as { p: number | null }
  let nextPos = (maxPosRow.p ?? -1) + 1

  // --- Column creation + name column reassignment (small, fast — single transaction) ---
  const setupColumns = db.transaction(() => {
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
        // Existing column
        const col = db.prepare('SELECT column_type FROM columns WHERE id = ?').get(mapping.action as number) as { column_type: string } | undefined
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
  })

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
        WHERE r.grid_id = ? AND r.is_active = 1 AND r.deleted_at IS NULL
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
        dupKeyOf = (row) => {
          const name = norm(cellValue(row, src))
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
    for (const [srcIdx, info] of colMap.entries()) {
      if (info.type === 'date') dateOrders.set(srcIdx, detectDateOrder(allRows.map(r => String(r[srcIdx] ?? ''))))
    }
    const flipCols = new Set(options.flipLastFirst
      ? preview.detectedColumns.filter(c => c.lastFirstNames).map(c => c.index)
      : [])
    const unreadableDates = new Map<number, number>()
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
        const earlier = toYmd(Number(v.slice(0, 4)) - 100, Number(v.slice(5, 7)), Number(v.slice(8, 10)))
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
      for (const r of db.prepare("SELECT id, display_name FROM rows WHERE grid_id = ? AND deleted_at IS NULL AND COALESCE(display_name, '') != '' ORDER BY is_active DESC, id").all(otherGridId) as Array<{ id: number; display_name: string }>) {
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

    // Process rows in per-chunk transactions. Each chunk commits independently,
    // releasing the write lock between chunks so other writes are not blocked
    // during large imports. If a chunk fails, previously committed chunks persist
    // (partial import is acceptable — the user sees how many rows were imported).
    for (let chunkStart = 0; chunkStart < allRows.length; chunkStart += IMPORT_CHUNK_SIZE) {
      const chunkEnd = Math.min(chunkStart + IMPORT_CHUNK_SIZE, allRows.length)

      // Only rows from chunks that commit get numbers later
      const chunkRowIds: number[] = []
      const insertChunk = db.transaction(() => {
        for (let i = chunkStart; i < chunkEnd; i++) {
          const importRow = allRows[i]!
          if (importRow.every(c => String(c).trim() === '')) continue // skip blank rows

          // Duplicate detection
          if (dupKeys && dupKeyOf) {
            const key = dupKeyOf(importRow)
            if (key !== null) {
              if (dupKeys.has(key)) {
                skippedNames.push(cellValue(importRow, dupLabelSrc ?? 0) || `Row ${i + 2}`)
                skipped++
                continue
              }
              dupKeys.add(key)
            }
          }

          // Create row
          const rowResult = insertRow.run(gridId, nextRowPos++)
          const rowId = rowResult.lastInsertRowid as number
          chunkRowIds.push(rowId)

          // Insert cell values
          for (const [srcIdx, info] of colMap.entries()) {
            const rawVal = cellValue(importRow, srcIdx)
            if (!rawVal) continue
            if (info.type === 'link') { importLinks(rowId, srcIdx, rawVal); continue }

            // The destination column's type decides the format (an existing date
            // column gets YYYY-MM-DD even if the samples looked like text)
            const normalized = info.type === 'date'
              ? importedDate(importRow, srcIdx, true)
              : normalizeValue(rawVal, info.type, cleanData, dateOrders.get(srcIdx))
            if (info.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
              unreadableDates.set(srcIdx, (unreadableDates.get(srcIdx) ?? 0) + 1)
            }

            if (normalized) {
              let cellValue = normalized
              if (cellValue.length > MAX_CELL_VALUE_LENGTH) {
                cellValue = cellValue.slice(0, MAX_CELL_VALUE_LENGTH)
                warnings.push(`Row ${i + 2}, column ${srcIdx + 1}: value truncated to ${MAX_CELL_VALUE_LENGTH} characters`)
              }
              insertCell.run(rowId, info.columnId, cellValue)
            }
          }

          imported++
        }
      })

      try {
        insertChunk()
        newRowIds.push(...chunkRowIds)
      } catch (chunkErr) {
        // Chunk failed — log the error. Previously committed chunks are preserved.
        // This is acceptable: the user sees the imported count and can re-attempt.
        logger.error('import', `Chunk failed at rows ${chunkStart + 2}–${chunkEnd + 1}`, {
          error: chunkErr instanceof Error ? chunkErr.message : String(chunkErr)
        })
        warnings.push(`Import stopped at row ${chunkStart + 2}: ${chunkErr instanceof Error ? chunkErr.message : String(chunkErr)}`)
        break
      }

      // Report progress and yield to event loop between chunks
      if (onProgress) onProgress(imported, allRows.length)
      if (chunkEnd < allRows.length) await yieldToEventLoop()
    }

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

  for (const [srcIdx, n] of birthAs1900s) {
    warnings.push(`${n} date${n === 1 ? '' : 's'} in "${headers[srcIdx] ?? `Column ${srcIdx + 1}`}" had a two-digit year and ${n === 1 ? 'was' : 'were'} read as 19xx. Check ${n === 1 ? 'it' : 'them'}.`)
  }
  for (const [srcIdx, n] of unreadableDates) {
    warnings.push(`${n} value${n === 1 ? '' : 's'} in "${headers[srcIdx] ?? `Column ${srcIdx + 1}`}" didn't look like ${n === 1 ? 'a date' : 'dates'} and ${n === 1 ? 'was' : 'were'} kept as typed. Check ${n === 1 ? 'it' : 'them'} in the grid.`)
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
    logger.error('import', 'Import failed', { error: err instanceof Error ? err.message : String(err) })
    throw err
  } finally {
    _importInProgress = false
  }
}
