/**
 * export-shared.ts — Shared helpers, types, and jsPDF setup used by all export modules.
 */

import { writeFileSync, renameSync, unlinkSync, openSync, fsyncSync, closeSync } from 'fs'
import { writeFile, rename, unlink } from 'fs/promises'

import type { Column, GridRow, Grid } from '../shared/types'
import { getDb, buildGridQuery } from './database'
import { parseLinkValue, linkColumnSpecs } from '../shared/links'
import { fileCountColumnIds } from '../shared/attachments'
import { logNonFatal } from './ipc/ipc-utils'
import { word } from './vocab'
import { hasDisplayFormat } from './display-names'
import { cellText, deadlineText, type DateFormat } from '../shared/cellText'
import { loadDeadlines, type DeadlineItem } from './deadlines'

// jsPDF is a CJS module; use require() to avoid ESM/CJS interop issues in Electron main.
const { jsPDF } = require('jspdf') as typeof import('jspdf')
// jspdf-autotable v5 requires explicit plugin registration (no longer auto-patches on require)
const { applyPlugin: applyAutoTablePlugin } = require('jspdf-autotable') as { applyPlugin: (jsPDFClass: typeof jsPDF) => void }
applyAutoTablePlugin(jsPDF)

// ── Re-export jsPDF so submodules don't need to repeat the CJS require dance ──
export { jsPDF }

// ── Typed wrappers for jspdf-autotable (avoids `as any` at every call site) ──
export type AutoTableDoc = InstanceType<typeof jsPDF>
export interface AutoTableOptions {
  head?: string[][]
  body?: string[][]
  startY?: number
  styles?: Record<string, unknown>
  headStyles?: Record<string, unknown>
  alternateRowStyles?: Record<string, unknown>
  columnStyles?: Record<number | string, Record<string, unknown>>
  margin?: Record<string, number>
  didDrawPage?: (data: Record<string, unknown>) => void
  pageBreak?: string
  [key: string]: unknown
}
export function autoTable(doc: AutoTableDoc, opts: AutoTableOptions): void {
  (doc as unknown as { autoTable: (opts: AutoTableOptions) => void }).autoTable(opts)
}
export function lastTableY(doc: AutoTableDoc): number {
  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY
}

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export interface CsvExportOptions {
  gridId: number
  /** Column IDs to include (hidden ones too); empty = all visible columns */
  columnIds: number[]
  /** Only these rows, in this order (what's on screen); empty = all */
  activeRowIds: number[]
  /** Output file path (provided by renderer via save dialog) */
  destPath: string
  /** Date format; the saved setting when left out */
  dateFormat?: 'iso' | 'us' | 'eu'
  /** With no columns named, include hidden ones too (Export All) */
  includeHidden?: boolean
}

export interface PdfProfileOptions {
  rowId: number
  gridId: number
  destPath: string
  /** Sections to include */
  includeSections: {
    deadlines: boolean
    checklist: boolean
    caseLog: boolean
    scratchPad: boolean
    contactInfo: boolean
    gridData: boolean
  }
}

export interface PdfGridOptions {
  gridId: number
  columnIds: number[]
  activeRowIds: number[]
  destPath: string
  title?: string
}

export interface SupervisorReportOptions {
  gridId: number
  dateRange: { start: string; end: string }
  columnIds: number[]
  includeActivityLog: boolean
  includeSystemActivity: boolean
  includeTaskSummary: boolean
  format: 'pdf' | 'csv'
  destPath: string
  workerName?: string
  workerTitle?: string
  workerOrg?: string
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

/** Strip HTML tags and decode common entities. */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCharCode(Number(dec)))
}

/**
 * Atomic write: write to temp file, fsync, then rename.
 * Prevents truncated files on disk full or power loss.
 */
export function atomicWriteFileSync(dest: string, data: Buffer | string, encoding?: BufferEncoding): void {
  const tmp = dest + '.tmp'
  try {
    writeFileSync(tmp, data, encoding)
    const fd = openSync(tmp, 'r+')
    try { fsyncSync(fd) } finally { closeSync(fd) }
    renameSync(tmp, dest)
  } catch (err) {
    try { unlinkSync(tmp) } catch (err2) { logNonFatal('export', 'atomicWriteFileSync cleanup tmp', err2) }
    throw err
  }
}

export async function atomicWriteFileAsync(dest: string, data: Buffer | string, encoding?: BufferEncoding): Promise<void> {
  const { open } = await import('fs/promises')
  const tmp = dest + '.tmp'
  try {
    await writeFile(tmp, data, encoding)
    // fsync before rename to ensure data is flushed to disk (prevents corrupt files on power loss)
    const fh = await open(tmp, 'r+')
    try { await fh.sync() } finally { await fh.close() }
    await rename(tmp, dest)
  } catch (err) {
    try { await unlink(tmp) } catch (err2) { logNonFatal('export', 'atomicWriteFileAsync cleanup tmp', err2) }
    throw err
  }
}

export function formatDate(value: string | null, fmt: 'iso' | 'us' | 'eu'): string {
  if (!value) return ''
  // Accept YYYY-MM-DD or ISO datetime
  const d = new Date(value.length === 10 ? value + 'T00:00:00' : value)
  if (isNaN(d.getTime())) return value
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  if (fmt === 'iso') return `${y}-${m}-${day}`
  if (fmt === 'us') return `${m}/${day}/${y}`
  return `${day}/${m}/${y}`
}

/**
 * Prevent CSV formula injection. Excel/LibreOffice treat cells starting with
 * =, +, -, @ as formulas. Prefix with a tab to neutralize without altering
 * the visible data in non-formula-executing contexts (import, copy-paste).
 */
export function sanitizeCsvFormula(v: string): string {
  // Check first character and also after any line endings (multi-line cell values)
  if (/^[=+\-@\t\r]/.test(v)) return `\t${v}`
  if (/\r?\n[=+\-@]/.test(v)) return `\t${v}`
  return v
}

/** Columns whose text is a number or a date: a leading "-" there is a negative number, not a formula (X-21) */
const NON_TEXT_TYPES = new Set(['number', 'currency', 'date', 'checkbox', 'auto_number', 'age_from_dob', 'calculated_days', 'file_count'])

/**
 * A cell as an export shows it: the same text as copying the cell (G-08).
 * Dates follow the date format setting unless one is given.
 */
export function formatCellValue(value: string | null, columnType: string, dateFormat: DateFormat = savedDateFormat()): string {
  const text = cellText(columnType, value, { dateFormat })
  if (!text) return ''
  if (NON_TEXT_TYPES.has(columnType) && (columnType !== 'number' || !isNaN(Number(text)))) return text
  return sanitizeCsvFormula(text)
}

/** Settings → Appearance → Date format, for every export (X-20) */
export function savedDateFormat(): DateFormat {
  try {
    const v = (getDb().prepare("SELECT value FROM settings WHERE key = 'date_format'").get() as { value: string } | undefined)?.value
    return v === 'iso' || v === 'eu' ? v : 'us'
  } catch { return 'us' }
}

/** Deadline columns hold the date last done; exports show what the table shows instead (G-08) */
export function showDeadlinesAsText(gridId: number, columns: Column[], rows: GridRow[]): void {
  const deadlineCols = columns.filter(c => c.column_type === 'deadline')
  if (!deadlineCols.length || !rows.length) return
  const results = new Map<string, DeadlineItem>()
  for (const d of loadDeadlines({ gridId, includeDone: true, includePaused: true })) results.set(`${d.row_id}:${d.column_id}`, d)
  for (const row of rows) {
    for (const c of deadlineCols) {
      const key = `col_${c.id}` as const
      row[key] = deadlineText(results.get(`${row.row_id}:${c.id}`), row[key] as string | null) || null
    }
  }
}

/**
 * The rows an export asked for, in the order it asked (the on-screen sort);
 * every row, in list order, when it named none (G-07).
 */
export function pickRows(rows: GridRow[], activeRowIds: number[]): GridRow[] {
  if (activeRowIds.length === 0) return rows
  const byId = new Map(rows.map(r => [r.row_id, r]))
  return activeRowIds.map(id => byId.get(id)).filter((r): r is GridRow => r !== undefined)
}

/** The columns an export asked for, in list order; the visible ones (or all) when it named none */
export function pickColumns(columns: Column[], columnIds: number[], includeHidden = false): Column[] {
  return columnIds.length > 0 ? columns.filter(c => columnIds.includes(c.id)) : columns.filter(c => includeHidden || c.is_visible !== 0)
}

/** Load grid data needed for exports (includeHidden: hidden columns too, so they can be chosen) */
export function loadGridData(gridId: number, opts: { includeHidden?: boolean } = {}): {
  grid: Grid
  columns: Column[]
  rows: GridRow[]
} {
  const db = getDb()
  const grid = db.prepare('SELECT * FROM grids WHERE id = ?').get(gridId) as Grid
  const columns = db.prepare(`SELECT * FROM columns WHERE grid_id = ?${opts.includeHidden ? '' : ' AND is_visible = 1'} ORDER BY position`).all(gridId) as Column[]

  // Pivot query for rows (uses shared buildGridQuery so deleted rows are excluded)
  if (columns.length === 0) return { grid, columns, rows: [] }

  const links = linkColumnSpecs(columns)
  const rows = db.prepare(buildGridQuery(columns.map(c => c.id), false, links, fileCountColumnIds(columns))).all(gridId) as GridRow[]
  // Exports show linked records by name
  for (const l of links) {
    const key = `col_${l.columnId}` as const
    for (const row of rows) row[key] = parseLinkValue(row[key]).map(x => x.name).join(', ') || null
  }

  return { grid, columns, rows }
}

/** Build the full client name from cells (first + last name columns).
 *  Always queries cells directly so we get first AND last name even when
 *  the materialized display_name only stored the first name.  */
export function getClientName(db: ReturnType<typeof getDb>, rowId: number, gridId: number): string {
  const row = db.prepare('SELECT display_name, grid_id FROM rows WHERE id = ?').get(rowId) as { display_name: string | null; grid_id: number } | undefined
  if (!row) return `${word('record', { cap: true }, gridId)} #${rowId}`

  const gid = gridId || row.grid_id

  // A list with a display format keeps the finished name on the row
  const formatted = row.display_name?.trim()
  if (formatted && formatted !== '(unnamed)' && hasDisplayFormat(row.grid_id)) return formatted

  // Single query: get the name-column value and a matching last-name column value
  const nameResult = db.prepare(`
    SELECT fn_c.value AS first_name, last_c.value AS last_name
    FROM columns fn_col
    JOIN cells fn_c ON fn_c.row_id = ? AND fn_c.column_id = fn_col.id
    LEFT JOIN columns last_col ON last_col.grid_id = fn_col.grid_id
      AND last_col.id != fn_col.id AND last_col.is_visible = 1
      AND LOWER(TRIM(last_col.name)) IN ('last','last name','lastname','surname','family name','lname')
    LEFT JOIN cells last_c ON last_c.row_id = ? AND last_c.column_id = last_col.id
    WHERE fn_col.grid_id = ? AND fn_col.is_name_column = 1
    LIMIT 1
  `).get(rowId, rowId, gid) as { first_name: string | null; last_name: string | null } | undefined

  if (nameResult) {
    const first = nameResult.first_name?.trim() || ''
    const last = nameResult.last_name?.trim() || ''
    if (first && last) return `${first} ${last}`
    if (first) return first
    if (last) return last
  }

  // Fallback to display_name if no name column found
  const dn = row.display_name?.trim()
  if (dn && dn !== '(unnamed)') return dn

  return `${word('record', { cap: true }, gid)} #${rowId}`
}

/** Pre-fetch client names for a set of row IDs to avoid N+1 queries. */
export function batchGetClientNames(db: ReturnType<typeof getDb>, rowIds: number[], gridId: number): Map<number, string> {
  const Rec = word('record', { cap: true }, gridId)
  const nameMap = new Map<number, string>()
  if (rowIds.length === 0) return nameMap

  // Get display_name for all rows in one query
  const uniqueIds = [...new Set(rowIds)]
  const placeholders = uniqueIds.map(() => '?').join(',')
  const rows = db.prepare(`SELECT id, display_name FROM rows WHERE id IN (${placeholders})`).all(...uniqueIds) as Array<{id: number; display_name: string | null}>

  // Get name column value for all rows (a list with a display format already has finished names)
  const nameColRow = hasDisplayFormat(gridId)
    ? undefined
    : db.prepare('SELECT id FROM columns WHERE grid_id = ? AND is_name_column = 1 LIMIT 1').get(gridId) as {id: number} | undefined

  if (nameColRow) {
    const cells = db.prepare(`SELECT row_id, value FROM cells WHERE column_id = ? AND row_id IN (${placeholders})`).all(nameColRow.id, ...uniqueIds) as Array<{row_id: number; value: string | null}>
    const cellMap = new Map(cells.map(c => [c.row_id, c.value]))

    // Also try to find last name column
    const lastNameCol = db.prepare(`SELECT id FROM columns WHERE grid_id = ? AND is_name_column = 0 AND is_visible = 1 AND LOWER(TRIM(name)) IN ('last','last name','lastname','surname','family name','lname') LIMIT 1`).get(gridId) as {id: number} | undefined
    let lastNameMap = new Map<number, string | null>()
    if (lastNameCol) {
      const lastCells = db.prepare(`SELECT row_id, value FROM cells WHERE column_id = ? AND row_id IN (${placeholders})`).all(lastNameCol.id, ...uniqueIds) as Array<{row_id: number; value: string | null}>
      lastNameMap = new Map(lastCells.map(c => [c.row_id, c.value]))
    }

    for (const row of rows) {
      const firstName = cellMap.get(row.id)?.trim() || ''
      const lastName = lastNameMap.get(row.id)?.trim() || ''
      if (firstName && lastName) nameMap.set(row.id, `${firstName} ${lastName}`)
      else if (firstName) nameMap.set(row.id, firstName)
      else if (lastName) nameMap.set(row.id, lastName)
      else {
        const dn = row.display_name?.trim()
        nameMap.set(row.id, (dn && dn !== '(unnamed)') ? dn : `${Rec} #${row.id}`)
      }
    }
  } else {
    for (const row of rows) {
      const dn = row.display_name?.trim()
      nameMap.set(row.id, (dn && dn !== '(unnamed)') ? dn : `${Rec} #${row.id}`)
    }
  }

  // Ensure all requested IDs have entries
  for (const id of uniqueIds) {
    if (!nameMap.has(id)) nameMap.set(id, `${Rec} #${id}`)
  }

  return nameMap
}
