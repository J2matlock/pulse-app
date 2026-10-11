import { useNavigate } from 'react-router-dom'
import React, { useCallback, useState, useRef, useEffect, useMemo } from 'react'
import { edgeAwareRefCallback } from '../../utils/domHelpers'
import { AnimatePresence, motion } from 'motion/react'
import { Plus, Columns, Eye, EyeOff, Download, Upload, ChevronDown, Archive, Gauge, Settings2, ClipboardPen } from 'lucide-react'
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
import { ColumnSelectDialog } from '../shared/ColumnSelectDialog'
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
import { AUTO_NUMBER_PREFIX_MAX, DEFAULT_AUTO_NUMBER, formatAutoNumber, parseAutoNumberConfig } from '../../../shared/autoNumber'

const EMPTY_FORMS: Form[] = []

const COLUMN_TYPES: Array<{ type: ColumnType; label: string }> = [
  { type: 'text', label: 'Text' },
  { type: 'number', label: 'Number' },
  { type: 'date', label: 'Date' },
  { type: 'checkbox', label: 'Checkbox' },
  { type: 'dropdown', label: 'Dropdown' },
  { type: 'phone', label: 'Phone' },
  { type: 'email', label: 'Email' },
  { type: 'url', label: 'URL' },
  { type: 'currency', label: 'Currency ($)' },
  { type: 'address', label: 'Address' },
  { type: 'status', label: 'Status (badge)' },
  { type: 'tag', label: 'Tags' },
  { type: 'auto_number', label: 'Auto number (0001, 0002…)' },
  { type: 'deadline', label: 'Deadline (worked out by a rule)' },
]

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
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [showImportWizard, setShowImportWizard] = useState(false)
  const [showSupervisorReport, setShowSupervisorReport] = useState(false)
  const [report, setReport] = useState<'compliance' | 'missing' | 'audit' | 'time' | null>(null)
  const closeReport = useCallback(() => setReport(null), [])
  const [showAcuityPanel, setShowAcuityPanel] = useState(false)
  const [exportColumnSelect, setExportColumnSelect] = useState<'csv' | 'pdf' | null>(null)
  const [newColName, setNewColName] = useState('')
  const [newColType, setNewColType] = useState<ColumnType>('text')
  const [dropdownOptions, setDropdownOptions] = useState('')
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
    setShowExportMenu(false)
    setExportColumnSelect('csv')
  }

  const [pdfRowCount, setPdfRowCount] = useState(0)

  function handleExportPdfStart() {
    setShowExportMenu(false)
    // Read row count from store at open time to avoid subscribing to rows
    setPdfRowCount(useGridStore.getState().rows.length)
    setExportColumnSelect('pdf')
  }

  async function handleExportWithColumns(selectedIds: number[]) {
    const format = exportColumnSelect
    setExportColumnSelect(null)
    if (!activeGridId || !format) return

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
        activeRowIds: [],
        destPath: saveRes.data.filePath,
        dateFormat: 'us'
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
        activeRowIds: [],
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
    } else if (newColType === 'auto_number') {
      config = JSON.stringify(parseAutoNumberConfig({ prefix: autoPrefix, pad: autoPad, next: 1 }))
    }

    await addColumn(name, newColType, config, { numberExisting: rowCount > 0 && numberExisting })
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
      {/* Table / Board (W06) */}
      {stagesOn && hasStage && (
        <div role="group" aria-label="View as" className="flex rounded-lg border border-slate-300 dark:border-slate-600 overflow-hidden">
          {(['table', 'board'] as const).map(mode => (
            <button key={mode} type="button" aria-pressed={viewMode === mode} onClick={() => setViewMode(mode)}
              className={`hit-44 px-3 text-base focus:outline-hidden focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-blue-500 ${
                viewMode === mode ? 'bg-blue-600 text-white font-medium' : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
              }`} style={{ minHeight: 36 }}>
              {mode === 'table' ? 'Table' : 'Board'}
            </button>
          ))}
        </div>
      )}

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

      {/* Add column */}
      <div className="relative" data-tour="add-column">
        <Tooltip content="Add a new column" placement="bottom">
          <button
            onClick={() => { setShowAddColumn(v => !v); setShowManageColumns(false) }}
              className="btn-secondary flex items-center gap-2"
            style={{ minHeight: 36, padding: '0 12px', fontSize: 15 }}
            aria-expanded={showAddColumn}
            aria-label="Add column"
            title="Add a new column"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Column
          </button>
        </Tooltip>

        <AnimatePresence>
          {showAddColumn && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowAddColumn(false)} />
              <motion.div
                ref={edgeAwareRefCallback}
                className="absolute left-0 top-full mt-1 w-64 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg p-4 z-50"
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
                      }}
                    >
                      {COLUMN_TYPES.map(({ type, label }) => (
                        <option key={type} value={type}>{label}</option>
                      ))}
                      {linksOn && <option value="link">Link to another {t('list')}…</option>}
                      {filesOn && <option value="file_count">Files (how many)</option>}
                    </select>
                  </div>
                  {!linksOn && gridCount > 1 && (
                    <FeatureOffer feature="links" message={`Connect your ${t('list', { many: true })}, like customers and their vehicles?`} />
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
      </div>

      {/* Manage columns */}
      {hiddenColumns.length > 0 && (
        <div className="relative">
          <Tooltip content="Show or hide columns" placement="bottom">
            <button
              onClick={() => { setShowManageColumns(v => !v); setShowAddColumn(false) }}
              className="btn-secondary flex items-center gap-2"
              style={{ minHeight: 36, padding: '0 12px', fontSize: 15 }}
              title="Show or hide columns"
              aria-label="Manage columns"
              aria-expanded={showManageColumns}
            >
              <Columns className="w-4 h-4" />
              Columns
            <span className="ml-0.5 bg-slate-300 dark:bg-slate-600 text-slate-700 dark:text-slate-200 text-sm font-medium px-1.5 py-0.5 rounded-full">
              {hiddenColumns.length} hidden
            </span>
            </button>
          </Tooltip>

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
      )}

      {/* Export menu */}
      <div className="relative" data-tour="export-btn">
        <Tooltip content="Export, print and reports" placement="bottom">
          <button
            onClick={() => { setShowExportMenu(v => !v); setShowAddColumn(false); setShowManageColumns(false) }}
            className="btn-secondary flex items-center gap-2"
            style={{ minHeight: 36, padding: '0 12px', fontSize: 15 }}
            title="Export to CSV or PDF"
            aria-label="Export data"
            aria-expanded={showExportMenu}
          >
            <Download className="w-4 h-4" />
            Export
            <ChevronDown className="w-3.5 h-3.5 opacity-60" />
          </button>
        </Tooltip>
        <AnimatePresence>
          {showExportMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowExportMenu(false)} />
              <motion.div
                ref={edgeAwareRefCallback}
                className="absolute right-0 top-full mt-1 w-64 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg py-1 z-50"
                variants={dropdownVariants}
                initial="hidden" animate="visible" exit="exit"
              >
                <p className="px-4 pt-2 pb-1 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400" aria-hidden="true">Export</p>
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
                    onClick={() => { setShowExportMenu(false); setBatchDocs(true) }}
                  >
                    Documents and labels…
                  </button>
                )}
                <div className="my-1 border-t border-slate-100 dark:border-slate-700" />
                <p className="px-4 pt-2 pb-1 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400" aria-hidden="true">Reports</p>
                <button
                  className="flex items-center gap-2 w-full px-4 py-2.5 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 text-left"
                  style={{ minHeight: 44 }}
                  onClick={() => { setShowExportMenu(false); navigate('/reports?new=1') }}
                >
                  Build a report…
                </button>
                {showSummaryReport && (<>
                  <button
                    className="flex items-center gap-2 w-full px-4 py-2.5 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 text-left"
                    style={{ minHeight: 44 }}
                    onClick={() => { setShowExportMenu(false); setShowSupervisorReport(true) }}
                  >
                    Summary report…
                  </button>
                </>)}
                {requirementsOn && (
                <button
                  className="flex items-center gap-2 w-full px-4 py-2.5 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 text-left"
                  style={{ minHeight: 44 }}
                  onClick={() => { setShowExportMenu(false); setReport('compliance') }}
                >
                  {t('requirement', { many: true, cap: true })} summary…
                </button>
                )}
                <button
                  className="flex items-center gap-2 w-full px-4 py-2.5 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 text-left"
                  style={{ minHeight: 44 }}
                  onClick={() => { setShowExportMenu(false); setReport('missing') }}
                >
                  Missing information…
                </button>
                <button
                  className="flex items-center gap-2 w-full px-4 py-2.5 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 text-left"
                  style={{ minHeight: 44 }}
                  onClick={() => { setShowExportMenu(false); setReport('audit') }}
                >
                  Audit trail…
                </button>
                {(timeOn || mileageOn || measuresOn) && (<>
                  <button
                    className="flex items-center gap-2 w-full px-4 py-2.5 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 text-left"
                    style={{ minHeight: 44 }}
                    onClick={() => { setShowExportMenu(false); setReport('time') }}
                  >
                    Totals…
                  </button>
                </>)}
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>

      {/* Import button */}
      <Tooltip content="Import from CSV or Excel" placement="bottom">
        <button
          data-tour="import-btn"
          onClick={() => setShowImportWizard(true)}
          className="btn-secondary flex items-center gap-2"
          style={{ minHeight: 36, padding: '0 12px', fontSize: 15 }}
          title="Import from CSV or Excel"
          aria-label="Import from CSV or Excel"
        >
          <Upload className="w-4 h-4" />
          Import
        </button>
      </Tooltip>

      {/* Filter rows */}
      <FilterControls />

      {/* Saved views */}
      <SavedViewsDropdown />

      {/* Group rows */}
      <GroupingBar />

      {priorityOn && (<>
        {/* Acuity scoring */}
        <div className="relative">
          <Tooltip content={acuityEnabled ? `Set up ${t('priority', { many: true })}` : `Turn on ${t('priority', { many: true })}`} placement="bottom">
            <button
              onClick={() => setShowAcuityPanel(v => !v)}
              className={`btn-secondary flex items-center gap-2 ${acuityEnabled ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-300' : ''}`}
              style={{ minHeight: 36, padding: '0 12px', fontSize: 15 }}
              title={acuityEnabled ? `${t('priority', { many: true, cap: true })} are on — click to set up` : `Turn on ${t('priority', { many: true })}`}
              aria-label={acuityEnabled ? `Set up ${t('priority', { many: true })}` : `Turn on ${t('priority', { many: true })}`}
              aria-pressed={acuityEnabled}
            >
              <Gauge className="w-4 h-4" />
              {t('priority', { cap: true })}
              {acuityEnabled && <AcuityPointsBadge />}
            </button>
          </Tooltip>
          {showAcuityPanel && <AcuityConfigPanel onClose={() => setShowAcuityPanel(false)} />}
        </div>
      </>)}

      {/* Show archived toggle */}
      <Tooltip content={`${showArchived ? 'Hide' : 'Show'} archived ${t('record', { many: true })}`} placement="bottom">
        <button
          data-tour="archived-toggle"
          onClick={() => setShowArchived(!showArchived)}
          className={`btn-secondary flex items-center gap-2 ${showArchived ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300' : ''}`}
          style={{ minHeight: 36, padding: '0 12px', fontSize: 15 }}
          title={`${showArchived ? 'Hide' : 'Show'} archived ${t('record', { many: true })}`}
          aria-label={`${showArchived ? 'Hide' : 'Show'} archived ${t('record', { many: true })}`}
          aria-pressed={showArchived}
        >
          <Archive className="w-4 h-4" />
          {showArchived ? 'Hide Archived' : 'Archived'}
        </button>
      </Tooltip>

      <div className="flex-1" />

      <Tooltip content={`${t('list', { cap: true })} settings: name, words, how names show`} placement="bottom">
        <button
          type="button"
          onClick={() => setShowListSettings(true)}
          className="btn-secondary flex items-center gap-2"
          style={{ minHeight: 36, padding: '0 12px', fontSize: 15 }}
          aria-label={`${t('list', { cap: true })} settings`}
        >
          <Settings2 className="w-4 h-4" />
          {t('list', { cap: true })} settings
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
        columns={allColumns.filter(c => c.is_visible !== 0)}
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
