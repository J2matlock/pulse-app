import React from 'react'
import { columnTypeLabel } from '../../../shared/columnTypes'

// Types, labels and small helpers shared by the import wizard and its steps

// ── Local types ───────────────────────────────────────────────────────────────

export interface ImportPreview {
  sheets: string[]
  activeSheet: number
  headers: string[]
  rows: string[][]
  detectedColumns: Array<{
    index: number
    originalName: string
    detectedType: typeof COLUMN_TYPES[number]
    samples: string[]
    lastFirstNames?: boolean
    /** A date column's cells that say "TBD", "n/a" and the like, in the whole file */
    placeholders?: { count: number; example: string }
  }>
  detectedHeaderRow: number
  headerDetectionConfidence: 'high' | 'medium' | 'low'
  rawRowCount: number
  rawPreviewRows?: string[][]
  warnings?: string[]
  hiddenRowCount?: number
  hiddenColumns?: string[]
  /** Data rows below the column names (blank lines and a "Total" line left out) */
  dataRowCount?: number
}

export interface ColumnMapping {
  sourceIndex: number
  action: 'create' | 'skip' | number
  newName?: string
  newType?: string
}

export interface ImportOptions {
  gridId: number
  filePath: string
  sheetName?: string
  columnMappings: ColumnMapping[]
  duplicateStrategy: 'none' | 'by_name' | 'by_column' | 'name_and_dob'
  duplicateColumnId?: number
  cleanData: boolean
  headerRowIndex?: number
  flipLastFirst?: boolean
  createMissingLinks?: boolean
  skipHiddenRows?: boolean
  /** First + last name into one name (UX-A-07), by the columns' places in the file */
  combineNames?: { firstIndex: number; lastIndex: number }
}

export interface ImportResult {
  imported: number
  skipped: number
  warnings: string[]
  skippedNames?: string[]
  newRowIds?: number[]
  /** The user pressed "Undo this import" before closing: the imported records are in the Trash */
  undone?: boolean
  /** Where each file column went (main's ImportResult) */
  columns?: Array<{ sourceIndex: number; id: number; name: string; type: string; created: boolean }>
  combinedNames?: boolean
  flippedColumns?: string[]
  placeholderDates?: Array<{ column: string; count: number; example: string }>
  sheetName?: string
  headerRow?: number
}

export type Step = 1 | 2 | 3 | 4 | 5 | 6

/** Step names; the circles number only the steps shown (a CSV has no Sheet step, UX-B-33) */
export const STEP_LABELS: Record<Step, string> = {
  1: 'Choose a file',
  2: 'Sheet',
  3: 'Preview',
  4: 'Match columns',
  5: 'Options',
  6: 'Summary',
}

export const COLUMN_TYPES = [
  'text', 'notes', 'date', 'number', 'phone', 'email', 'currency', 'checkbox',
] as const

const TYPE_BADGE_CLASSES: Record<typeof COLUMN_TYPES[number], string> = {
  date: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  number: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  phone: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  email: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  currency: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  checkbox: 'bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300',
  text: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  notes: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function TypeBadge({ type }: { type: string }): React.ReactElement {
  const byType: Record<string, string | undefined> = TYPE_BADGE_CLASSES
  const cls = byType[type] ?? TYPE_BADGE_CLASSES.text
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-sm text-sm font-medium ${cls}`}>
      {columnTypeLabel(type)}
    </span>
  )
}

/** ExcelJS reads only .xlsx; older formats need saving again in Excel first */
export const OLD_SPREADSHEET = /\.(xls|ods)$/i
export const OLD_SPREADSHEET_MESSAGE = 'This is an older spreadsheet file. Open it in Excel (or LibreOffice) and choose "Save As" → "Excel Workbook (.xlsx)", then try again.'

/** Notes, comments and remarks columns */
export function isNotesColumn(name: string): boolean {
  return /^(notes?|comments?|remarks?)$/i.test(name.trim())
}

// A merged group cell above the headers can put a word in front ("Client First Name")
const FIRST_NAME = /^([a-z]+ )?(first|first[ _]?name|given[ _]?name|fname|forename)$/i
// The same names the default record name adds as a last name (src/main/display-names.ts)
const LAST_NAME = /^([a-z]+ )?(last|last[ _]?name|surname|family[ _]?name|lname)$/i

/** A first-name and a last-name column in the file, to offer putting them together (UX-A-07) */
export function findNameParts(preview: ImportPreview): { firstIndex: number; lastIndex: number; first: string; last: string; example: string | null } | null {
  const first = preview.detectedColumns.find(c => FIRST_NAME.test(c.originalName.trim()))
  const last = preview.detectedColumns.find(c => LAST_NAME.test(c.originalName.trim()))
  if (!first || !last) return null
  const row = preview.rows.find(r => (r[first.index] ?? '').trim() && (r[last.index] ?? '').trim())
  return {
    firstIndex: first.index, lastIndex: last.index, first: first.originalName, last: last.originalName,
    example: row ? `${row[first.index]!.trim()} ${row[last.index]!.trim()}` : null,
  }
}

/**
 * An import warning as one short line and the reason behind it (UX-B-35): the
 * first sentence, then the rest. Main writes warnings that way round.
 */
export function splitWarning(text: string): { line: string; why: string | null } {
  const m = text.match(/^(.+?\.)\s+(?=["A-Z])([\s\S]+)$/)
  return m ? { line: m[1]!, why: m[2]! } : { line: text, why: null }
}
