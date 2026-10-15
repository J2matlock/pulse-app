import { useNavigate } from 'react-router-dom'
import React, { useCallback, useState, useRef, useEffect, useMemo } from 'react'
import { edgeAwareRefCallback } from '../../utils/domHelpers'
import { AnimatePresence, motion } from 'motion/react'
import { Plus, Columns, Eye, EyeOff, Upload, ChevronDown, ChevronRight, Archive, Gauge, Settings2, ClipboardPen, FileBarChart, Tags, Replace } from 'lucide-react'
import { ListSettingsDialog } from './ListSettingsDialog'
import { TOOLBAR_ICON } from './gridConstants'
import { ContactRequirementsDialog } from '../contact-req/ContactRequirementsDialog'
import { useShallow } from 'zustand/react/shallow'
import { useGridStore } from '../../stores/gridStore'
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
import { useMenuKeys, type MenuKeysOptions } from '../../hooks/useMenuKeys'
import { useVocab } from '../../hooks/useVocab'
import { useFeature } from '../../hooks/useFeature'
import { LinkSetupDialog } from '../links/LinkSetupDialog'
import { BatchDocumentsDialog } from '../documents/BatchDocumentsDialog'
import { useFormStore } from '../../stores/formStore'
import { pulseEvents } from '../../events'
import type { Form } from '../../../shared/forms'
import { stageConfigOf } from '../../../shared/stages'
import { AddColumnForm, useAddColumnDraft } from './AddColumnPanel'
import { useGridExport } from '../../hooks/useGridExport'
import { AlertRuleEditor } from '../alerts/AlertRuleEditor'
import { useAlertStore } from '../../stores/alertStore'
import { engineRuleFrom, needsDeadlineColumn } from '../../../shared/deadlineEngine'

/** A toolbar pop-up's ref (kept in view at the window's edge) and its keyboard model (AUDIT-044) */
function useToolbarPopup(open: boolean, close: () => void, options?: MenuKeysOptions & { edgeAware?: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const edgeAware = options?.edgeAware ?? true
  const setRef = useCallback((el: HTMLDivElement | null) => {
    ref.current = el
    if (edgeAware) edgeAwareRefCallback(el)
  }, [edgeAware])
  const onKeyDown = useMenuKeys(ref, open, close, options)
  return { ref: setRef, onKeyDown }
}

/**
 * How much of the toolbar fits on one row (UX-B-08, UX-B-09). Every button keeps its
 * name at every width; what doesn't fit moves into the More menu instead of wrapping
 * onto a second row and costing the list 44px:
 * - wide: everything on the row, the list settings button with its name;
 * - mid (a 1366 laptop): Show, Reports and the list settings go under More;
 * - narrow (that laptop at 125% scaling, or a 1100px window): Add column goes under More too.
 */
export type ToolbarTier = 'wide' | 'mid' | 'narrow'
export function toolbarTierFor(width: number): ToolbarTier {
  return width >= 1400 ? 'wide' : width >= 960 ? 'mid' : 'narrow'
}

function useToolbarTier(ref: React.RefObject<HTMLDivElement | null>): ToolbarTier {
  const [tier, setTier] = useState<ToolbarTier>('wide')
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const update = () => setTier(toolbarTierFor(el.clientWidth))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return tier
}

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

const EMPTY_FORMS: Form[] = []

const MENU_ITEM = 'flex items-center gap-2 w-full px-4 py-2.5 text-base text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 text-left'
const MENU_HEADING = 'px-4 pt-2 pb-1 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400'
const TOOLBAR_BTN: React.CSSProperties = { minHeight: 36, padding: '0 12px', fontSize: 15 }

export function GridToolbar(): React.ReactElement {
  const { t } = useVocab()
  const navigate = useNavigate()
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
  const { addRow, toggleColumnVisibility, setShowArchived } = useGridStore(useShallow(s => ({
    addRow: s.addRow, toggleColumnVisibility: s.toggleColumnVisibility, setShowArchived: s.setShowArchived,
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
  // "More options…": the full rule editor for the column just added
  const [ruleEditorFor, setRuleEditorFor] = useState<number | null>(null)
  const updateColumn = useGridStore(s => s.updateColumn)
  const rowCount = useGridStore(s => s.rows.length)
  const linksOn = useFeature('links')
  const lettersOn = useFeature('letters')
  const formsOn = useFeature('forms')
  const filesOn = useFeature('attachments')
  const [showFormMenu, setShowFormMenu] = useState(false)
  const formMenu = useToolbarPopup(showFormMenu, useCallback(() => setShowFormMenu(false), []), { edgeAware: false })
  const viewMenu = useToolbarPopup(showViewMenu, useCallback(() => setShowViewMenu(false), []))
  const reportsMenu = useToolbarPopup(showReportsMenu, useCallback(() => setShowReportsMenu(false), []))
  const moreMenu = useToolbarPopup(showMoreMenu, useCallback(() => setShowMoreMenu(false), []))
  const addColumnPanel = useToolbarPopup(showAddColumn, useCallback(() => setShowAddColumn(false), []), { kind: 'panel', edgeAware: false })
  const manageColumnsMenu = useToolbarPopup(showManageColumns, useCallback(() => setShowManageColumns(false), []))
  const listForms = useFormStore(s => (activeGridId != null ? s.byGrid[activeGridId] : undefined)) ?? EMPTY_FORMS
  useEffect(() => { if (formsOn && activeGridId != null) void useFormStore.getState().load(activeGridId) }, [formsOn, activeGridId])
  // "Bring in a spreadsheet" from the empty list
  useEffect(() => pulseEvents.on('grid:open-import', () => setShowImportWizard(true)), [])
  // "Add column" from a list with no columns, and the "+" after the last column header (UX-B-03)
  useEffect(() => pulseEvents.on('grid:add-column', () => setShowAddColumn(true)), [])
  const [batchDocs, setBatchDocs] = useState(false)
  const selectedIds = useGridStore(s => s.selectedRowIds)
  const stagesOn = useFeature('stages')
  const viewMode = useGridStore(s => s.viewMode)
  const setViewMode = useGridStore(s => s.setViewMode)
  const showTagsColumn = useGridStore(s => s.showTagsColumn)
  const setShowTagsColumn = useGridStore(s => s.setShowTagsColumn)
  const hasStage = useGridStore(s => s.columns.concat(s.hiddenColumns).some(c => stageConfigOf(c) !== null))
  const gridCount = useGridStore(s => s.grids.length)
  const [linkSetup, setLinkSetup] = useState(false)
  const {
    exportColumnSelect, setExportColumnSelect, scopeCounts, pdfRowCount,
    handleExportCsvStart, handleExportPdfStart, handleExportWithColumns,
  } = useGridExport({ activeGridId, closeMenu: () => setShowMoreMenu(false) })
  const addColumnDraft = useAddColumnDraft({
    open: showAddColumn, rowCount, onAdded: () => setShowAddColumn(false), onMoreOptions: setRuleEditorFor,
  })

  const toolbarRef = useRef<HTMLDivElement | null>(null)
  const tier = useToolbarTier(toolbarRef)
  // What moves under More when the row is too short for it
  const foldShowReports = tier !== 'wide'
  const foldAddColumn = tier === 'narrow'

  const allColumns = useMemo(() => [...columns, ...hiddenColumns].sort((a, b) => a.position - b.position), [columns, hiddenColumns])

  const closeAllMenus = () => { setShowMoreMenu(false); setShowViewMenu(false); setShowReportsMenu(false); setShowAddColumn(false); setShowManageColumns(false) }
  const showChanged = showArchived || viewMode === 'board'

  // ── The Show menu (F-03: its items all start "Show…", so that's its name) ──
  const showMenuPanel = showViewMenu && (
    <>
      <div className="fixed inset-0 z-40" onClick={() => setShowViewMenu(false)} />
      <div role="menu" aria-label="Show" ref={viewMenu.ref} onKeyDown={viewMenu.onKeyDown} className="absolute left-0 top-full mt-1 w-72 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg py-1 z-50">
        {stagesOn && hasStage && (<>
          <p className={MENU_HEADING} aria-hidden="true">Show as</p>
          {(['table', 'board'] as const).map(mode => (
            <button key={mode} role="menuitemradio" aria-checked={viewMode === mode} className={MENU_ITEM}
            style={{ minHeight: 44 }}
              onClick={() => { setViewMode(mode); setShowViewMenu(false) }}>
              <span className="w-4">{viewMode === mode ? '✓' : ''}</span>{mode === 'table' ? 'Table' : 'Board'}
            </button>
          ))}
          <div className="my-1 border-t border-slate-100 dark:border-slate-700" />
        </>)}
        {viewMode !== 'board' && (
          <button role="menuitemcheckbox" aria-checked={showTagsColumn} className={MENU_ITEM}
            style={{ minHeight: 44 }}
            onClick={() => { setShowTagsColumn(!showTagsColumn); setShowViewMenu(false) }}>
            <Tags className="w-4 h-4" />
            <span className="flex-1">Show the Tags column</span>
            {showTagsColumn && <span aria-hidden="true">✓</span>}
          </button>
        )}
        <button role="menuitemcheckbox" aria-checked={showArchived} className={MENU_ITEM}
            style={{ minHeight: 44 }}
          onClick={() => { setShowArchived(!showArchived); setShowViewMenu(false) }}>
          <Archive className="w-4 h-4" />
          <span className="flex-1">Show archived {t('record', { many: true })}</span>
          {showArchived && <span aria-hidden="true">✓</span>}
        </button>
        {priorityOn && (
          <button role="menuitem" className={MENU_ITEM}
            style={{ minHeight: 44 }}
            onClick={() => { setShowViewMenu(false); setShowAcuityPanel(true) }}>
            <Gauge className="w-4 h-4" />
            <span className="flex-1">{acuityEnabled ? `${t('priority', { many: true, cap: true })}…` : `Turn on ${t('priority', { many: true })}…`}</span>
            {acuityEnabled && <AcuityPointsBadge />}
          </button>
        )}
      </div>
    </>
  )

  // ── The Reports menu ──
  const reportsMenuPanel = (
    <AnimatePresence>
      {showReportsMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowReportsMenu(false)} />
          <motion.div
            role="menu"
            aria-label="Reports"
            ref={reportsMenu.ref}
            onKeyDown={reportsMenu.onKeyDown}
            className="absolute left-0 top-full mt-1 w-72 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg py-1 z-50"
            variants={dropdownVariants}
            initial="hidden" animate="visible" exit="exit"
          >
            <button role="menuitem" className={MENU_ITEM} style={{ minHeight: 44 }}
              onClick={() => { setShowReportsMenu(false); navigate('/reports?new=1') }}>
              Build a report…
            </button>
            {showSummaryReport && (
              <button role="menuitem" className={MENU_ITEM} style={{ minHeight: 44 }}
                onClick={() => { setShowReportsMenu(false); setShowSupervisorReport(true) }}>
                Summary report…
              </button>
            )}
            {requirementsOn && (
              <button role="menuitem" className={MENU_ITEM} style={{ minHeight: 44 }}
                onClick={() => { setShowReportsMenu(false); setReport('compliance') }}>
                {t('requirement', { many: true, cap: true })} summary…
              </button>
            )}
            <button role="menuitem" className={MENU_ITEM} style={{ minHeight: 44 }}
              onClick={() => { setShowReportsMenu(false); setReport('missing') }}>
              Missing information…
            </button>
            <button role="menuitem" className={MENU_ITEM} style={{ minHeight: 44 }}
              onClick={() => { setShowReportsMenu(false); setReport('audit') }}>
              History of changes (PDF)…
            </button>
            {(timeOn || mileageOn || measuresOn) && (
              <button role="menuitem" className={MENU_ITEM} style={{ minHeight: 44 }}
                onClick={() => { setShowReportsMenu(false); setReport('time') }}>
                Totals…
              </button>
            )}
            <div className="my-1 border-t border-slate-100 dark:border-slate-700" />
            <button role="menuitem" className={MENU_ITEM} style={{ minHeight: 44 }}
              onClick={() => { setShowReportsMenu(false); navigate('/reports') }}>
              All reports
            </button>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )

  const listSettingsLabel = `${t('list', { cap: true })} settings`

  return (
    <div ref={toolbarRef} className="@container flex items-center flex-wrap gap-2 px-4 py-2 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex-shrink-0">
      {/* Up front: Add, the filters, Saved views and Group; then Show, Reports, Add column and More (G-22).
          Every button keeps its name; on a shorter row Show, Reports and the settings fold into More (UX-B-08, UX-B-09) */}
      {/* Add row */}
      <Tooltip content={`Add a new ${t('record')}`} placement="bottom">
        <button
          data-tour="add-client"
          onClick={addRow}
          className="btn-primary flex items-center gap-2"
          style={TOOLBAR_BTN}
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
          <button type="button" className="btn-secondary flex items-center gap-2" style={TOOLBAR_BTN}
            aria-expanded={showFormMenu} aria-haspopup="menu" onClick={() => setShowFormMenu(v => !v)}>
            <ClipboardPen className="w-4 h-4" />Use a form
            <ChevronDown className="w-3.5 h-3.5 opacity-60" />
          </button>
          {showFormMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowFormMenu(false)} />
              <div role="menu" aria-label="Use a form" ref={formMenu.ref} onKeyDown={formMenu.onKeyDown} className="absolute left-0 top-full mt-1 w-64 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg py-1 z-50">
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

      {/* Group rows: the table only; the board groups by stage (G-33) */}
      {viewMode !== 'board' && <GroupingBar />}

      {/* Show: table or board, tags, archived, priority */}
      {!foldShowReports && (
        <div className="relative" data-tour="archived-toggle">
          <button
            onClick={() => { closeAllMenus(); setShowViewMenu(!showViewMenu) }}
            aria-label={showChanged ? 'Show options (some turned on)' : 'Show'} title="Show"
            className="btn-secondary flex items-center gap-2"
            style={TOOLBAR_BTN}
            aria-expanded={showViewMenu}
            aria-haspopup="menu"
          >
            <Eye className={`w-4 h-4 ${TOOLBAR_ICON}`} />
            <span>Show</span>
            {showChanged && <span className="w-2 h-2 rounded-full bg-amber-500" aria-hidden="true" />}
            <ChevronDown className="w-3.5 h-3.5 opacity-60" />
          </button>
          {showMenuPanel}
        </div>
      )}
      {showAcuityPanel && <AcuityConfigPanel onClose={() => setShowAcuityPanel(false)} />}

      {/* Reports */}
      {!foldShowReports && (
        <div className="relative">
          <button
            onClick={() => { closeAllMenus(); setShowReportsMenu(!showReportsMenu) }}
            aria-label="Reports" title="Reports"
            className="btn-secondary flex items-center gap-2"
            style={TOOLBAR_BTN}
            aria-expanded={showReportsMenu}
            aria-haspopup="menu"
          >
            <FileBarChart className={`w-4 h-4 ${TOOLBAR_ICON}`} />
            <span>Reports</span>
            <ChevronDown className="w-3.5 h-3.5 opacity-60" />
          </button>
          {reportsMenuPanel}
        </div>
      )}

      {/* Add column and More share one anchor, so the Add column panel opens under its button (UX-B-03).
          The tour's steps point here */}
      <div className="relative flex items-center gap-2" data-tour="add-column">
        {!foldAddColumn && (
          <Tooltip content="Add a column to this list" placement="bottom">
            <button
              type="button"
              onClick={() => { closeAllMenus(); setShowAddColumn(!showAddColumn) }}
              className="btn-secondary flex items-center gap-2"
              style={TOOLBAR_BTN}
              aria-expanded={showAddColumn}
              aria-haspopup="dialog"
            >
              <Plus className={`w-4 h-4 ${TOOLBAR_ICON}`} />
              Add column
            </button>
          </Tooltip>
        )}
        <div data-tour="import-btn">
          <button
            data-tour="export-btn"
            onClick={() => { closeAllMenus(); setShowMoreMenu(!showMoreMenu) }}
            className="btn-secondary flex items-center gap-2"
            style={TOOLBAR_BTN}
            aria-expanded={showMoreMenu}
            aria-haspopup="menu"
          >
            More
            {showChanged && foldShowReports && <span className="w-2 h-2 rounded-full bg-amber-500" aria-hidden="true" />}
            <ChevronDown className="w-3.5 h-3.5 opacity-60" />
          </button>
        </div>
        <AnimatePresence>
          {showMoreMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowMoreMenu(false)} />
              <motion.div
                role="menu"
                aria-label="More"
                ref={moreMenu.ref}
                onKeyDown={moreMenu.onKeyDown}
                className="absolute left-0 top-full mt-1 w-80 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg py-1 z-50"
                variants={dropdownVariants}
                initial="hidden" animate="visible" exit="exit"
              >
                {foldShowReports && (<>
                  {/* Folded in from the row: each opens its own menu here */}
                  <button role="menuitem" aria-haspopup="menu" className={MENU_ITEM} style={{ minHeight: 44 }}
                    onClick={() => { setShowMoreMenu(false); setShowViewMenu(true) }}>
                    <Eye className="w-4 h-4" /><span className="flex-1">Show</span>
                    {showChanged && <span className="w-2 h-2 rounded-full bg-amber-500" aria-hidden="true" />}
                    <ChevronRight className="w-4 h-4 opacity-60" />
                  </button>
                  <button role="menuitem" aria-haspopup="menu" className={MENU_ITEM} style={{ minHeight: 44 }}
                    onClick={() => { setShowMoreMenu(false); setShowReportsMenu(true) }}>
                    <FileBarChart className="w-4 h-4" /><span className="flex-1">Reports</span>
                    <ChevronRight className="w-4 h-4 opacity-60" />
                  </button>
                  <div className="my-1 border-t border-slate-100 dark:border-slate-700" />
                </>)}
                <p className={MENU_HEADING} aria-hidden="true">Columns</p>
                {foldAddColumn && (
                  <button role="menuitem" className={MENU_ITEM} style={{ minHeight: 44 }}
                    onClick={() => { setShowMoreMenu(false); setShowAddColumn(true) }}>
                    <Plus className="w-4 h-4" />Add a column…
                  </button>
                )}
                <button role="menuitem" className={MENU_ITEM} style={{ minHeight: 44 }}
                  onClick={() => { setShowMoreMenu(false); setShowManageColumns(true) }}>
                  <Columns className="w-4 h-4" /><span className="flex-1 whitespace-nowrap">Show or hide columns…</span>
                  {hiddenColumns.length > 0 && <span className="text-sm text-slate-500 dark:text-slate-400 whitespace-nowrap">{hiddenColumns.length} hidden</span>}
                </button>
                <button role="menuitem" className={MENU_ITEM} style={{ minHeight: 44 }}
                  onClick={() => { setShowMoreMenu(false); pulseEvents.emit('open-find-replace') }}>
                  <Replace className="w-4 h-4" />Find and replace…
                </button>
                <div className="my-1 border-t border-slate-100 dark:border-slate-700" />
                <p className={MENU_HEADING} aria-hidden="true">Bring in and send out</p>
                <button role="menuitem" className={MENU_ITEM} style={{ minHeight: 44 }}
                  onClick={() => { setShowMoreMenu(false); setShowImportWizard(true) }}>
                  <Upload className="w-4 h-4" />Import from CSV or Excel…
                </button>
                <button role="menuitem" className={MENU_ITEM} style={{ minHeight: 44 }} onClick={handleExportCsvStart}>
                  Save as CSV…
                </button>
                <button role="menuitem" className={MENU_ITEM} style={{ minHeight: 44 }} onClick={handleExportPdfStart}>
                  Save as PDF…
                </button>
                {lettersOn && (
                  <button role="menuitem" className={MENU_ITEM} style={{ minHeight: 44 }}
                    onClick={() => { setShowMoreMenu(false); setBatchDocs(true) }}>
                    Letters and labels…
                  </button>
                )}
                {foldShowReports && (<>
                  <div className="my-1 border-t border-slate-100 dark:border-slate-700" />
                  <button role="menuitem" className={MENU_ITEM} style={{ minHeight: 44 }}
                    onClick={() => { setShowMoreMenu(false); setShowListSettings(true) }}>
                    <Settings2 className="w-4 h-4" />{listSettingsLabel}…
                  </button>
                </>)}
              </motion.div>
            </>
          )}
        </AnimatePresence>
        {foldShowReports && showMenuPanel}
        {foldShowReports && reportsMenuPanel}
        <AnimatePresence>
          {showAddColumn && (
            // A centred dialog, not a pop-up hanging off a button: the toolbar button, the More
            // menu and the "+" after the last header all open it, and nothing shifts (UX-B-03)
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/30" onClick={() => setShowAddColumn(false)} />
              <motion.div
                ref={addColumnPanel.ref}
                onKeyDown={addColumnPanel.onKeyDown}
                role="dialog"
                aria-modal="true"
                aria-label="Add a column"
                className="relative w-full max-w-sm max-h-[90vh] overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl p-5"
                variants={dropdownVariants}
                initial="hidden" animate="visible" exit="exit"
              >
                <AddColumnForm
                  draft={addColumnDraft}
                  allColumns={allColumns}
                  rowCount={rowCount}
                  gridCount={gridCount}
                  linksOn={linksOn}
                  filesOn={filesOn}
                  onLinkColumn={() => { setShowAddColumn(false); setLinkSetup(true) }}
                  onCancel={() => setShowAddColumn(false)}
                />
              </motion.div>
            </div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {showManageColumns && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowManageColumns(false)} />
              <motion.div
                ref={manageColumnsMenu.ref}
                onKeyDown={manageColumnsMenu.onKeyDown}
                role="menu"
                aria-label="Show or hide columns"
                className="absolute left-0 top-full mt-1 w-64 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg py-2 z-50"
                variants={dropdownVariants}
                initial="hidden" animate="visible" exit="exit"
              >
                <p className="px-3 pb-2 text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide" aria-hidden="true">
                  All columns
                </p>
                <div className="max-h-72 overflow-y-auto">
                  {allColumns.map(col => {
                    const isVisible = col.is_visible !== 0
                    return (
                      <button
                        key={col.id}
                        role="menuitemcheckbox"
                        aria-checked={isVisible}
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
          await updateColumn(colId, { config: JSON.stringify({ ...cfg, alert_rule_id: createdRuleId }), ...(toDeadline ? { column_type: 'deadline' } : {}) }, { skipConfirm: true })
        }} />
      )}

      <div className="flex-1" />

      {/* The list's settings, with its name while there's room (UX-B-08) */}
      {!foldShowReports && (
        <Tooltip content={`${listSettingsLabel}: name, words, how names show`} placement="bottom">
          <button
            type="button"
            onClick={() => setShowListSettings(true)}
            className="btn-secondary flex items-center gap-2"
            style={TOOLBAR_BTN}
            aria-label={listSettingsLabel}
          >
            <Settings2 className="w-4 h-4" />
            {listSettingsLabel}
          </button>
        </Tooltip>
      )}
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
