/**
 * ImportWizard — bringing a CSV or Excel file into a list (UX Q1a).
 *
 * Quick path: choose a file → one summary of Pulse's guesses (names put
 * together, column types, which dates repeat) with one "Import" button →
 * what came in, with Undo. Nothing lands in the list before its summary is
 * seen (SUMMARY_FIRST). When Pulse can't tell which row has the column names,
 * or the sheet is empty, it stops at that step with one sentence saying why,
 * then carries on by itself.
 *
 * Step-by-step path ("Match the columns myself"): 1 Choose a file, 2 Sheet,
 * 3 Preview, 4 Match columns, 5 Options, 6 Summary. The circles number the
 * steps shown, so a CSV (no Sheet step) reads 1–5 (UX-B-33).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Upload, X, Check, AlertTriangle } from 'lucide-react'
import { motion } from 'motion/react'
import { backdropVariants, modalPanelVariants } from '../../utils/animations'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { IPC } from '../../../shared/ipc-channels'
import type { DateRuleAnswer } from '../../../shared/ipc-contract'
import type { Column } from '../../../shared/types'
import { safeInvoke } from '../../utils/safeInvoke'
import toast from 'react-hot-toast'
import { useVocab } from '../../hooks/useVocab'
import { useActivityTypeStore } from '../../stores/activityTypeStore'
import { friendlyError } from '../../utils/friendlyError'
import { useAlertStore } from '../../stores/alertStore'
import { unansweredDates, type DateAnswer } from '../../utils/repeatGuess'
import {
  STEP_LABELS, OLD_SPREADSHEET, OLD_SPREADSHEET_MESSAGE, findNameParts,
  type ImportPreview, type ColumnMapping, type ImportOptions, type ImportResult, type Step,
} from './importWizardShared'
import { NEEDS_ADVANCED_REASON, guessDateAnswers, guessDuplicates, guessMappings, needsAdvancedFor, newDateColumns, planImport, type NeedsAdvanced } from './importGuesses'
import { ImportPreviewStep } from './ImportPreviewStep'
import { ImportMappingStep } from './ImportMappingStep'
import { ImportOptionsStep } from './ImportOptionsStep'
import { ImportSummary } from './ImportSummary'
import { PrimaryButton, SecondaryButton } from '../ui/Button'

/**
 * The summary comes before the import, with one "Import" button (the
 * orchestrator's choice, 2026-10-15). false: import as soon as a file is
 * chosen and show the same summary afterwards, with Undo.
 */
export const SUMMARY_FIRST: boolean = true

interface Props {
  open: boolean
  gridId: number
  onClose: () => void
  onImported: (result: ImportResult) => void
  /** Setup's list name and "Each line is one…", shown at the top of the summary */
  slot?: React.ReactNode
  /** Checked on Done after the import; a message is shown instead of closing */
  beforeDone?: () => Promise<string | null>
  /** A file was read: setup names the list from it and guesses what each line is */
  onFileChosen?: (filePath: string, preview: ImportPreview) => void | Promise<void>
  /** Overrides SUMMARY_FIRST (tests) */
  summaryFirst?: boolean
}

/** What one import run needs, taken at the moment Import is pressed */
interface RunInput {
  filePath: string
  preview: ImportPreview
  mappings: ColumnMapping[]
  combineNames: boolean
  duplicateStrategy: ImportOptions['duplicateStrategy']
  cleanData: boolean
  flipNames: boolean
  createMissingLinks: boolean
  skipHiddenRows: boolean
  headerRowIndex: number
}

const linkButton = 'min-h-[44px] px-2 text-base text-blue-700 dark:text-blue-300 underline rounded-lg focus:outline-hidden focus:ring-3 focus:ring-blue-500 disabled:opacity-50'

// ── Main component ────────────────────────────────────────────────────────────

export function ImportWizard({ open, gridId, onClose, onImported, slot, beforeDone, onFileChosen, summaryFirst = SUMMARY_FIRST }: Props): React.ReactElement | null {
  const { t } = useVocab(gridId)
  // Contact note types (loaded on unlock), for a Last Contact column that follows notes after import (R4)
  const noteTypes = useActivityTypeStore(s => s.types)
  const trapRef = useRef<HTMLDivElement>(null)
  useFocusTrap(trapRef, open)
  const [step, setStep] = useState<Step>(1)
  /** quick: Pulse's guesses and the summary; steps: every step, matched by hand */
  const [mode, setMode] = useState<'quick' | 'steps'>('quick')
  /** Why the quick path stopped at the Sheet or Preview step */
  const [notice, setNotice] = useState<NeedsAdvanced | null>(null)
  /** Steps the quick path passed through on the way to the summary */
  const [detour, setDetour] = useState<Step[]>([])
  const [filePath, setFilePath] = useState<string | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [selectedSheet, setSelectedSheet] = useState<number>(0)
  const [mappings, setMappings] = useState<ColumnMapping[]>([])
  const [existingColumns, setExistingColumns] = useState<Column[]>([])
  const [gridRowCount, setGridRowCount] = useState(0)
  const [duplicateStrategy, setDuplicateStrategy] = useState<ImportOptions['duplicateStrategy']>('none')
  const [cleanData, setCleanData] = useState(true)
  const [flipNames, setFlipNames] = useState(true)
  const [createMissingLinks, setCreateMissingLinks] = useState(false)
  const [skipHiddenRows, setSkipHiddenRows] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [importFailed, setImportFailed] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [undo, setUndo] = useState<'idle' | 'busy' | 'done'>('idle')
  const [importProgress, setImportProgress] = useState<{ imported: number; total: number } | null>(null)
  const [headerRowIndex, setHeaderRowIndex] = useState<number>(0)
  const [combineNames, setCombineNamesState] = useState(false)
  /** Which dates come due again, keyed by the column's place in the file */
  const [dateAnswers, setDateAnswers] = useState<Record<number, DateAnswer>>({})
  /** The repeat picker was on the summary before the import, so after it only the sentence shows */
  const [datesAsked, setDatesAsked] = useState(false)
  const [closing, setClosing] = useState(false)

  // Drag state
  const [dragOver, setDragOver] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)

  // Reset when opened
  useEffect(() => {
    if (open) {
      setStep(1)
      setMode('quick')
      setNotice(null)
      setDetour([])
      setFilePath(null)
      setPreview(null)
      setSelectedSheet(0)
      setMappings([])
      setExistingColumns([])
      setGridRowCount(0)
      setDuplicateStrategy('none')
      setCleanData(true)
      setFlipNames(true)
      setCreateMissingLinks(false)
      setSkipHiddenRows(false)
      setLoading(false)
      setError(null)
      setImportFailed(false)
      setImportResult(null)
      setHeaderRowIndex(0)
      setUndo('idle')
      setCombineNamesState(false)
      setDateAnswers({})
      setDatesAsked(false)
      setClosing(false)
      // The drop zone is what she came for, not the dialog's ✕ (UX-A-33)
      dropRef.current?.focus()
    }
  }, [open])

  // Every way out (Done, ✕, Escape, a click outside) keeps the repeat answers shown and
  // reports a finished import, so the list reloads with its colours, and setup doesn't
  // throw away a list that was just filled
  const closeRef = useRef<() => Promise<void>>(async () => {})
  closeRef.current = async () => {
    if (loading || closing) return // the import, or saving the dates, is still running
    if (importResult && undo !== 'done') {
      setClosing(true)
      try { await applyDateRules(importResult) } finally { setClosing(false) }
    }
    if (importResult) onImported(undo === 'done' ? { ...importResult, undone: true } : importResult)
    onClose()
  }
  const close = useCallback(() => { void closeRef.current() }, [])

  async function done() {
    if (beforeDone && importResult && undo !== 'done') {
      const problem = await beforeDone()
      if (problem) { setError(problem); return }
    }
    await closeRef.current()
  }

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

  async function loadPreview(path: string, sheetIndex?: number, hdrRowIdx?: number): Promise<ImportPreview | null> {
    setLoading(true)
    setError(null)
    try {
      const res = await safeInvoke(
        IPC.IMPORT_FILE_PREVIEW, path, sheetIndex, hdrRowIdx
      )
      if (!res.ok) {
        setError(friendlyError(res.error, "We couldn't read that file — check that it's an Excel or CSV file and try again"))
        return null
      }
      return res.data
    } catch {
      setError("We couldn't read that file — try again, or save it again from Excel first")
      return null
    } finally {
      setLoading(false)
    }
  }

  async function detectMappings(headers: string[]): Promise<ColumnMapping[]> {
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

  /** The list's columns and how many records it has (duplicates are only looked for in a list with records) */
  async function loadExistingColumns(): Promise<{ columns: Column[]; rowCount: number }> {
    try {
      const res = await safeInvoke<{ columns: Column[]; rows?: unknown[] }>(IPC.GRID_GET, gridId)
      if (res.ok) {
        const ctx = { columns: res.data.columns, rowCount: res.data.rows?.length ?? 0 }
        setExistingColumns(ctx.columns)
        setGridRowCount(ctx.rowCount)
        return ctx
      }
    } catch { /* below */ }
    setExistingColumns([])
    return { columns: [], rowCount: 0 }
  }

  // ── File selection ───────────────────────────────────────────────────────

  async function handleBrowse(nextMode: 'quick' | 'steps' = mode) {
    setError(null)
    const res = await safeInvoke<{ canceled: boolean; filePaths: string[] }>(IPC.APP_SHOW_FILE_DIALOG, {
      properties: ['openFile'],
      filters: [
        { name: 'Spreadsheets', extensions: ['csv', 'xlsx', 'tsv', 'txt'] },
        { name: 'All files', extensions: ['*'] },
      ],
    })
    if (!res.ok) return
    if (res.data.canceled || !res.data.filePaths.length) return
    await handleFileChosen(res.data.filePaths[0]!, nextMode)
  }

  async function handleFileChosen(path: string, nextMode: 'quick' | 'steps' = mode) {
    if (OLD_SPREADSHEET.test(path)) { setError(OLD_SPREADSHEET_MESSAGE); return }
    setFilePath(path)
    setNotice(null)
    setDetour([])
    const p = await loadPreview(path)
    if (!p) return
    setPreview(p)
    setHeaderRowIndex(p.detectedHeaderRow)
    setSelectedSheet(p.activeSheet)
    const ctx = await loadExistingColumns()
    try { await onFileChosen?.(path, p) } catch { /* naming the list from the file is a nicety */ }

    if (nextMode === 'steps') {
      // Skip sheet step for CSV or single-sheet files
      setStep(p.sheets.length <= 1 ? 3 : 2)
      return
    }
    const reason = needsAdvancedFor(p)
    if (reason) {
      setNotice(reason)
      const at: Step = reason === 'sheet' ? 2 : 3
      setDetour([at])
      setStep(at)
      return
    }
    await toSummary(p, ctx, path)
  }

  /** The quick path's guesses for this preview, then the summary (or the import, then the summary) */
  async function toSummary(p: ImportPreview, ctx?: { columns: Column[]; rowCount: number }, path: string | null = filePath) {
    const { columns, rowCount } = ctx ?? { columns: existingColumns, rowCount: gridRowCount }
    const plan = planImport(p, await detectMappings(p.headers), columns, rowCount)
    setMappings(plan.mappings)
    setCombineNamesState(plan.combineNames)
    setDuplicateStrategy(plan.duplicateStrategy)
    setCleanData(plan.cleanData)
    setFlipNames(plan.flipNames)
    setSkipHiddenRows(plan.skipHiddenRows)
    setDateAnswers(guessDateAnswers(plan.mappings, p, noteTypes))
    setImportResult(null)
    setUndo('idle')
    setImportFailed(false)
    setStep(6)
    if (summaryFirst) {
      setDatesAsked(true)
      return
    }
    setDatesAsked(false)
    if (!path) return
    await runImport({
      filePath: path, preview: p, mappings: plan.mappings, combineNames: plan.combineNames, duplicateStrategy: plan.duplicateStrategy,
      cleanData: plan.cleanData, flipNames: plan.flipNames, createMissingLinks: false, skipHiddenRows: plan.skipHiddenRows,
      headerRowIndex: p.detectedHeaderRow,
    })
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
      setError("We couldn't open that file from here — use the Browse button instead")
    }
  }

  // ── Sheet selection ──────────────────────────────────────────────────────

  async function handleSheetConfirm() {
    if (!filePath || !preview) return
    let p = preview
    if (selectedSheet !== preview.activeSheet) {
      const next = await loadPreview(filePath, selectedSheet)
      if (!next) return
      p = next
      setPreview(p)
      setHeaderRowIndex(p.detectedHeaderRow)
    }
    if (mode === 'quick') {
      // The quick path goes on by itself unless this sheet needs a look too
      const reason = needsAdvancedFor(p)
      if (reason && reason !== 'sheet') {
        setNotice(reason)
        setDetour(d => [...d, 3])
        setStep(3)
        return
      }
      setNotice(null)
      await toSummary(p)
      return
    }
    setStep(3)
  }

  // ── Preview → Column Mapping ─────────────────────────────────────────────

  async function advanceToMapping() {
    const p = preview
    if (!p) return
    const ctx = await loadExistingColumns()
    const guessed = guessMappings(p, await detectMappings(p.headers), ctx.columns)
    setCombineNamesState(guessed.combineNames)
    setMappings(guessed.mappings)
    setDuplicateStrategy(guessDuplicates(p, guessed.mappings, ctx.rowCount))
    setStep(4)
  }

  /** Next on the Preview step: the summary on the quick path, Match columns otherwise */
  async function afterPreview() {
    if (!preview) return
    if (mode === 'quick') { setNotice(null); await toSummary(preview); return }
    await advanceToMapping()
  }

  const nameParts = preview ? findNameParts(preview) : null

  // Turning it off brings the last name back as a column of its own
  function setCombineNames(combine: boolean) {
    setCombineNamesState(combine)
    if (!nameParts || !preview) return
    const li = mappings.findIndex(m => m.sourceIndex === nameParts.lastIndex)
    const col = preview.detectedColumns.find(c => c.index === nameParts.lastIndex)
    if (li < 0 || !col) return
    if (!combine && mappings[li]!.action === 'skip') updateMapping(li, { action: 'create', newName: col.originalName, newType: col.detectedType })
    if (combine && mappings[li]!.action === 'create') updateMapping(li, { action: 'skip', newName: undefined, newType: undefined })
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

  /** The choices on screen now */
  function currentInput(): RunInput | null {
    if (!preview || !filePath) return null
    return { filePath, preview, mappings, combineNames, duplicateStrategy, cleanData, flipNames, createMissingLinks, skipHiddenRows, headerRowIndex }
  }

  /** Import from the Options step (step by step): the dates are asked on the summary after it */
  async function importFromOptions() {
    const input = currentInput()
    if (!input) return
    setDatesAsked(false)
    // Answers already given on the summary (before "Match the columns myself…") are kept
    setDateAnswers(prev => ({ ...guessDateAnswers(input.mappings, input.preview, noteTypes), ...prev }))
    setStep(6)
    await runImport(input)
  }

  async function runImport(input: RunInput) {
    const { preview: p, filePath: path } = input
    setStep(6)
    setLoading(true)
    setError(null)
    setImportFailed(false)
    setImportProgress(null)

    // Listen for progress updates from main process
    const removeListener = window.api.on(IPC.IMPORT_PROGRESS, ((...args: unknown[]) => {
      const data = args[0] as { imported: number; total: number }
      setImportProgress(data)
    }))

    try {
      const parts = findNameParts(p)
      const options: ImportOptions = {
        gridId,
        filePath: path,
        sheetName: p.sheets[p.activeSheet] ?? undefined,
        columnMappings: input.mappings,
        duplicateStrategy: input.duplicateStrategy,
        cleanData: input.cleanData,
        headerRowIndex: input.headerRowIndex,
        flipLastFirst: input.flipNames,
        createMissingLinks: input.createMissingLinks,
        skipHiddenRows: input.skipHiddenRows && (p.hiddenRowCount ?? 0) > 0,
        combineNames: input.combineNames && parts
          && input.mappings.find(m => m.sourceIndex === parts.firstIndex)?.action !== 'skip'
          ? { firstIndex: parts.firstIndex, lastIndex: parts.lastIndex } : undefined,
      }
      const res = await safeInvoke<ImportResult>(IPC.IMPORT_FILE, options)
      if (!res.ok) {
        setImportFailed(true)
        setError(friendlyError(res.error, 'The import failed. Please check your file and try again.'))
      } else {
        setImportResult(res.data)
        setUndo('idle')
      }
    } catch {
      setImportFailed(true)
      setError("We couldn't finish the import — nothing was added; try again")
    } finally {
      setLoading(false)
      setImportProgress(null)
      removeListener()
    }
  }

  /** The repeat answers as deadline rules on the date columns this import made (setup's standard rules) */
  async function applyDateRules(result: ImportResult) {
    const answers: DateRuleAnswer[] = (result.columns ?? []).flatMap((c): DateRuleAnswer[] => {
      if (!c.created || c.type !== 'date') return []
      const a = dateAnswers[c.sourceIndex]
      if (!a || a.repeat === 'no') return []
      // A Last Contact column follows contact notes, unless turned off on the summary (R4)
      const follows = a.followsNotes?.length && !a.followsNotesOff ? { followsNotes: a.followsNotes } : {}
      return a.repeat === 'due' ? [{ columnId: c.id, repeat: 'due' }] : [{ columnId: c.id, repeat: 'every', n: a.n, unit: a.unit, ...follows }]
    })
    if (answers.length === 0) return
    try {
      const res = await safeInvoke(IPC.ONBOARDING_DATE_RULES, gridId, answers)
      if (!res.ok) { toast.error(friendlyError(res.error, "We couldn't set up every deadline. Use the column's ⋯ menu → Deadline rule.")); return }
      await useAlertStore.getState().loadRules()
    } catch {
      toast.error("We couldn't set up every deadline. Use the column's ⋯ menu → Deadline rule.")
    }
  }

  async function undoImport(): Promise<boolean> {
    const ids = importResult?.newRowIds
    if (!ids?.length) return true
    if (undo === 'done') return true
    if (undo !== 'idle') return false
    setUndo('busy')
    const res = await safeInvoke(IPC.IMPORT_UNDO, gridId, ids)
    if (res.ok) { setUndo('done'); return true }
    setUndo('idle')
    toast.error(friendlyError(res.error, 'We couldn\'t undo the import. Try again.'))
    return false
  }

  /** Undo, then go back to a step with the same file; finishing it ends on the summary again */
  async function undoThen(next: 'sheet' | 'header' | 'match') {
    if (!(await undoImport())) return
    // The undone import counts as cancelled: what comes next is a new import
    setImportResult(null)
    setUndo('idle')
    setError(null)
    if (next === 'match') {
      setMode('steps')
      setNotice(null)
      await advanceToMapping()
      return
    }
    if (next === 'sheet') { setDetour(d => d.includes(2) ? d : [...d, 2]); setStep(2); return }
    setDetour(d => d.includes(3) ? d : [...d, 3])
    setStep(3)
  }

  /** The summary's "Use a different sheet" and "Pick another row" */
  function goBackTo(next: 'sheet' | 'header') {
    if (importResult) { void undoThen(next); return }
    if (next === 'sheet') { setDetour(d => d.includes(2) ? d : [...d, 2]); setStep(2) }
    else { setDetour(d => d.includes(3) ? d : [...d, 3]); setStep(3) }
  }

  /** "Match the columns myself…" from the summary before the import */
  function matchMyself() {
    setMode('steps')
    setNotice(null)
    setStep(4)
  }

  // ── Render helpers ───────────────────────────────────────────────────────

  const visibleSteps: Step[] = mode === 'steps'
    ? (preview && preview.sheets.length > 1 ? [1, 2, 3, 4, 5, 6] : [1, 3, 4, 5, 6])
    : ([1, 2, 3, 6] as Step[]).filter(s => s === 1 || s === 6 || detour.includes(s) || s === step)
  const stepNumber = (s: Step) => visibleSteps.indexOf(s) + 1
  const stepLabel = (s: Step) => (s === 3 && mode === 'quick' ? 'Column names' : STEP_LABELS[s])

  // "Smith, Jane" names in an imported column: offer to flip them
  const lastFirstExample = (() => {
    const col = preview?.detectedColumns.find(c => c.lastFirstNames && mappings.find(m => m.sourceIndex === c.index)?.action !== 'skip')
    const sample = col?.samples.find(v => /^[^,]+,\s*[^,]+$/.test(v))
    if (!col || !sample) return null
    const [last, first] = sample.split(',').map(x => x.trim())
    return { column: col.originalName, from: sample, to: `${first} ${last}` }
  })()

  const onSummary = step === 6
  const before = onSummary && !importResult
  const rowsToImport = preview ? (preview.dataRowCount ?? preview.rows.length) : 0
  // "Next due or last done?" for partly-future dates is answered before going on (R4)
  const dateColumns = preview ? newDateColumns(mappings, preview) : []
  const datesWaiting = unansweredDates(dateAnswers).some(id => dateColumns.some(c => c.id === id))

  return (
    <>
      {open && (
        <div
          ref={trapRef}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="import-wizard-title"
        >
          <motion.div variants={backdropVariants} initial="hidden" animate="visible" className="fixed inset-0 bg-black/60" onClick={close} />
          <motion.div variants={modalPanelVariants} initial="hidden" animate="visible" className="relative bg-white dark:bg-slate-800 rounded-lg shadow-2xl w-full max-w-4xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
          <Upload className="w-5 h-5 text-blue-500 flex-shrink-0" />
          <h2 id="import-wizard-title" className="text-xl font-semibold text-slate-800 dark:text-slate-100 flex-1">
            Import {t('record', { many: true, cap: true })}
          </h2>
          <button
            onClick={close}
            className="p-2 rounded-lg text-slate-500 hover:text-slate-600 dark:hover:text-slate-200
                       focus:outline-hidden focus:ring-3 focus:ring-blue-500 min-h-[44px] min-w-[44px]
                       flex items-center justify-center"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step indicator: two steps on the quick path, all of them step by step */}
        <div className="flex items-center justify-center gap-2 px-6 py-3 border-b border-slate-100 dark:border-slate-700 flex-shrink-0">
          {visibleSteps.map((s, i) => {
            const isActive = s === step
            const isPast = visibleSteps.indexOf(step) > i
            return (
              <React.Fragment key={s}>
                {i > 0 && (
                  <div className={`h-px flex-1 max-w-12 ${isPast || isActive ? 'bg-blue-400' : 'bg-slate-200 dark:bg-slate-600'}`} />
                )}
                <div className="flex items-center gap-2" aria-current={isActive ? 'step' : undefined}>
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0
                      ${isActive
                        ? 'bg-blue-500 text-white'
                        : isPast
                        ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300'
                        : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
                      }`}
                  >
                    {isPast ? <Check className="w-3.5 h-3.5" /> : stepNumber(s)}
                  </div>
                  <span
                    className={`text-sm hidden sm:inline
                      ${isActive ? 'text-slate-800 dark:text-slate-100 font-medium' : 'text-slate-500 dark:text-slate-400'}`}
                  >
                    {stepLabel(s)}
                  </span>
                </div>
              </React.Fragment>
            )
          })}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {error && (
            <div role="alert" className="mx-6 mt-4 flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                {importFailed && <p className="text-base font-medium text-red-700 dark:text-red-300">Import failed</p>}
                <p className="text-base text-red-700 dark:text-red-300">{error}</p>
              </div>
            </div>
          )}

          {/* Why the quick path stopped here */}
          {notice && mode === 'quick' && (step === 2 || step === 3) && (
            <p role="status" className="mx-6 mt-4 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 text-base text-slate-800 dark:text-slate-100">
              {NEEDS_ADVANCED_REASON[notice]}
            </p>
          )}

          {/* Step 1: Select File */}
          {step === 1 && (
            <div className="px-6 py-6 space-y-3">
              <div
                ref={dropRef}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => void handleBrowse()}
                className={`relative flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed
                            cursor-pointer transition-colors min-h-[200px] p-8
                            ${dragOver
                              ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20'
                              : 'border-slate-300 dark:border-slate-600 hover:border-blue-400 hover:bg-slate-50 dark:hover:bg-slate-700/50'
                            }`}
                role="button"
                tabIndex={0}
                aria-label="Click to browse for a file, or drop a file here"
                aria-describedby="import-how"
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void handleBrowse() } }}
              >
                <Upload className="w-10 h-10 text-slate-500 dark:text-slate-400" />
                <div className="text-center">
                  <p className="text-base font-medium text-slate-700 dark:text-slate-200">
                    Drop a CSV or Excel file here, or click to browse
                  </p>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Supports .csv and .xlsx</p>
                </div>
                {loading && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-white/70 dark:bg-slate-800/70">
                    <span className="text-base text-slate-500 animate-pulse">Reading file…</span>
                  </div>
                )}
              </div>
              <p id="import-how" className="text-base text-slate-600 dark:text-slate-300">
                {mode === 'quick'
                  ? `Pulse reads the file, matches the columns and shows you what it found before any ${t('record', { many: true })} are added.`
                  : 'You\'ll see the file, match each column and choose the options yourself.'}
              </p>
              <button type="button" className={linkButton} onClick={() => setMode(m => (m === 'quick' ? 'steps' : 'quick'))}>
                {mode === 'quick' ? 'Match the columns myself instead' : 'Let Pulse match the columns instead'}
              </button>

              {/* "Paste from clipboard" is hidden until main can read the clipboard and import it (audit X-14) */}
            </div>
          )}

          {/* Step 2: Sheet Selection */}
          {step === 2 && preview && (
            <div className="px-6 py-6 space-y-4">
              <p className="text-base text-slate-700 dark:text-slate-300">
                This file has multiple sheets. Select which sheet to import:
              </p>
              <div className="flex flex-col gap-2" role="radiogroup" aria-label="Sheet">
                {preview.sheets.map((name, i) => (
                  <button
                    key={i}
                    role="radio"
                    aria-checked={selectedSheet === i}
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
            <ImportMappingStep gridId={gridId} preview={preview} mappings={mappings} existingColumns={existingColumns} updateMapping={updateMapping}
              nameParts={nameParts} combineNames={combineNames} setCombineNames={setCombineNames} />
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

          {/* Step 6: Summary, before and after the import */}
          {onSummary && preview && !(importFailed && mode === 'steps') && (
            <ImportSummary
              gridId={gridId}
              phase={before ? 'before' : 'after'}
              preview={preview}
              mappings={mappings}
              combineNames={combineNames}
              flipNames={flipNames}
              duplicateStrategy={duplicateStrategy}
              existingColumns={existingColumns}
              result={importResult}
              loading={loading}
              importProgress={importProgress}
              undo={undo}
              dateColumns={dateColumns}
              dateAnswers={dateAnswers}
              onDateAnswers={setDateAnswers}
              askDates={before ? datesAsked : !datesAsked}
              slot={slot}
              onUseOtherSheet={undo === 'done' ? undefined : () => goBackTo('sheet')}
              onPickHeaderRow={undo === 'done' ? undefined : () => goBackTo('header')}
            />
          )}
        </div>

        {/* Footer buttons */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-700 flex-shrink-0">
          <div className="flex flex-wrap items-center gap-2">
            {/* After a failed import, Back keeps every choice made so far */}
            {((step > 1 && step < 6) || (onSummary && !loading && !importResult)) && (
              <SecondaryButton
                icon={<ChevronLeft className="w-4 h-4" aria-hidden="true" />}
                onClick={() => {
                  setError(null)
                  setImportFailed(false)
                  if (step === 6) { setStep(mode === 'steps' ? 5 : (detour[detour.length - 1] ?? 1)); return }
                  if (mode === 'quick') {
                    const i = detour.indexOf(step)
                    setStep(i > 0 ? detour[i - 1]! : 1)
                    return
                  }
                  if (step === 3 && (preview?.sheets.length ?? 0) <= 1) setStep(1)
                  else setStep(s => (s - 1) as Step)
                }}
              >
                Back
              </SecondaryButton>
            )}
            {before && !loading && mode === 'quick' && (
              <button type="button" className={linkButton} onClick={matchMyself}>Match the columns myself…</button>
            )}
            {onSummary && importResult && undo !== 'done' && (importResult.newRowIds?.length ?? 0) > 0 && (
              <button type="button" className={linkButton} disabled={undo === 'busy' || closing} onClick={() => void undoThen('match')}>
                Undo and match the columns myself…
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {(step === 2 || step === 3 || step === 4) && (
              <PrimaryButton
                onClick={() => {
                  if (step === 2) void handleSheetConfirm()
                  else if (step === 3) void afterPreview()
                  else setStep(5)
                }}
                disabled={loading}
              >
                Next
                <ChevronRight className="w-4 h-4" aria-hidden="true" />
              </PrimaryButton>
            )}

            {step === 5 && (
              <PrimaryButton onClick={() => void importFromOptions()} disabled={loading}>
                Import
              </PrimaryButton>
            )}

            {before && !loading && preview && (
              <PrimaryButton disabled={rowsToImport === 0 || (datesAsked && datesWaiting)}
                onClick={() => { const input = currentInput(); if (input) void runImport(input) }}>
                Import
              </PrimaryButton>
            )}

            {onSummary && importResult && !loading && (
              <>
                {undo !== 'done' && (importResult.newRowIds?.length ?? 0) > 0 && (
                  <SecondaryButton busy={undo === 'busy'} disabled={closing} onClick={() => void undoImport()}>
                    {undo === 'busy' ? 'Undoing…' : 'Undo this import'}
                  </SecondaryButton>
                )}
                <PrimaryButton busy={closing} disabled={!datesAsked && undo !== 'done' && datesWaiting} onClick={() => void done()}>
                  Done
                </PrimaryButton>
              </>
            )}
          </div>
        </div>
          </motion.div>
        </div>
      )}
    </>
  )
}
