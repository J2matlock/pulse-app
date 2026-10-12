/**
 * ImportWizard — Multi-step overlay modal for importing CSV/Excel files into a grid.
 * Steps: 1=Choose a file, 2=Sheet, 3=Preview, 4=Match columns, 5=Options, 6=Results
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Upload,
  X,
  Check,
  AlertTriangle,
} from 'lucide-react'
import { motion } from 'motion/react'
import { backdropVariants, modalPanelVariants } from '../../utils/animations'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { IPC } from '../../../shared/ipc-channels'
import type { Column } from '../../../shared/types'
import { safeInvoke } from '../../utils/safeInvoke'
import toast from 'react-hot-toast'
import { useVocab } from '../../hooks/useVocab'
import { friendlyError } from '../../utils/friendlyError'
import {
  STEP_LABELS, OLD_SPREADSHEET, OLD_SPREADSHEET_MESSAGE, isNotesColumn,
  type ImportPreview, type ColumnMapping, type ImportOptions, type ImportResult, type Step,
} from './importWizardShared'
import { ImportPreviewStep } from './ImportPreviewStep'
import { ImportMappingStep } from './ImportMappingStep'
import { ImportOptionsStep } from './ImportOptionsStep'
import { ImportResultsStep } from './ImportResultsStep'

interface Props {
  open: boolean
  gridId: number
  onClose: () => void
  onImported: (result: ImportResult) => void
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

  // The header row moved: read the file again with its headers there
  async function changeHeaderRow(newIdx: number) {
    setHeaderRowIndex(newIdx)
    if (filePath) {
      const p = await loadPreview(filePath, selectedSheet, newIdx)
      if (p) { setPreview(p) }
    }
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
            <ImportPreviewStep
              preview={preview}
              filePath={filePath}
              headerRowIndex={headerRowIndex}
              loading={loading}
              skipHiddenRows={skipHiddenRows}
              setSkipHiddenRows={setSkipHiddenRows}
              onHeaderRowChange={newIdx => void changeHeaderRow(newIdx)}
            />
          )}

          {/* Step 4: Column Mapping */}
          {step === 4 && preview && (
            <ImportMappingStep gridId={gridId} preview={preview} mappings={mappings} existingColumns={existingColumns} updateMapping={updateMapping} />
          )}

          {/* Step 5: Options */}
          {step === 5 && (
            <ImportOptionsStep
              gridId={gridId}
              duplicateStrategy={duplicateStrategy}
              setDuplicateStrategy={setDuplicateStrategy}
              cleanData={cleanData}
              setCleanData={setCleanData}
              createMissingLinks={createMissingLinks}
              setCreateMissingLinks={setCreateMissingLinks}
              flipNames={flipNames}
              setFlipNames={setFlipNames}
              mappings={mappings}
              existingColumns={existingColumns}
              lastFirstExample={lastFirstExample}
            />
          )}

          {/* Step 6: Results */}
          {step === 6 && (
            <ImportResultsStep
              gridId={gridId}
              loading={loading}
              importProgress={importProgress}
              error={error}
              importResult={importResult}
              undo={undo}
              onUndo={undoImport}
              warningsExpanded={warningsExpanded}
              setWarningsExpanded={setWarningsExpanded}
            />
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
