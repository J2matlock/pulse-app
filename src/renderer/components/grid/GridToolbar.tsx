import { useNavigate } from 'react-router-dom'
import React, { useCallback, useState, useRef, useEffect, useMemo } from 'react'
import { edgeAwareRefCallback } from '../../utils/domHelpers'
import { AnimatePresence, motion } from 'motion/react'
import { Plus, Columns, Eye, EyeOff, Upload, ChevronDown, Archive, Gauge, Settings2, ClipboardPen, FileBarChart } from 'lucide-react'
import { ListSettingsDialog } from './ListSettingsDialog'
import { ContactRequirementsDialog } from '../contact-req/ContactRequirementsDialog'
import toast from 'react-hot-toast'
import { useShallow } from 'zustand/react/shallow'
import { useGridStore } from '../../stores/gridStore'
import { IPC } from '../../../shared/ipc-channels'
import { Tooltip } from '../shared/Tooltip'
import { ImportWizard } from './ImportWizard'
import { SupervisorReportDialog } from './SupervisorReportDialog'
import { ComplianceSummaryDialog } from '../reports/ComplianceSummaryDialog'
import { MissingInfoDialog } from '../reports/MissingInfoDialog'
import { AuditReportDialog } from '../shared/AuditReportDialog'
import { TotalsDialog } from '../reports/TotalsDialog'
import { FilterControls } from './FilterBar'
import { GroupingBar } from './GroupingBar'
import { AcuityConfigPanel } from './AcuityConfigPanel'
import { SavedViewsDropdown } from './SavedViewsDropdown'
import { ColumnSelectDialog, type RowScope, type RowScopeCounts } from '../shared/ColumnSelectDialog'
import { dropdownVariants } from '../../utils/animations'

/** Isolated component — subscribes to rows independently so GridToolbar doesn't re-render on cell edits. */
function AcuityPointsBadge(): React.ReactElement | null {
  const { rows, acuityLevels } = useGridStore(useShallow(s => ({
    rows: s.rows, acuityLevels: s.acuityLevels,
  })))
  const levelMap = new Map(acuityLevels.map(l => [l.id, l.points]))
  const total = rows.reduce((sum, r) => sum + (levelMap.get(r.acuity_level_id as number) ?? 0), 0)
  if (total <= 0) return null
  return (
    <span className="ml-0.5 bg-purple-200 dark:bg-purple-800 text-purple-800 dark:text-purple-200 text-sm font-medium px-1.5 py-0.5 rounded-full">
      {total} pts
    </span>
  )
}
import type { ColumnType, SaveDialogResult } from '../../../shared/types'
import { safeInvoke } from '../../utils/safeInvoke'
import { noteUnencryptedExport } from '../../utils/exportNotice'
import { useVocab } from '../../hooks/useVocab'
import { useFeature } from '../../hooks/useFeature'
import { FeatureOffer } from '../shared/FeatureOffer'
import { LinkSetupDialog } from '../links/LinkSetupDialog'
import { BatchDocumentsDialog } from '../documents/BatchDocumentsDialog'
import { useFormStore } from '../../stores/formStore'
import { pulseEvents } from '../../events'
import type { Form } from '../../../shared/forms'
import { stageConfigOf } from '../../../shared/stages'
import { DeadlineQuestion } from './DeadlineQuestion'
import { ensurePlainRule, type DeadlineChoice } from '../alerts/plainRule'
import { AlertRuleEditor } from '../alerts/AlertRuleEditor'
import { useAlertStore } from '../../stores/alertStore'
import { engineRuleFrom, needsDeadlineColumn } from '../../../shared/deadlineEngine'
import { COLUMN_TYPE_INFO } from '../../../shared/columnTypes'
import { AUTO_NUMBER_PREFIX_MAX, DEFAULT_AUTO_NUMBER, formatAutoNumber, parseAutoNumberConfig } from '../../../shared/autoNumber'

const EMPTY_FORMS: Form[] = []

/** Every type a new column can be (links and file counts have their own entries) */
const COLUMN_TYPES = COLUMN_TYPE_INFO

export function GridToolbar(): React.ReactElement {
  const { t } = useVocab()
  const navigate = useNavigate()
  // Default export file name, e.g. "clients.csv"; words are user-typed, so keep it path-safe
  const fileWord = t('record', { many: true }).replace(/[^\w -]/g, '').trim() || 'export'
  const { columns, hiddenColumns, activeGridId, showArchived, acuityEnabled: acuityFlag } = useGridStore(useShallow(s => ({
    columns: s.columns, hiddenColumns: s.hiddenColumns, activeGridId: s.activeGridId,
    showArchived: s.showArchived, acuityEnabled: s.acuityEnabled,
  })))
  // A list's own setting, shown only while the feature is switched on
  const priorityOn = useFeature('priority')
  const showSummaryReport = useFeature('summaryReport')
  const timeOn = useFeature('timeTracking')
  const mileageOn = useFeature('mileage')
  const measuresOn = useFeature('measures')
  const requirementsOn = useFeature('requirements')
  const acuityEnabled = acuityFlag && priorityOn
  const activeGridName = useGridStore(s => s.grids.find(g => g.id === s.activeGridId)?.name)
  const { addRow, addColumn, toggleColumnVisibility, setShowArchived } = useGridStore(useShallow(s => ({
    addRow: s.addRow, addColumn: s.addColumn, toggleColumnVisibility: s.toggleColumnVisibility, setShowArchived: s.setShowArchived,
  })))
  const [showAddColumn, setShowAddColumn] = useState(false)
  const [showListSettings, setShowListSettings] = useState(false)
  const [showRequirements, setShowRequirements] = useState(false)
  const [showManageColumns, setShowManageColumns] = useState(false)
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const [showViewMenu, setShowViewMenu] = useState(false)
  const [showReportsMenu, setShowReportsMenu] = useState(false)
  const [showImportWizard, setShowImportWizard] = useState(false)
  const [showSupervisorReport, setShowSupervisorReport] = useState(false)
  const [report, setReport] = useState<'compliance' | 'missing' | 'audit' | 'time' | null>(null)
  const closeReport = useCallback(() => setReport(null), [])
  const [showAcuityPanel, setShowAcuityPanel] = useState(false)
  const [exportColumnSelect, setExportColumnSelect] = useState<'csv' | 'pdf' | null>(null)
  const [newColName, setNewColName] = useState('')
  const [newColType, setNewColType] = useState<ColumnType>('text')
  const [deadlineChoice, setDeadlineChoice] = useState<DeadlineChoice>({ mode: 'none' })
  // "More options…": the full rule editor for the column just added
  const [ruleEditorFor, setRuleEditorFor] = useState<number | null>(null)
  const alertRules = useAlertStore(s => s.rules)
  const createRule = useAlertStore(s => s.createRule)
  const updateColumn = useGridStore(s => s.updateColumn)
  const [dropdownOptions, setDropdownOptions] = useState('')
  const [sourceColumnId, setSourceColumnId] = useState<number | null>(null)
  const [autoPrefix, setAutoPrefix] = useState('')
  const [autoPad, setAutoPad] = useState(DEFAULT_AUTO_NUMBER.pad)
  const [numberExisting, setNumberExisting] = useState(true)
  const rowCount = useGridStore(s => s.rows.length)
  const colNameInputRef = useRef<HTMLInputElement>(null)
  const linksOn = useFeature('links')
  const lettersOn = useFeature('letters')
  const formsOn = useFeature('forms')
  const filesOn = useFeature('attachments')
  const [showFormMenu, setShowFormMenu] = useState(false)
  const listForms = useFormStore(s => (activeGridId != null ? s.byGrid[activeGridId] : undefined)) ?? EMPTY_FORMS
  useEffect(() => { if (formsOn && activeGridId != null) void useFormStore.getState().load(activeGridId) }, [formsOn, activeGridId])
  // "Bring in a spreadsheet" from the empty list
  useEffect(() => pulseEvents.on('grid:open-import', () => setShowImportWizard(true)), [])
  const [batchDocs, setBatchDocs] = useState(false)
  const selectedIds = useGridStore(s => s.selectedRowIds)
  const stagesOn = useFeature('stages')
  const viewMode = useGridStore(s => s.viewMode)
  const setViewMode = useGridStore(s => s.setViewMode)
  const hasStage = useGridStore(s => s.columns.concat(s.hiddenColumns).some(c => stageConfigOf(c) !== null))
  const gridCount = useGridStore(s => s.grids.length)
  const [linkSetup, setLinkSetup] = useState(false)

  function handleExportCsvStart() {
    openExport('csv')
  }

  const [pdfRowCount, setPdfRowCount] = useState(0)
  const [scopeCounts, setScopeCounts] = useState<RowScopeCounts>({ shown: 0, selected: 0, all: 0 })

  // The records on screen, in screen order; the board shows every record
  function shownRowIds(): number[] {
    const s = useGridStore.getState()
    return s.viewMode === 'board' ? s.rows.map(r => r.row_id) : s.sortedRowIds
  }

  function openExport(format: 'csv' | 'pdf') {
    setShowMoreMenu(false)
    // Read counts from the store at open time to avoid subscribing to rows
    const s = useGridStore.getState()
    setScopeCounts({ shown: shownRowIds().length, selected: s.selectedRowIds.size, all: s.rows.length })
    setPdfRowCount(s.rows.length)
    setExportColumnSelect(format)
  }

  function handleExportPdfStart() {
    openExport('pdf')
  }

  async function handleExportWithColumns(selectedIds: number[], scope: RowScope = 'all') {
    const format = exportColumnSelect
    setExportColumnSelect(null)
    if (!activeGridId || !format) return
    // What the person sees is what leaves the app (G-07): shown or selected records, in screen order
    const shown = shownRowIds()
    const picked = useGridStore.getState().selectedRowIds
    const activeRowIds = scope === 'shown' ? shown
      : scope === 'selected' ? [...shown.filter(id => picked.has(id)), ...[...picked].filter(id => !shown.includes(id))]
      : []
    if (scope !== 'all' && activeRowIds.length === 0) { toast.error(`No ${t('record', { many: true })} to export.`); return }

    if (format === 'csv') {
      const saveRes = await safeInvoke<SaveDialogResult>(IPC.APP_SHOW_SAVE_DIALOG, {
        title: 'Export to CSV',
        defaultPath: `${fileWord}.csv`,
        filters: [{ name: 'CSV Files', extensions: ['csv'] }]
      })
      if (!saveRes.ok || saveRes.data.canceled || !saveRes.data.filePath) return
      const result = await safeInvoke<boolean>(IPC.EXPORT_CSV, {
        gridId: activeGridId,
        columnIds: selectedIds,
        activeRowIds,
        destPath: saveRes.data.filePath,
      })
      if (!result.ok) toast.error('Export failed. Please try again.')
      else noteUnencryptedExport()
    } else {
      const saveRes = await safeInvoke<SaveDialogResult>(IPC.APP_SHOW_SAVE_DIALOG, {
        title: 'Export Grid to PDF',
        defaultPath: `${fileWord}.pdf`,
        filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
      })
      if (!saveRes.ok || saveRes.data.canceled || !saveRes.data.filePath) return
      const result = await safeInvoke<boolean>(IPC.EXPORT_PDF_GRID, {
        gridId: activeGridId,
        columnIds: selectedIds,
        activeRowIds,
        destPath: saveRes.data.filePath
      })
      if (!result.ok) toast.error('Export failed. Please try again.')
      else noteUnencryptedExport()
    }
  }

  // Imperatively focus the input each time the popup opens (autoFocus is unreliable
  // in Electron after a loadGrid re-render resets focus state)
  useEffect(() => {
    if (showAddColumn) {
      setTimeout(() => colNameInputRef.current?.focus(), 0)
    }
  }, [showAddColumn])

  async function handleAddColumn(e: React.FormEvent) {
    e.preventDefault()
    const name = newColName.trim()
    if (!name) return

    let config: string | undefined
    if (newColType === 'dropdown') {
      const options = dropdownOptions.split('\n').map(o => o.trim()).filter(Boolean)
      config = JSON.stringify({ options })
    } else if (newColType === 'status') {
      const STATUS_COLORS = ['#22c55e', '#3b82f6', '#eab308', '#f97316', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899']
      const labels = dropdownOptions.split('\n').map(o => o.trim()).filter(Boolean)
      const options = labels.map((label, i) => ({ label, color: STATUS_COLORS[i % STATUS_COLORS.length] }))
      config = JSON.stringify({ options })
    } else if (newColType === 'age_from_dob' || newColType === 'calculated_days') {
      if (sourceColumnId === null) { toast.error('Choose the date it works from.'); return }
      config = JSON.stringify({ source_column_id: sourceColumnId })
    } else if (newColType === 'auto_number') {
      config = JSON.stringify(parseAutoNumberConfig({ prefix: autoPrefix, pad: autoPad, next: 1 }))
    } else if (newColType === 'date' || newColType === 'deadline') {
      // "Does this date come due again?": a plain rule now, or the full editor once the column exists
      const ruleId = await ensurePlainRule(deadlineChoice, alertRules, createRule)
      if (ruleId !== null) config = JSON.stringify({ alert_rule_id: ruleId })
    }

    const colId = await addColumn(name, newColType, config, { numberExisting: rowCount > 0 && numberExisting })
    if (colId !== null && (newColType === 'date' || newColType === 'deadline') && deadlineChoice.mode === 'more') setRuleEditorFor(colId)
    setDeadlineChoice({ mode: 'none' })
    setNewColName('')
    setNewColType('text')
    setDropdownOptions('')
    setAutoPrefix('')
    setAutoPad(DEFAULT_AUTO_NUMBER.pad)
    setNumberExisting(true)
    setShowAddColumn(false)
  }

  const allColumns = useMemo(() => [...columns, ...hiddenColumns].sort((a, b) => a.position - b.position), [columns, hiddenColumns])

  return (
    <div className="flex items-center flex-wrap gap-2 px-4 py-2 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex-shrink-0">
      {/* Up front: Add, the filters, Views and Group; the rest is grouped under View, Reports and More (G-22) */}
      {/* Add row */}
      <Tooltip content={`Add a new ${t('record')}`} placement="bottom">
        <button
          data-tour="add-client"
          onClick={addRow}
          className="btn-primary flex items-center gap-2"
          style={{ minHeight: 36, padding: '0 12px', fontSize: 15 }}
          title={`Add a new ${t('record')}`}
          aria-label={`Add ${t('record')}`}
        >
          <Plus className="w-4 h-4" />
          Add {t('record', { cap: true })}
        </button>
      </Tooltip>

      {/* Add with a form (W08) */}
      {formsOn && listForms.length > 0 && activeGridId != null && (
        <div className="relative">
          <button type="button" className="btn-secondary flex items-center gap-2" style={{ minHeight: 36, padding: '0 12px', fontSize: 15 }}
            aria-expanded={showFormMenu} onClick={() => setShowFormMenu(v => !v)}>
            <ClipboardPen className="w-4 h-4" />Use a form
            <ChevronDown className="w-3.5 h-3.5 opacity-60" />
          </button>
          {showFormMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowFormMenu(false)} />
              <div role="menu" className="absolute left-0 top-full mt-1 w-64 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg py-1 z-50">
                {listForms.map(f => (
                  <button key={f.id} role="menuitem" type="button" className="w-full text-left px-4 text-base text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700" style={{ minHeight: 44 }}
                    onClick={() => { setShowFormMenu(false); pulseEvents.emit('form:fill', { formId: f.id, gridId: activeGridId }) }}>
                    {f.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Filter rows */}
      <FilterControls />

      {/* Saved views */}
      <SavedViewsDropdown />

      {/* Group rows */}
      <GroupingBar />

      {/* View: table or board, archived, priority */}
      <div className="relative" data-tour="archived-toggle">
        <button
          onClick={() => { setShowViewMenu(v => !v); setShowMoreMenu(false); setShowReportsMenu(false) }}
          className="btn-secondary flex items-center gap-2"
            style={{ minHeight: 36, padding: '0 12px', fontSize: 15 }}
          aria-expanded={showViewMenu}
          aria-haspopup="menu"
        >
          <Eye className="w-4 h-4" />
          View
          {(showArchived || viewMode === 'board') && <span className="w-2 h-2 rounded-full bg-amber-500" aria-label="(changed)" />}
          <ChevronDown className="w-3.5 h-3.5 opacity-60" />
        </button>
        {showViewMenu && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowViewMenu(false)} />
            <div role="menu" ref={edgeAwareRefCallback} className="absolute left-0 top-full mt-1 w-72 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg py-1 z-50">
              {stagesOn && hasStage && (<>
                <p className="px-4 pt-2 pb-1 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400" aria-hidden="true">Show as</p>
                {(['table', 'board'] as const).map(mode => (
                  <button key={mode} role="menuitemradio" aria-checked={viewMode === mode} className="flex items-center gap-2 w-full px-4 py-2.5 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 text-left"
                  style={{ minHeight: 44 }}
                    onClick={() => { setViewMode(mode); setShowViewMenu(false) }}>
                    <span className="w-4">{viewMode === mode ? '✓' : ''}</span>{mode === 'table' ? 'Table' : 'Board'}
                  </button>
                ))}
                <div className="my-1 border-t border-slate-100 dark:border-slate-700" />
              </>)}
              <button role="menuitemcheckbox" aria-checked={showArchived} className="flex items-center gap-2 w-full px-4 py-2.5 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 text-left"
                  style={{ minHeight: 44 }}
                onClick={() => { setShowArchived(!showArchived); setShowViewMenu(false) }}>
                <Archive className="w-4 h-4" />
                <span className="flex-1">Show archived {t('record', { many: true })}</span>
                {showArchived && <span aria-hidden="true">✓</span>}
              </button>
              {priorityOn && (
                <button role="menuitem" className="flex items-center gap-2 w-full px-4 py-2.5 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 text-left"
                  style={{ minHeight: 44 }}
                  onClick={() => { setShowViewMenu(false); setShowAcuityPanel(true) }}>
                  <Gauge className="w-4 h-4" />
                  <span className="flex-1">{acuityEnabled ? `${t('priority', { many: true, cap: true })}…` : `Turn on ${t('priority', { many: true })}…`}</span>
                  {acuityEnabled && <AcuityPointsBadge />}
                </button>
              )}
            </div>
          </>
        )}
        {showAcuityPanel && <AcuityConfigPanel onClose={() => setShowAcuityPanel(false)} />}
      </div>

      {/* Reports */}
      <div className="relative">
        <button
          onClick={() => { setShowReportsMenu(v => !v); setShowMoreMenu(false); setShowViewMenu(false) }}
          className="btn-secondary flex items-center gap-2"
            style={{ minHeight: 36, padding: '0 12px', fontSize: 15 }}
          aria-expanded={showReportsMenu}
          aria-haspopup="menu"
        >
          <FileBarChart className="w-4 h-4" />
          Reports
          <ChevronDown className="w-3.5 h-3.5 opacity-60" />
        </button>
        <AnimatePresence>
          {showReportsMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowReportsMenu(false)} />
              <motion.div
                role="menu"
                ref={edgeAwareRefCallback}
                className="absolute left-0 top-full mt-1 w-64 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg py-1 z-50"
                variants={dropdownVariants}
                initial="hidden" animate="visible" exit="exit"
              >
                <button
                  className="flex items-center gap-2 w-full px-4 py-2.5 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 text-left"
                  style={{ minHeight: 44 }}
                  onClick={() => { setShowReportsMenu(false); navigate('/reports?new=1') }}
                >
                  Build a report…
                </button>
                {showSummaryReport && (<>
                  <button
                    className="flex items-center gap-2 w-full px-4 py-2.5 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 text-left"
                    style={{ minHeight: 44 }}
                    onClick={() => { setShowReportsMenu(false); setShowSupervisorReport(true) }}
                  >
                    Summary report…
                  </button>
                </>)}
                {requirementsOn && (
                <button
                  className="flex items-center gap-2 w-full px-4 py-2.5 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 text-left"
                  style={{ minHeight: 44 }}
                  onClick={() => { setShowReportsMenu(false); setReport('compliance') }}
                >
                  {t('requirement', { many: true, cap: true })} summary…
                </button>
                )}
                <button
                  className="flex items-center gap-2 w-full px-4 py-2.5 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 text-left"
                  style={{ minHeight: 44 }}
                  onClick={() => { setShowReportsMenu(false); setReport('missing') }}
                >
                  Missing information…
                </button>
                <button
                  className="flex items-center gap-2 w-full px-4 py-2.5 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 text-left"
                  style={{ minHeight: 44 }}
                  onClick={() => { setShowReportsMenu(false); setReport('audit') }}
                >
                  Audit trail…
                </button>
                {(timeOn || mileageOn || measuresOn) && (<>
                  <button
                    className="flex items-center gap-2 w-full px-4 py-2.5 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 text-left"
                    style={{ minHeight: 44 }}
                    onClick={() => { setShowReportsMenu(false); setReport('time') }}
                  >
                    Totals…
                  </button>
                </>)}
                <div className="my-1 border-t border-slate-100 dark:border-slate-700" />
                <button className="flex items-center gap-2 w-full px-4 py-2.5 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 text-left"
                  style={{ minHeight: 44 }}
                  onClick={() => { setShowReportsMenu(false); navigate('/reports') }}>
                  All reports
                </button>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>

      {/* More: columns, import, export, printouts. The tour's steps point here */}
      <div className="relative" data-tour="add-column">
        <div data-tour="import-btn">
          <button
            data-tour="export-btn"
            onClick={() => { setShowMoreMenu(v => !v); setShowAddColumn(false); setShowManageColumns(false); setShowViewMenu(false); setShowReportsMenu(false) }}
            className="btn-secondary flex items-center gap-2"
            style={{ minHeight: 36, padding: '0 12px', fontSize: 15 }}
            aria-expanded={showMoreMenu}
            aria-haspopup="menu"
          >
            More
            {hiddenColumns.length > 0 && (
              <span className="bg-slate-300 dark:bg-slate-600 text-slate-700 dark:text-slate-200 text-sm font-medium px-1.5 py-0.5 rounded-full">{hiddenColumns.length} hidden</span>
            )}
            <ChevronDown className="w-3.5 h-3.5 opacity-60" />
          </button>
        </div>
        <AnimatePresence>
          {showMoreMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowMoreMenu(false)} />
              <motion.div
                role="menu"
                ref={edgeAwareRefCallback}
                className="absolute left-0 top-full mt-1 w-64 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg py-1 z-50"
                variants={dropdownVariants}
                initial="hidden" animate="visible" exit="exit"
              >
                <p className="px-4 pt-2 pb-1 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400" aria-hidden="true">Columns</p>
                <button role="menuitem" className="flex items-center gap-2 w-full px-4 py-2.5 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 text-left"
                  style={{ minHeight: 44 }}
                  onClick={() => { setShowMoreMenu(false); setShowAddColumn(true) }}>
                  <Plus className="w-4 h-4" />Add a column…
                </button>
                <button role="menuitem" className="flex items-center gap-2 w-full px-4 py-2.5 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 text-left"
                  style={{ minHeight: 44 }}
                  onClick={() => { setShowMoreMenu(false); setShowManageColumns(true) }}>
                  <Columns className="w-4 h-4" /><span className="flex-1">Show or hide columns…</span>
                  {hiddenColumns.length > 0 && <span className="text-sm text-slate-500 dark:text-slate-400">{hiddenColumns.length} hidden</span>}
                </button>
                <div className="my-1 border-t border-slate-100 dark:border-slate-700" />
                <p className="px-4 pt-2 pb-1 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400" aria-hidden="true">Bring in and send out</p>
                <button role="menuitem" className="flex items-center gap-2 w-full px-4 py-2.5 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 text-left"
                  style={{ minHeight: 44 }}
                  onClick={() => { setShowMoreMenu(false); setShowImportWizard(true) }}>
                  <Upload className="w-4 h-4" />Import from CSV or Excel…
                </button>
                <button
                  className="flex items-center gap-2 w-full px-4 py-2.5 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 text-left"
                  style={{ minHeight: 44 }}
                  onClick={handleExportCsvStart}
                >
                  Export as CSV
                </button>
                <button
                  className="flex items-center gap-2 w-full px-4 py-2.5 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 text-left"
                  style={{ minHeight: 44 }}
                  onClick={handleExportPdfStart}
                >
                  Export as PDF
                </button>
                {lettersOn && (
                  <button
                    className="flex items-center gap-2 w-full px-4 py-2.5 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 text-left"
                    style={{ minHeight: 44 }}
                    onClick={() => { setShowMoreMenu(false); setBatchDocs(true) }}
                  >
                    Documents and labels…
                  </button>
                )}
              </motion.div>
            </>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {showAddColumn && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowAddColumn(false)} />
              <motion.div
                ref={edgeAwareRefCallback}
                className="absolute left-0 top-full mt-1 w-72 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg p-4 z-50"
                variants={dropdownVariants}
                initial="hidden" animate="visible" exit="exit"
              >
                <form onSubmit={handleAddColumn} className="space-y-3">
                  <div>
                    <label htmlFor="new-col-name" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Column name
                    </label>
                    <input
                      id="new-col-name"
                      ref={colNameInputRef}
                      type="text"
                      className="input"
                      style={{ minHeight: 36 }}
                      value={newColName}
                      onChange={e => setNewColName(e.target.value)}
                      placeholder="e.g. Last Contact Date"
                    />
                  </div>
                  <div>
                    <label htmlFor="new-col-type" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Type
                    </label>
                    <select
                      id="new-col-type"
                      className="input"
                      style={{ minHeight: 36 }}
                      value={newColType}
                      onChange={e => {
                        // A link column is set up in its own dialog (W04 §7.1)
                        if (e.target.value === 'link') { setShowAddColumn(false); setLinkSetup(true); return }
                        setNewColType(e.target.value as ColumnType); setDropdownOptions('')
                        setDeadlineChoice(e.target.value === 'deadline' ? { mode: 'every', n: 12, unit: 'months' } : { mode: 'none' })
                      }}
                    >
                      {COLUMN_TYPES.map(({ type, label }) => (
                        <option key={type} value={type}>{label}</option>
                      ))}
                      {linksOn && <option value="link">Link to another {t('list')}…</option>}
                      {filesOn && <option value="file_count">Files (how many)</option>}
                    </select>
                    {COLUMN_TYPES.find(c => c.type === newColType) && (
                      <p className="mt-1 text-base text-slate-500 dark:text-slate-400">{COLUMN_TYPES.find(c => c.type === newColType)!.description}</p>
                    )}
                  </div>
                  {!linksOn && gridCount > 1 && (
                    <FeatureOffer feature="links" message={`Connect your ${t('list', { many: true })}, like customers and their vehicles?`} />
                  )}

                  {(newColType === 'date' || newColType === 'deadline') && (
                    <DeadlineQuestion type={newColType} value={deadlineChoice} onChange={setDeadlineChoice} />
                  )}

                  {(newColType === 'age_from_dob' || newColType === 'calculated_days') && (
                    <div>
                      <label htmlFor="new-col-source" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">Worked out from</label>
                      <select id="new-col-source" className="input" style={{ minHeight: 36 }} value={sourceColumnId ?? ''} onChange={e => setSourceColumnId(e.target.value ? Number(e.target.value) : null)}>
                        <option value="">Choose a date column…</option>
                        {allColumns.filter(c => c.column_type === 'date').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                      {!allColumns.some(c => c.column_type === 'date') && <p className="mt-1 text-base text-slate-500 dark:text-slate-400">Add a date column first.</p>}
                    </div>
                  )}

                  {(newColType === 'dropdown' || newColType === 'status') && (
                    <div>
                      <label htmlFor="new-col-options" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">
                        {newColType === 'status' ? 'Statuses' : 'Options'} <span className="font-normal text-slate-500 dark:text-slate-400">(one per line)</span>
                      </label>
                      <textarea
                        id="new-col-options"
                        className="input resize-none"
                        rows={4}
                        value={dropdownOptions}
                        onChange={e => setDropdownOptions(e.target.value)}
                        placeholder={newColType === 'status' ? 'Active\nPending\nClosed' : 'Option A\nOption B\nOption C'}
                        style={{ minHeight: 'unset', height: 'auto', padding: '8px 12px' }}
                      />
                      {newColType === 'status' && (
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Colors are assigned automatically.</p>
                      )}
                    </div>
                  )}

                  {newColType === 'auto_number' && (
                    <div className="space-y-3">
                      <div className="flex gap-3">
                        <div className="flex-1">
                          <label htmlFor="new-col-prefix" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">
                            Starts with <span className="font-normal text-slate-500 dark:text-slate-400">(optional)</span>
                          </label>
                          <input id="new-col-prefix" className="input" style={{ minHeight: 36 }} maxLength={AUTO_NUMBER_PREFIX_MAX}
                            placeholder="e.g. J-" value={autoPrefix} onChange={e => setAutoPrefix(e.target.value)} />
                        </div>
                        <div className="w-28">
                          <label htmlFor="new-col-pad" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">Digits</label>
                          <select id="new-col-pad" className="input" style={{ minHeight: 36 }} value={autoPad} onChange={e => setAutoPad(Number(e.target.value))}>
                            {[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}</option>)}
                          </select>
                        </div>
                      </div>
                      <p className="text-sm text-slate-600 dark:text-slate-300">
                        Each new {t('record')} gets the next number: {formatAutoNumber({ prefix: autoPrefix, pad: autoPad }, 1)}, {formatAutoNumber({ prefix: autoPrefix, pad: autoPad }, 2)}…
                      </p>
                      {rowCount > 0 && (
                        <label className="flex items-center gap-2 text-base text-slate-700 dark:text-slate-300 cursor-pointer" style={{ minHeight: 44 }}>
                          <input type="checkbox" className="w-5 h-5" checked={numberExisting} onChange={e => setNumberExisting(e.target.checked)} />
                          Number the {t('record', { many: true })} already in this {t('list')}
                        </label>
                      )}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button type="submit" className="btn-primary flex-1" style={{ minHeight: 36, fontSize: 15 }}>
                      Add
                    </button>
                    <button
                      type="button"
                      className="btn-secondary flex-1"
                      style={{ minHeight: 36, fontSize: 15 }}
                      onClick={() => setShowAddColumn(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </motion.div>
            </>
          )}
        </AnimatePresence>
          <AnimatePresence>
            {showManageColumns && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowManageColumns(false)} />
                <motion.div
                  ref={edgeAwareRefCallback}
                  className="absolute left-0 top-full mt-1 w-64 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg py-2 z-50"
                  variants={dropdownVariants}
                  initial="hidden" animate="visible" exit="exit"
                >
                  <p className="px-3 pb-2 text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                    All columns
                  </p>
                  <div className="max-h-72 overflow-y-auto">
                    {allColumns.map(col => {
                      const isVisible = col.is_visible !== 0
                      return (
                        <button
                          key={col.id}
                          className="hit-44 flex items-center gap-3 w-full px-3 py-2 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 text-left"
                          onClick={() => toggleColumnVisibility(col.id, !isVisible)}
                        >
                          {isVisible
                            ? <Eye className="w-4 h-4 text-blue-500 flex-shrink-0" />
                            : <EyeOff className="w-4 h-4 text-slate-500 dark:text-slate-400 flex-shrink-0" />}
                          <span className={isVisible ? '' : 'text-slate-500 dark:text-slate-400 line-through'}>
                            {col.name}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>
      </div>

      {ruleEditorFor !== null && (
        <AlertRuleEditor columnId={ruleEditorFor} onClose={async createdRuleId => {
          const colId = ruleEditorFor
          setRuleEditorFor(null)
          if (!createdRuleId) return
          const col = useGridStore.getState().columns.find(c => c.id === colId)
          let cfg: Record<string, unknown> = {}
          try { cfg = JSON.parse(col?.config || '{}') as Record<string, unknown> } catch { /* start fresh */ }
          const rule = useAlertStore.getState().rules.find(r => r.id === createdRuleId)
          // A rule that reads the done date needs a Deadline column (Decision E1)
          const toDeadline = col?.column_type === 'date' && !!rule && needsDeadlineColumn(engineRuleFrom(rule))
          await updateColumn(colId, { config: JSON.stringify({ ...cfg, alert_rule_id: createdRuleId }), ...(toDeadline ? { column_type: 'deadline' } : {}) })
        }} />
      )}

      <div className="flex-1" />

      <Tooltip content={`${t('list', { cap: true })} settings: name, words, how names show`} placement="bottom">
        <button
          type="button"
          onClick={() => setShowListSettings(true)}
          className="btn-secondary hit-44 flex items-center justify-center"
          style={{ minHeight: 36, minWidth: 44, padding: '0 10px', fontSize: 15 }}
          aria-label={`${t('list', { cap: true })} settings`}
        >
          <Settings2 className="w-5 h-5" />
        </button>
      </Tooltip>
      {showListSettings && activeGridId != null && (
        <ListSettingsDialog gridId={activeGridId} onClose={() => setShowListSettings(false)}
          onOpenRequirements={() => { setShowListSettings(false); setShowRequirements(true) }} />
      )}
      {showRequirements && activeGridId != null && (
        <ContactRequirementsDialog gridId={activeGridId} gridName={activeGridName ?? ''} onClose={() => setShowRequirements(false)} />
      )}

      {report === 'compliance' && activeGridId != null && <ComplianceSummaryDialog gridId={activeGridId} gridName={activeGridName} onClose={closeReport} />}
      {report === 'missing' && activeGridId != null && <MissingInfoDialog gridId={activeGridId} onClose={closeReport} />}
      {report === 'time' && activeGridId != null && <TotalsDialog gridId={activeGridId} onClose={closeReport} />}
      {report === 'audit' && activeGridId != null && <AuditReportDialog gridId={activeGridId} label={activeGridName ?? `This ${t('list')}`} onClose={closeReport} />}

      {/* Supervisor Report dialog */}
      {showSupervisorReport && activeGridId != null && (
        <SupervisorReportDialog
          gridId={activeGridId}
          columns={allColumns}
          onClose={() => setShowSupervisorReport(false)}
        />
      )}

      {/* Import wizard overlay */}
      {showImportWizard && activeGridId != null && (
        <ImportWizard
          open={showImportWizard}
          gridId={activeGridId}
          onClose={() => setShowImportWizard(false)}
          onImported={() => {
            setShowImportWizard(false)
            // Reload grid after import
            useGridStore.getState().loadGrid(activeGridId)
          }}
        />
      )}

      {/* Column select dialog for exports */}
      <ColumnSelectDialog
        open={exportColumnSelect != null}
        columns={allColumns.map(c => ({ id: c.id, name: c.name, hidden: c.is_visible === 0 }))}
        rowScope={scopeCounts}
        onConfirm={handleExportWithColumns}
        onCancel={() => setExportColumnSelect(null)}
        title={exportColumnSelect === 'csv' ? 'Select Columns for CSV Export' : 'Select Columns for PDF Export'}
        pdfPreview={exportColumnSelect === 'pdf' ? { rowCount: pdfRowCount, orientation: 'landscape' } : undefined}
      />

      {linkSetup && activeGridId != null && <LinkSetupDialog mode="create" gridId={activeGridId} onClose={() => setLinkSetup(false)} />}
      {batchDocs && activeGridId != null && <BatchDocumentsDialog gridId={activeGridId} rowIds={selectedIds.size ? [...selectedIds] : undefined} onClose={() => setBatchDocs(false)} />}
    </div>
  )
}
