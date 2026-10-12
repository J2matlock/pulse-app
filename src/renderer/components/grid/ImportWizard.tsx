/**
 * ImportWizard — Multi-step overlay modal for importing CSV/Excel files into a grid.
 * Steps: 1=Choose a file, 2=Sheet, 3=Preview, 4=Match columns, 5=Options, 6=Results
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Upload,
  X,
  Check,
  AlertTriangle,
  ChevronDown,
} from 'lucide-react'
import { motion } from 'motion/react'
import { backdropVariants, modalPanelVariants } from '../../utils/animations'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { IPC } from '../../../shared/ipc-channels'
import type { Column } from '../../../shared/types'
import { canImportInto } from '../../../shared/types'
import { safeInvoke } from '../../utils/safeInvoke'
import toast from 'react-hot-toast'
import { useVocab } from '../../hooks/useVocab'
import { friendlyError } from '../../utils/friendlyError'
import { columnTypeLabel } from '../../../shared/columnTypes'

// ── Local types ───────────────────────────────────────────────────────────────

interface ImportPreview {
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

interface ColumnMapping {
  sourceIndex: number
  action: 'create' | 'skip' | number
  newName?: string
  newType?: string
}

interface ImportOptions {
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

interface ImportResult {
  imported: number
  skipped: number
  warnings: string[]
  skippedNames?: string[]
  newRowIds?: number[]
  /** The user pressed "Undo this import" before closing: the imported records are in the Trash */
  undone?: boolean
}

interface Props {
  open: boolean
  gridId: number
  onClose: () => void
  onImported: (result: ImportResult) => void
}

type Step = 1 | 2 | 3 | 4 | 5 | 6

const STEP_LABELS: Record<Step, string> = {
  1: 'Choose a file',
  2: 'Sheet',
  3: 'Preview',
  4: 'Match columns',
  5: 'Options',
  6: 'Results',
}

const COLUMN_TYPES = [
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

function TypeBadge({ type }: { type: string }): React.ReactElement {
  const byType: Record<string, string | undefined> = TYPE_BADGE_CLASSES
  const cls = byType[type] ?? TYPE_BADGE_CLASSES.text
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-sm text-sm font-medium ${cls}`}>
      {columnTypeLabel(type)}
    </span>
  )
}

/** ExcelJS reads only .xlsx; older formats need saving again in Excel first */
const OLD_SPREADSHEET = /\.(xls|ods)$/i
const OLD_SPREADSHEET_MESSAGE = 'This is an older spreadsheet file. Open it in Excel (or LibreOffice) and choose Save As → Excel Workbook (.xlsx), then try again.'

/** Notes, comments and remarks columns */
function isNotesColumn(name: string): boolean {
  return /^(notes?|comments?|remarks?)$/i.test(name.trim())
}

// ── Main component ────────────────────────────────────────────────────────────

export function ImportWizard({ open, gridId, onClose, onImported }: Props): React.ReactElement | null {
  const { t } = useVocab(gridId)
  const trapRef = useRef<HTMLDivElement>(null)
  useFocusTrap(trapRef, open)
  const [step, setStep] = useState<Step>(1)
  const [filePath, setFilePath] = useState<string | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [selectedSheet, setSelectedSheet] = useState<number>(0)
  const [mappings, setMappings] = useState<ColumnMapping[]>([])
  const [existingColumns, setExistingColumns] = useState<Column[]>([])
  const [duplicateStrategy, setDuplicateStrategy] = useState<ImportOptions['duplicateStrategy']>('none')
  const [cleanData, setCleanData] = useState(true)
  const [flipNames, setFlipNames] = useState(true)
  const [createMissingLinks, setCreateMissingLinks] = useState(false)
  const [skipHiddenRows, setSkipHiddenRows] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [warningsExpanded, setWarningsExpanded] = useState(false)
  const [undo, setUndo] = useState<'idle' | 'busy' | 'done'>('idle')
  const [importProgress, setImportProgress] = useState<{ imported: number; total: number } | null>(null)
  const [headerRowIndex, setHeaderRowIndex] = useState<number>(0)

  // Drag state
  const [dragOver, setDragOver] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)

  // Reset when opened
  useEffect(() => {
    if (open) {
      setStep(1)
      setFilePath(null)
      setPreview(null)
      setSelectedSheet(0)
      setMappings([])
      setExistingColumns([])
      setDuplicateStrategy('none')
      setCleanData(true)
      setSkipHiddenRows(false)
      setLoading(false)
      setError(null)
      setImportResult(null)
      setWarningsExpanded(false)
      setHeaderRowIndex(0)
      setUndo('idle')
    }
  }, [open])

  // Every way out (Done, ✕, Escape, a click outside) reports a finished import, so the
  // caller reloads the list, and setup doesn't throw away a list that was just filled
  const closeRef = useRef<() => void>(() => {})
  closeRef.current = () => {
    if (step === 6 && loading) return // the import is still running
    if (importResult) onImported(undo === 'done' ? { ...importResult, undone: true } : importResult)
    onClose()
  }
  const close = useCallback(() => closeRef.current(), [])

  // Escape to close
  useEffect(() => {
    if (!open) return
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, close])

  // ── IPC helpers ──────────────────────────────────────────────────────────

  async function loadPreview(path: string, sheetIndex?: number, hdrRowIdx?: number) {
    setLoading(true)
    setError(null)
    try {
      const res = await safeInvoke(
        IPC.IMPORT_FILE_PREVIEW, path, sheetIndex, hdrRowIdx
      )
      if (!res.ok) {
        setError(friendlyError(res.error, 'Could not read the file. Please check the format and try again.'))
        return null
      }
      return res.data
    } catch {
      setError('Something went wrong while reading the file. Please try again.')
      return null
    } finally {
      setLoading(false)
    }
  }

  async function detectMappings(headers: string[]) {
    try {
      const res = await safeInvoke<ColumnMapping[]>(
        IPC.IMPORT_DETECT_COLUMNS, gridId, headers
      )
      if (res.ok) return res.data
    } catch { /* fall through */ }
    return headers.map((_, i) => ({
      sourceIndex: i,
      action: 'create' as const,
      newName: headers[i],
      newType: 'text',
    }))
  }

  async function loadExistingColumns() {
    try {
      const res = await safeInvoke<{ columns: Column[] }>(IPC.GRID_GET, gridId)
      if (res.ok) setExistingColumns(res.data.columns)
    } catch {
      setExistingColumns([])
    }
  }

  // ── File selection ───────────────────────────────────────────────────────

  async function handleBrowse() {
    setError(null)
    const res = await safeInvoke<{ canceled: boolean; filePaths: string[] }>(IPC.APP_SHOW_FILE_DIALOG, {
      properties: ['openFile'],
      filters: [
        { name: 'Spreadsheets', extensions: ['csv', 'xlsx', 'tsv', 'txt'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })
    if (!res.ok) return
    if (res.data.canceled || !res.data.filePaths.length) return
    await handleFileChosen(res.data.filePaths[0]!)
  }

  async function handleFileChosen(path: string) {
    if (OLD_SPREADSHEET.test(path)) { setError(OLD_SPREADSHEET_MESSAGE); return }
    setFilePath(path)
    const p = await loadPreview(path)
    if (!p) return
    setPreview(p)
    setHeaderRowIndex(p.detectedHeaderRow)
    setSelectedSheet(p.activeSheet)

    // Skip sheet step for CSV or single-sheet files
    if (p.sheets.length <= 1) {
      await advanceToPreview(p)
    } else {
      setStep(2)
    }
  }

  // ── Drop zone ────────────────────────────────────────────────────────────

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(true)
  }
  function handleDragLeave() { setDragOver(false) }
  async function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    // File.path was removed from Electron; the preload's webUtils bridge gives the path
    const path = window.api.pathForFile?.(file)
    if (path) {
      await handleFileChosen(path)
    } else {
      setError('Could not get the file path. Try using the Browse button instead.')
    }
  }

  // ── Sheet selection ──────────────────────────────────────────────────────

  async function handleSheetConfirm() {
    if (!filePath || !preview) return
    if (selectedSheet === preview.activeSheet) {
      // Already loaded this sheet
      await advanceToPreview(preview)
      return
    }
    const p = await loadPreview(filePath, selectedSheet)
    if (!p) return
    setPreview(p)
    setHeaderRowIndex(p.detectedHeaderRow)
    await advanceToPreview(p)
  }

  // ── Preview → Column Mapping ─────────────────────────────────────────────

  async function advanceToPreview(p: ImportPreview) {
    setPreview(p)
    setStep(3)
    await loadExistingColumns()
  }

  async function advanceToMapping() {
    if (!preview) return
    const detected = await detectMappings(preview.headers)
    // Fill in newName/newType for 'create' actions
    const filled: ColumnMapping[] = preview.detectedColumns.map((col, i) => {
      const d = detected[i] ?? { sourceIndex: i, action: 'create' }
      // Running notes are often the most valuable column: keep them as plain text
      if (isNotesColumn(col.originalName) && d.action === 'create') {
        return { sourceIndex: col.index, action: 'create' as const, newName: col.originalName, newType: 'text' }
      }
      return {
        sourceIndex: col.index,
        action: d.action,
        newName: d.action === 'create' ? (d.newName ?? col.originalName) : undefined,
        newType: d.action === 'create' ? (d.newType ?? col.detectedType) : undefined,
      }
    })
    setMappings(filled)
    setStep(4)
  }

  function updateMapping(index: number, changes: Partial<ColumnMapping>) {
    setMappings(prev => {
      const next = [...prev]
      next[index] = { ...next[index]!, ...changes }
      return next
    })
  }

  // ── Import ───────────────────────────────────────────────────────────────

  async function handleImport() {
    if (!filePath || !preview) return
    setStep(6)
    setLoading(true)
    setError(null)
    setImportProgress(null)

    // Listen for progress updates from main process
    const removeListener = window.api.on(IPC.IMPORT_PROGRESS, ((...args: unknown[]) => {
      const data = args[0] as { imported: number; total: number }
      setImportProgress(data)
    }))

    try {
      const options: ImportOptions = {
        gridId,
        filePath,
        sheetName: preview.sheets[selectedSheet] ?? undefined,
        columnMappings: mappings,
        duplicateStrategy,
        cleanData,
        headerRowIndex,
        flipLastFirst: flipNames,
        createMissingLinks,
        skipHiddenRows: skipHiddenRows && (preview.hiddenRowCount ?? 0) > 0,
      }
      const res = await safeInvoke<ImportResult>(IPC.IMPORT_FILE, options)
      if (!res.ok) {
        setError(friendlyError(res.error, 'The import failed. Please check your file and try again.'))
      } else {
        setImportResult(res.data)
      }
    } catch {
      setError('Something went wrong during the import. Please try again.')
    } finally {
      setLoading(false)
      setImportProgress(null)
      removeListener()
    }
  }

  async function undoImport() {
    const ids = importResult?.newRowIds
    if (!ids?.length || undo !== 'idle') return
    setUndo('busy')
    const res = await safeInvoke(IPC.IMPORT_UNDO, gridId, ids)
    if (res.ok) setUndo('done')
    else { setUndo('idle'); toast.error(friendlyError(res.error, 'We couldn\'t undo the import. Try again.')) }
  }

  // ── Render helpers ───────────────────────────────────────────────────────

  const visibleSteps: Step[] = preview && preview.sheets.length > 1
    ? [1, 2, 3, 4, 5, 6]
    : [1, 3, 4, 5, 6]
  // Always show all 6 for the stepper dots
  const allSteps: Step[] = [1, 2, 3, 4, 5, 6]

  // "Smith, Jane" names in an imported column: offer to flip them
  const lastFirstExample = (() => {
    const col = preview?.detectedColumns.find(c => c.lastFirstNames && mappings.find(m => m.sourceIndex === c.index)?.action !== 'skip')
    const sample = col?.samples.find(v => /^[^,]+,\s*[^,]+$/.test(v))
    if (!col || !sample) return null
    const [last, first] = sample.split(',').map(x => x.trim())
    return { column: col.originalName, from: sample, to: `${first} ${last}` }
  })()

  return (
    <>
      {open && (
        <div
          ref={trapRef}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <motion.div variants={backdropVariants} initial="hidden" animate="visible" className="fixed inset-0 bg-black/60" onClick={close} />
          <motion.div variants={modalPanelVariants} initial="hidden" animate="visible" className="relative bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-4xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
          <Upload className="w-5 h-5 text-blue-500 flex-shrink-0" />
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 flex-1">
            Import {t('record', { many: true, cap: true })}
          </h2>
          <button
            onClick={close}
            className="p-2 rounded-sm text-slate-500 hover:text-slate-600 dark:hover:text-slate-200
                       focus:outline-hidden focus:ring-3 focus:ring-blue-500 min-h-[44px] min-w-[44px]
                       flex items-center justify-center"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 px-6 py-3 border-b border-slate-100 dark:border-slate-700 flex-shrink-0">
          {allSteps.map((s, i) => {
            const isActive = s === step
            const isPast = s < step
            const isSkipped = !visibleSteps.includes(s)
            if (isSkipped) return null
            return (
              <React.Fragment key={s}>
                {i > 0 && (
                  <div className={`h-px flex-1 max-w-12 ${isPast ? 'bg-blue-400' : 'bg-slate-200 dark:bg-slate-600'}`} />
                )}
                <div
                  className={`flex items-center gap-1.5 ${isSkipped ? 'opacity-30' : ''}`}
                  aria-current={isActive ? 'step' : undefined}
                >
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0
                      ${isActive
                        ? 'bg-blue-500 text-white'
                        : isPast
                        ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300'
                        : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
                      }`}
                  >
                    {isPast ? <Check className="w-3.5 h-3.5" /> : s}
                  </div>
                  <span
                    className={`text-sm hidden sm:inline
                      ${isActive ? 'text-slate-800 dark:text-slate-100 font-medium' : 'text-slate-500 dark:text-slate-400'}`}
                  >
                    {STEP_LABELS[s]}
                  </span>
                </div>
              </React.Fragment>
            )
          })}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {error && (
            <div className="mx-6 mt-4 flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-base text-red-700 dark:text-red-300">{error}</p>
            </div>
          )}

          {/* Step 1: Select File */}
          {step === 1 && (
            <div className="px-6 py-6 space-y-4">
              <div
                ref={dropRef}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={handleBrowse}
                className={`relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed
                            cursor-pointer transition-colors min-h-[200px] p-8
                            ${dragOver
                              ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20'
                              : 'border-slate-300 dark:border-slate-600 hover:border-blue-400 hover:bg-slate-50 dark:hover:bg-slate-700/50'
                            }`}
                role="button"
                tabIndex={0}
                aria-label="Click to browse for a file, or drop a file here"
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleBrowse() } }}
              >
                <Upload className="w-10 h-10 text-slate-500 dark:text-slate-400" />
                <div className="text-center">
                  <p className="text-base font-medium text-slate-700 dark:text-slate-200">
                    Drop a CSV or Excel file here, or click to browse
                  </p>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Supports .csv and .xlsx</p>
                </div>
                {loading && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-white/70 dark:bg-slate-800/70">
                    <span className="text-base text-slate-500 animate-pulse">Reading file...</span>
                  </div>
                )}
              </div>

              {/* "Paste from clipboard" is hidden until main can read the clipboard and import it (audit X-14) */}
            </div>
          )}

          {/* Step 2: Sheet Selection */}
          {step === 2 && preview && (
            <div className="px-6 py-6 space-y-4">
              <p className="text-base text-slate-700 dark:text-slate-300">
                This file has multiple sheets. Select which sheet to import:
              </p>
              <div className="flex flex-col gap-2">
                {preview.sheets.map((name, i) => (
                  <button
                    key={i}
                    onClick={() => setSelectedSheet(i)}
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg border text-base text-left
                                transition-colors min-h-[44px]
                                ${selectedSheet === i
                                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                                  : 'border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
                                }`}
                  >
                    <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0
                                     ${selectedSheet === i
                                       ? 'border-blue-500 bg-blue-500'
                                       : 'border-slate-300 dark:border-slate-500'
                                     }`}
                    />
                    {name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 3: Preview */}
          {step === 3 && preview && (
            <div className="px-6 py-4 space-y-3">
              {(preview.warnings ?? []).map((w, i) => (
                <div key={i} role="status" className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700">
                  <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                  <p className="text-base text-amber-900 dark:text-amber-200">{w}</p>
                </div>
              ))}
              {/* Hidden rows and columns come in like the rest unless left out (AUDIT-127) */}
              {((preview.hiddenRowCount ?? 0) > 0 || (preview.hiddenColumns?.length ?? 0) > 0) && (
                <div role="status" className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 space-y-2">
                  {(preview.hiddenRowCount ?? 0) > 0 && (() => {
                    const n = preview.hiddenRowCount ?? 0
                    return (
                      <>
                        <p className="text-base text-slate-700 dark:text-slate-200">
                          This spreadsheet has {n} hidden {n === 1 ? 'row' : 'rows'} (for example, rows filtered out or hidden in Excel). {n === 1 ? 'It comes in' : 'They come in'} like the others unless you leave {n === 1 ? 'it' : 'them'} out.
                        </p>
                        <label className="flex items-center gap-3 cursor-pointer min-h-[44px]">
                          <input
                            type="checkbox"
                            checked={skipHiddenRows}
                            onChange={e => setSkipHiddenRows(e.target.checked)}
                            className="w-5 h-5 rounded-sm text-blue-500 focus:ring-3 focus:ring-blue-500 focus:ring-offset-0"
                          />
                          <span className="text-base text-slate-700 dark:text-slate-200">Leave out {n} hidden {n === 1 ? 'row' : 'rows'}</span>
                        </label>
                      </>
                    )
                  })()}
                  {(preview.hiddenColumns?.length ?? 0) > 0 && (
                    <p className="text-base text-slate-700 dark:text-slate-200">
                      Hidden {(preview.hiddenColumns?.length ?? 0) === 1 ? 'column' : 'columns'} in the spreadsheet: {preview.hiddenColumns?.join(', ')}. To leave {(preview.hiddenColumns?.length ?? 0) === 1 ? 'it' : 'them'} out, choose Skip on the next step.
                    </p>
                  )}
                </div>
              )}
              {/* Header Row Selector — hide for clipboard paste */}
              {filePath && (
                <div className="flex items-start gap-3 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-medium text-slate-700 dark:text-slate-200">
                        Header row: Row {headerRowIndex + 1}
                      </span>
                      {preview.headerDetectionConfidence === 'high' ? (
                        <span className="inline-flex items-center gap-1 text-sm text-green-600 dark:text-green-400">
                          <Check className="w-3.5 h-3.5" /> Confident
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-sm text-amber-700 dark:text-amber-400">
                          <AlertTriangle className="w-3.5 h-3.5" /> Verify
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                      {preview.headerDetectionConfidence === 'high'
                        ? 'We found your column headers on this row.'
                        : "We're not sure where the headers are. Please verify or adjust."}
                    </p>
                  </div>
                  <div className="flex flex-col gap-1">
                    <button
                      onClick={async () => {
                        if (headerRowIndex <= 0) return
                        const newIdx = headerRowIndex - 1
                        setHeaderRowIndex(newIdx)
                        if (filePath) {
                          const p = await loadPreview(filePath, selectedSheet, newIdx)
                          if (p) { setPreview(p) }
                        }
                      }}
                      disabled={headerRowIndex <= 0 || loading}
                      className="flex items-center justify-center w-10 h-10 rounded-lg border border-slate-300 dark:border-slate-600
                                 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700
                                 focus:outline-hidden focus:ring-3 focus:ring-blue-500
                                 disabled:opacity-30 disabled:cursor-not-allowed min-h-[44px]"
                      aria-label="Move header row up"
                    >
                      <ChevronUp className="w-4 h-4" />
                    </button>
                    <button
                      onClick={async () => {
                        if (headerRowIndex >= (preview.rawRowCount ?? 1) - 2) return
                        const newIdx = headerRowIndex + 1
                        setHeaderRowIndex(newIdx)
                        if (filePath) {
                          const p = await loadPreview(filePath, selectedSheet, newIdx)
                          if (p) { setPreview(p) }
                        }
                      }}
                      disabled={headerRowIndex >= (preview.rawRowCount ?? 1) - 2 || loading}
                      className="flex items-center justify-center w-10 h-10 rounded-lg border border-slate-300 dark:border-slate-600
                                 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700
                                 focus:outline-hidden focus:ring-3 focus:ring-blue-500
                                 disabled:opacity-30 disabled:cursor-not-allowed min-h-[44px]"
                      aria-label="Move header row down"
                    >
                      <ChevronDown className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              <p className="text-base text-slate-600 dark:text-slate-400">
                Showing first {Math.min(preview.rows.length, 20)} rows. Detected {preview.headers.length} column{preview.headers.length !== 1 ? 's' : ''}.
              </p>

              <div className="overflow-auto border border-slate-200 dark:border-slate-700 rounded-lg max-h-[380px]">
                <table className="w-full text-sm border-collapse">
                  {/* Show raw preview rows if available and header is not row 0 */}
                  {preview.rawPreviewRows && headerRowIndex > 0 && (
                    <tbody>
                      {preview.rawPreviewRows.slice(0, headerRowIndex).map((row, ri) => (
                        <tr key={`pre-${ri}`} className="bg-slate-50 dark:bg-slate-800/50">
                          <td className="px-2 py-1 text-sm text-slate-500 dark:text-slate-400 w-10 text-right border-r border-slate-200 dark:border-slate-700">
                            {ri + 1}
                          </td>
                          {row.map((cell, ci) => (
                            <td key={ci} className="px-3 py-1.5 text-sm text-slate-500 dark:text-slate-400 italic whitespace-nowrap max-w-[200px] overflow-hidden text-ellipsis">
                              {cell || ''}
                            </td>
                          ))}
                          {ri === 0 && (
                            <td className="px-2 py-1 text-sm text-slate-500 dark:text-slate-400 whitespace-nowrap">Skipped</td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  )}
                  <thead className="sticky top-0 bg-blue-50 dark:bg-blue-900/20">
                    <tr>
                      <th className="px-2 py-2 text-sm text-slate-500 dark:text-slate-400 w-10 text-right border-r border-slate-200 dark:border-slate-700">
                        {headerRowIndex + 1}
                      </th>
                      {preview.detectedColumns.map(col => (
                        <th
                          scope="col"
                          key={col.index}
                          className="border-b border-blue-200 dark:border-blue-700 px-3 py-2 text-left text-base font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap"
                        >
                          <div className="flex items-center gap-1.5">
                            <span>{col.originalName}</span>
                            <TypeBadge type={col.detectedType} />
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(0, 20).map((row, ri) => (
                      <tr
                        key={ri}
                        className="border-b border-slate-100 dark:border-slate-700/50 even:bg-slate-50/50 dark:even:bg-slate-800/30"
                      >
                        <td className="px-2 py-2 text-sm text-slate-500 dark:text-slate-400 w-10 text-right border-r border-slate-200 dark:border-slate-700">
                          {headerRowIndex + 2 + ri}
                        </td>
                        {preview.headers.map((_, ci) => (
                          <td
                            key={ci}
                            className="px-3 py-2 text-base text-slate-600 dark:text-slate-300 whitespace-nowrap max-w-[200px] overflow-hidden text-ellipsis"
                          >
                            {row[ci] ?? ''}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Step 4: Column Mapping */}
          {step === 4 && preview && (
            <div className="px-6 py-4 space-y-3">
              <p className="text-base text-slate-600 dark:text-slate-400">
                Map each column from your file to a column in this {t('list')}.
              </p>
              <div className="overflow-y-auto max-h-[400px] border border-slate-200 dark:border-slate-700 rounded-lg">
                <table className="w-full table-fixed text-sm">
                  <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-900">
                    <tr className="border-b border-slate-200 dark:border-slate-700">
                      <th scope="col" className="px-3 py-3 text-left text-base font-medium text-slate-700 dark:text-slate-200 w-1/2">
                        Import Column
                      </th>
                      <th scope="col" className="px-3 py-3 text-left text-base font-medium text-slate-700 dark:text-slate-200 w-1/2">
                        Map To
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.detectedColumns.map((col, i) => {
                      const mapping = mappings[i] ?? { sourceIndex: col.index, action: 'create', newName: col.originalName, newType: col.detectedType }
                      return (
                        <tr key={col.index} className="border-b border-slate-100 dark:border-slate-700/50">
                          {/* Source column */}
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-2">
                              <span className="text-base font-medium text-slate-700 dark:text-slate-200">
                                {col.originalName}
                              </span>
                              <TypeBadge type={col.detectedType} />
                            </div>
                            {col.samples.filter(Boolean).length > 0 && (
                              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                                e.g. {col.samples.filter(Boolean).slice(0, 2).join(', ')}
                              </p>
                            )}
                            {isNotesColumn(col.originalName) && mapping.action !== 'skip' && (
                              <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">
                                Notes come in as a text column, so nothing is lost.
                              </p>
                            )}
                          </td>

                          {/* Map-to controls */}
                          <td className="px-3 py-3 space-y-2">
                            <div className="relative">
                              <select
                                value={
                                  mapping.action === 'create' ? 'create'
                                  : mapping.action === 'skip' ? 'skip'
                                  : String(mapping.action)
                                }
                                onChange={e => {
                                  const v = e.target.value
                                  if (v === 'create') {
                                    updateMapping(i, { action: 'create', newName: col.originalName, newType: col.detectedType })
                                  } else if (v === 'skip') {
                                    updateMapping(i, { action: 'skip', newName: undefined, newType: undefined })
                                  } else {
                                    updateMapping(i, { action: Number(v), newName: undefined, newType: undefined })
                                  }
                                }}
                                className="w-full appearance-none rounded-lg border border-slate-300 dark:border-slate-600
                                           bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100
                                           px-3 py-2 pr-8 text-base focus:outline-hidden focus:ring-3 focus:ring-blue-500
                                           min-h-[44px]"
                              >
                                <option value="create">Create new column</option>
                                <option value="skip">Skip (do not import)</option>
                                {existingColumns.filter(ec => canImportInto(ec.column_type)).map(ec => (
                                  <option key={ec.id} value={String(ec.id)}>{ec.name}</option>
                                ))}
                              </select>
                              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 dark:text-slate-400" />
                            </div>

                            {mapping.action === 'create' && (
                              <div className="flex gap-2">
                                <input
                                  type="text"
                                  value={mapping.newName ?? ''}
                                  onChange={e => updateMapping(i, { newName: e.target.value })}
                                  placeholder="Column name"
                                  className="flex-1 rounded-lg border border-slate-300 dark:border-slate-600
                                             bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100
                                             px-3 py-2 text-base focus:outline-hidden focus:ring-3 focus:ring-blue-500
                                             min-h-[44px]"
                                />
                                <div className="relative">
                                  <select
                                    value={mapping.newType ?? 'text'}
                                    onChange={e => updateMapping(i, { newType: e.target.value })}
                                    className="appearance-none rounded-lg border border-slate-300 dark:border-slate-600
                                               bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100
                                               px-3 py-2 pr-8 text-base focus:outline-hidden focus:ring-3 focus:ring-blue-500
                                               min-h-[44px]"
                                  >
                                    {COLUMN_TYPES.map(t => (
                                      <option key={t} value={t}>{columnTypeLabel(t)}</option>
                                    ))}
                                  </select>
                                  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 dark:text-slate-400" />
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Step 5: Options */}
          {step === 5 && (
            <div className="px-6 py-6 space-y-6 max-w-xl">
              {/* Duplicate detection */}
              <fieldset>
                <legend className="text-base font-semibold text-slate-800 dark:text-slate-100 mb-3">
                  Duplicate detection
                </legend>
                <div className="space-y-3">
                  {(
                    [
                      { value: 'none', label: 'None — import all rows' },
                      { value: 'by_name', label: 'Skip duplicates matching by Name column' },
                      { value: 'name_and_dob', label: 'Skip duplicates matching by Name + Date of Birth' },
                    ] as const
                  ).map(opt => (
                    <label
                      key={opt.value}
                      className="flex items-center gap-3 cursor-pointer min-h-[44px]"
                    >
                      <input
                        type="radio"
                        name="duplicate-strategy"
                        value={opt.value}
                        checked={duplicateStrategy === opt.value}
                        onChange={() => setDuplicateStrategy(opt.value)}
                        className="w-5 h-5 text-blue-500 focus:ring-3 focus:ring-blue-500 focus:ring-offset-0"
                      />
                      <span className="text-base text-slate-700 dark:text-slate-200">{opt.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              {/* Clean data */}
              <div>
                <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100 mb-3">
                  Data cleanup
                </h3>
                <label className="flex items-center gap-3 cursor-pointer min-h-[44px]">
                  <input
                    type="checkbox"
                    checked={cleanData}
                    onChange={e => setCleanData(e.target.checked)}
                    className="w-5 h-5 rounded-sm text-blue-500 focus:ring-3 focus:ring-blue-500 focus:ring-offset-0"
                  />
                  <div>
                    <span className="text-base text-slate-700 dark:text-slate-200">
                      Clean data before import
                    </span>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                      Trims extra spaces, normalizes dates and phone numbers
                    </p>
                  </div>
                </label>
                {mappings.some(m => typeof m.action === 'number' && existingColumns.find(c => c.id === m.action)?.column_type === 'link') && (
                  <label className="flex items-center gap-3 cursor-pointer min-h-[44px]">
                    <input
                      type="checkbox"
                      checked={createMissingLinks}
                      onChange={e => setCreateMissingLinks(e.target.checked)}
                      className="w-5 h-5 rounded-sm text-blue-500 focus:ring-3 focus:ring-blue-500 focus:ring-offset-0"
                    />
                    <div>
                      <span className="text-base text-slate-700 dark:text-slate-200">Add linked {t('record', { many: true })} that don't exist yet</span>
                      <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                        Names in link columns are matched to the other {t('list')}. Otherwise, names that match no one are listed afterwards.
                      </p>
                    </div>
                  </label>
                )}
                {lastFirstExample && (
                  <label className="flex items-center gap-3 cursor-pointer min-h-[44px]">
                    <input
                      type="checkbox"
                      checked={flipNames}
                      onChange={e => setFlipNames(e.target.checked)}
                      className="w-5 h-5 rounded-sm text-blue-500 focus:ring-3 focus:ring-blue-500 focus:ring-offset-0"
                    />
                    <div>
                      <span className="text-base text-slate-700 dark:text-slate-200">
                        Change "{lastFirstExample.from}" to "{lastFirstExample.to}"
                      </span>
                      <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                        Names in "{lastFirstExample.column}" are written last name first
                      </p>
                    </div>
                  </label>
                )}
              </div>
            </div>
          )}

          {/* Step 6: Results */}
          {step === 6 && (
            <div className="px-6 py-8 flex flex-col items-center">
              {loading && (
                <div className="flex flex-col items-center gap-3 py-8 w-full max-w-md">
                  {importProgress ? (
                    <>
                      <span className="text-base text-slate-600 dark:text-slate-300">
                        Importing {importProgress.imported} of {importProgress.total}…
                      </span>
                      <div className="w-full h-3 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-500 dark:bg-blue-400 rounded-full transition-all"
                          style={{ width: `${Math.round((importProgress.imported / importProgress.total) * 100)}%` }}
                        />
                      </div>
                    </>
                  ) : (
                    <span className="text-base text-slate-500 dark:text-slate-400 animate-pulse">
                      Importing…
                    </span>
                  )}
                </div>
              )}

              {!loading && error && (
                <div className="w-full max-w-md flex items-start gap-2 p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                  <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-base font-medium text-red-700 dark:text-red-300">Import failed</p>
                    <p className="text-base text-red-600 dark:text-red-400 mt-1">{error}</p>
                  </div>
                </div>
              )}

              {!loading && importResult && (
                <div className="w-full max-w-md space-y-4">
                  <div className="flex items-center gap-3 p-4 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700">
                    <div className="w-9 h-9 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
                      <Check className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <p className="text-base font-semibold text-green-800 dark:text-green-200">
                        {importResult.imported} {t('record', { count: importResult.imported })} imported
                      </p>
                      {importResult.skipped > 0 && (
                        <p className="text-base text-green-700 dark:text-green-300 mt-0.5">
                          {importResult.skipped} skipped because {importResult.skipped === 1 ? 'it was' : 'they were'} already here
                          {importResult.skippedNames && importResult.skippedNames.length > 0 && (
                            <>: {importResult.skippedNames.slice(0, 10).join(', ')}{importResult.skippedNames.length > 10 ? `, and ${importResult.skippedNames.length - 10} more` : ''}</>
                          )}
                        </p>
                      )}
                    </div>
                  </div>

                  {(importResult.newRowIds?.length ?? 0) > 0 && (
                    <div className="flex items-center gap-3 flex-wrap">
                      {undo === 'done' ? (
                        <p role="status" className="text-base text-slate-700 dark:text-slate-200">
                          Undone: the {importResult.newRowIds!.length} imported {t('record', { count: importResult.newRowIds!.length })} {importResult.newRowIds!.length === 1 ? 'is' : 'are'} in the Trash, where {importResult.newRowIds!.length === 1 ? 'it' : 'they'} can be restored.
                        </p>
                      ) : (
                        <>
                          <p className="text-base text-slate-600 dark:text-slate-300 flex-1 min-w-[12rem]">Imported into the wrong {t('list')}, or the wrong file?</p>
                          <button type="button" className="btn-secondary" style={{ minHeight: 44 }} disabled={undo === 'busy'} onClick={() => void undoImport()}>
                            {undo === 'busy' ? 'Undoing…' : 'Undo this import'}
                          </button>
                        </>
                      )}
                    </div>
                  )}

                  {importResult.warnings.length > 0 && (
                    <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 overflow-hidden">
                      <div className="flex items-center gap-2 px-4 py-3">
                        <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                        <span className="text-base font-medium text-amber-700 dark:text-amber-300">
                          {importResult.warnings.length} warning{importResult.warnings.length !== 1 ? 's' : ''}
                        </span>
                        <button
                          onClick={() => setWarningsExpanded(v => !v)}
                          className="ml-auto text-base text-amber-700 dark:text-amber-400 hover:underline
                                     focus:outline-hidden focus:ring-3 focus:ring-amber-400 rounded-sm min-h-[44px] px-2"
                        >
                          {warningsExpanded ? 'Hide' : 'Show'}
                        </button>
                      </div>
                      {warningsExpanded && (
                        <ul className="px-4 pb-3 space-y-1">
                          {importResult.warnings.slice(0, 10).map((w, i) => (
                            <li key={i} className="text-sm text-amber-700 dark:text-amber-300">
                              {w}
                            </li>
                          ))}
                          {importResult.warnings.length > 10 && (
                            <li className="text-sm text-amber-700 dark:text-amber-400">
                              ...and {importResult.warnings.length - 10} more
                            </li>
                          )}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer buttons */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200 dark:border-slate-700 flex-shrink-0">
          <div>
            {/* After a failed import, Back keeps every choice made so far */}
            {((step > 1 && step < 6) || (step === 6 && !loading && !!error && !importResult)) && (
              <button
                onClick={() => {
                  if (step === 6) { setError(null); setStep(5) }
                  else if (step === 3 && (preview?.sheets.length ?? 0) <= 1) setStep(1)
                  else setStep(s => (s - 1) as Step)
                }}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600
                           text-base text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700
                           focus:outline-hidden focus:ring-3 focus:ring-blue-500 min-h-[44px]"
              >
                <ChevronLeft className="w-4 h-4" />
                Back
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            {step < 5 && step !== 1 && (
              <button
                onClick={() => {
                  if (step === 2) handleSheetConfirm()
                  else if (step === 3) advanceToMapping()
                  else setStep(s => (s + 1) as Step)
                }}
                disabled={loading}
                className="flex items-center gap-2 px-5 py-2 rounded-lg bg-blue-500 hover:bg-blue-600
                           text-white text-base font-medium focus:outline-hidden focus:ring-3 focus:ring-blue-500
                           focus:ring-offset-3 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
              >
                Next
                <ChevronRight className="w-4 h-4" />
              </button>
            )}

            {step === 5 && (
              <button
                onClick={handleImport}
                disabled={loading}
                className="flex items-center gap-2 px-5 py-2 rounded-lg bg-blue-500 hover:bg-blue-600
                           text-white text-base font-medium focus:outline-hidden focus:ring-3 focus:ring-blue-500
                           focus:ring-offset-3 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
              >
                Import
              </button>
            )}

            {step === 6 && !loading && (
              <button
                onClick={close}
                className="flex items-center gap-2 px-5 py-2 rounded-lg bg-blue-500 hover:bg-blue-600
                           text-white text-base font-medium focus:outline-hidden focus:ring-3 focus:ring-blue-500
                           focus:ring-offset-3 min-h-[44px]"
              >
                Done
              </button>
            )}
          </div>
        </div>
          </motion.div>
        </div>
      )}
    </>
  )
}
