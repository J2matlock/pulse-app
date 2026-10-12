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
    detectedType: 'text' | 'date' | 'number' | 'phone' | 'email' | 'currency' | 'checkbox'
    samples: string[]
    lastFirstNames?: boolean
  }>
  detectedHeaderRow: number
  headerDetectionConfidence: 'high' | 'medium' | 'low'
  rawRowCount: number
  rawPreviewRows?: string[][]
  warnings?: string[]
  hiddenRowCount?: number
  hiddenColumns?: string[]
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
}

export interface ImportResult {
  imported: number
  skipped: number
  warnings: string[]
  skippedNames?: string[]
  newRowIds?: number[]
  /** The user pressed "Undo this import" before closing: the imported records are in the Trash */
  undone?: boolean
}

export type Step = 1 | 2 | 3 | 4 | 5 | 6

export const STEP_LABELS: Record<Step, string> = {
  1: 'Choose a file',
  2: 'Sheet',
  3: 'Preview',
  4: 'Match columns',
  5: 'Options',
  6: 'Results',
}

export const COLUMN_TYPES = [
  'text', 'date', 'number', 'phone', 'email', 'currency', 'checkbox',
] as const

const TYPE_BADGE_CLASSES: Record<typeof COLUMN_TYPES[number], string> = {
  date: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  number: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  phone: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  email: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  currency: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  checkbox: 'bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300',
  text: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
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
export const OLD_SPREADSHEET_MESSAGE = 'This is an older spreadsheet file. Open it in Excel (or LibreOffice) and choose Save As → Excel Workbook (.xlsx), then try again.'

/** Notes, comments and remarks columns */
export function isNotesColumn(name: string): boolean {
  return /^(notes?|comments?|remarks?)$/i.test(name.trim())
}
