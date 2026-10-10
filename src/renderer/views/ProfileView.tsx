import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useGridStore } from '../stores/gridStore'
import { useProfileStore } from '../stores/profileStore'
import { useAlertStore } from '../stores/alertStore'
import { CollapsibleSection } from '../components/shared/CollapsibleSection'
import { ProfileHeader } from '../components/profile/ProfileHeader'
import { DeadlinePanel } from '../components/profile/DeadlinePanel'
import { ContactStatusLine } from '../components/contact-req/ContactStatusLine'
import { AuditReportDialog } from '../components/shared/AuditReportDialog'
import { HandoffDialog } from '../components/profile/HandoffDialog'
import { Checklist } from '../components/profile/Checklist'
import { ScratchPad } from '../components/profile/ScratchPad'
import { CaseLog } from '../components/profile/CaseLog'
import { GridDataSummary } from '../components/profile/GridDataSummary'
import { LinkedProviders } from '../components/profile/LinkedProviders'
import { ActivityTimeline } from '../components/profile/ActivityTimeline'
import { IPC } from '../../shared/ipc-channels'
import { safeInvoke } from '../utils/safeInvoke'
import toast from 'react-hot-toast'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { ProfilePrintLayout } from '../components/profile/ProfilePrintLayout'
import type { GridRow, SaveDialogResult, LetterTemplate } from '../../shared/types'
import { useCopyFeedback } from '../hooks/useCopyFeedback'
import { Tooltip } from '../components/shared/Tooltip'
import { clientFileName, noteUnencryptedExport } from '../utils/exportNotice'
import { useRecordKind } from '../hooks/useRecordKind'
import { useVocab } from '../hooks/useVocab'
import { useFeature } from '../hooks/useFeature'
import { useLinkStore } from '../stores/linkStore'
import { LinkedRecords } from '../components/profile/LinkedRecords'
import { UnknownPlaceholders } from '../components/shared/UnknownPlaceholders'
import { StageHistory } from '../components/profile/StageHistory'
import { RecordAppointments } from '../components/profile/RecordAppointments'
import { RecordFiles } from '../components/profile/RecordFiles'
import { useFormStore } from '../stores/formStore'
import { pulseEvents } from '../events'
import type { Form } from '../../shared/forms'
import { stageColumnOf } from '../../shared/stages'
import { escapeBelongsElsewhere } from '../utils/domHelpers'

function GenerateLetterModal({ rowId, gridId, clientName, onClose }: {
  rowId: number; gridId: number; clientName: string; onClose: () => void
}): React.ReactElement {
  const [templates, setTemplates] = useState<LetterTemplate[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [generated, setGenerated] = useState<string | null>(null)
  const [unknown, setUnknown] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const { copied, copyToClipboard } = useCopyFeedback()
  const trapRef = useRef<HTMLDivElement>(null)

  useFocusTrap(trapRef, true)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    safeInvoke<LetterTemplate[]>(IPC.LETTER_TEMPLATE_GET_ALL).then(r => {
      if (r.ok) { setTemplates(r.data); if (r.data.length > 0) setSelectedId(r.data[0]!.id) }
    }).finally(() => setLoading(false))
  }, [])

  async function handleGenerate() {
    if (!selectedId) return
    setGenerating(true)
    try {
      const res = await safeInvoke<{ text: string; unknown: string[] }>(IPC.LETTER_TEMPLATE_GENERATE, selectedId, rowId, gridId)
      if (res.ok) { setGenerated(res.data.text); setUnknown(res.data.unknown) }
      else toast.error('Could not generate letter')
    } finally {
      setGenerating(false)
    }
  }

  function handleCopy() {
    if (generated) {
      void copyToClipboard(generated)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="generate-letter-title">
      <div ref={trapRef} className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
          <h2 id="generate-letter-title" className="text-lg font-semibold text-slate-800 dark:text-slate-100">Generate Letter — {clientName}</h2>
          <button onClick={onClose} className="hit-44 p-1.5 rounded-sm hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500" aria-label="Close" title="Close"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {loading ? (
            <p className="text-slate-500">Loading templates…</p>
          ) : templates.length === 0 ? (
            <p className="text-slate-500">No letter templates found. Create one in the Letters section.</p>
          ) : !generated ? (
            <>
              <div>
                <label htmlFor="profile-template-select" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-2">Select a template</label>
                <select
                  id="profile-template-select"
                  className="input w-full"
                  style={{ minHeight: 44, fontSize: 15 }}
                  value={selectedId ?? ''}
                  onChange={e => setSelectedId(Number(e.target.value))}
                >
                  {templates.map(t => (
                    <option key={t.id} value={t.id}>{t.name}{t.is_system ? ' (Built-in)' : ''}</option>
                  ))}
                </select>
              </div>
              {selectedId && (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {templates.find(t => t.id === selectedId)?.description}
                </p>
              )}
            </>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Generated letter:</p>
                <button onClick={() => setGenerated(null)} className="hit-44 text-base text-blue-600 hover:underline">Change template</button>
              </div>
              <UnknownPlaceholders unknown={unknown} />
              <textarea
                readOnly
                value={generated}
                className="w-full font-mono text-base bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-4 resize-none"
                rows={18}
                style={{ fontSize: 15 }}
              />
            </>
          )}
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-700 flex-shrink-0">
          <button onClick={onClose} className="btn-secondary" style={{ minHeight: 44 }}>Close</button>
          {!generated ? (
            <button
              onClick={handleGenerate}
              disabled={!selectedId || generating}
              className="btn-primary disabled:opacity-50"
              style={{ minHeight: 44 }}
            >
              {generating ? 'Generating…' : 'Generate'}
            </button>
          ) : (
            <button onClick={handleCopy} className="btn-primary" style={{ minHeight: 44 }}>
              {copied ? 'Copied!' : 'Copy to Clipboard'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

const NO_FORMS: Form[] = []

export default function ProfileView(): React.ReactElement {
  const showChecklists = useFeature('checklists')
  const showLetters = useFeature('letters')
  const handoffOn = useFeature('handoff')
  const showRequirements = useFeature('requirements')
  const showContacts = useFeature('contactsDirectory')
  const { t } = useVocab()
  const recordKind = useRecordKind()
  const { rowId: rowIdStr } = useParams<{ rowId: string }>()
  const parsedRowId = rowIdStr ? parseInt(rowIdStr, 10) : null
  const rowId = parsedRowId !== null && !isNaN(parsedRowId) ? parsedRowId : null
  const navigate = useNavigate()

  // Redirect to grid if rowId is invalid (e.g. /profile/abc)
  useEffect(() => {
    if (rowIdStr && rowId === null) {
      toast.error(`That ${t('record')} link isn't valid — going back to the grid.`)
      navigate('/')
    }
  }, [rowIdStr, rowId, navigate])
  const [searchParams] = useSearchParams()

  const checklistFocusRef = useRef<(() => void) | null>(null)
  const [showLetterModal, setShowLetterModal] = useState(false)
  const [showAuditTrail, setShowAuditTrail] = useState(false)
  const closeAuditTrail = useCallback(() => setShowAuditTrail(false), [])
  const [showHandoff, setShowHandoff] = useState(false)
  const closeHandoff = useCallback(() => setShowHandoff(false), [])
  const [showPrintLayout, setShowPrintLayout] = useState(false)

  const { rows, columns, hiddenColumns, grids, activeGridId, sortedRowIds } = useGridStore(useShallow(s => ({
    rows: s.rows, columns: s.columns, hiddenColumns: s.hiddenColumns,
    grids: s.grids, activeGridId: s.activeGridId, sortedRowIds: s.sortedRowIds,
  })))
  const { updateRow, updateCell, loadGrid } = useGridStore(useShallow(s => ({
    updateRow: s.updateRow, updateCell: s.updateCell, loadGrid: s.loadGrid,
  })))
  const { addRecentProfile } = useProfileStore(useShallow(s => ({
    addRecentProfile: s.addRecentProfile,
  })))
  const { rules: alertRules, isLoaded: alertsLoaded, loadRules } = useAlertStore(useShallow(s => ({
    rules: s.rules, isLoaded: s.isLoaded, loadRules: s.loadRules,
  })))

  // Load alert rules once (needed for DeadlinePanel color logic)
  useEffect(() => {
    if (!alertsLoaded) void loadRules()
  }, [alertsLoaded, loadRules])

  // Hoist snippets so CaseLog + ScratchPad share one fetch instead of two
  const [snippets, setSnippets] = useState<import('../../shared/types').Snippet[]>([])
  useEffect(() => {
    safeInvoke<import('../../shared/types').Snippet[]>(IPC.SNIPPET_GET_ALL).then(res => {
      if (res.ok) setSnippets(res.data)
    })
  }, [])

  // If navigated from dashboard with a gridId param, switch grids if needed
  useEffect(() => {
    const gridIdParam = searchParams.get('gridId')
    if (gridIdParam) {
      const targetGridId = parseInt(gridIdParam, 10)
      if (!isNaN(targetGridId) && targetGridId !== activeGridId) {
        void loadGrid(targetGridId)
      }
    }
  }, [searchParams, activeGridId, loadGrid])

  const stagesOn = useFeature('stages')
  const apptsOn = useFeature('appointments')
  const filesOn = useFeature('attachments')
  const formsOn = useFeature('forms')
  const profileForms = useFormStore(s => (activeGridId ? s.byGrid[activeGridId] : undefined)) ?? NO_FORMS
  useEffect(() => { if (formsOn && activeGridId) void useFormStore.getState().load(activeGridId) }, [formsOn, activeGridId])
  const stageColumn = stagesOn ? stageColumnOf([...columns, ...hiddenColumns]) : null
  const linksOn = useFeature('links')
  const linkTypesLoaded = useLinkStore(s => s.isLoaded)
  const hasLinkTypes = useLinkStore(s => s.types.some(lt => lt.from_grid_id === activeGridId || lt.to_grid_id === activeGridId))
  useEffect(() => { if (linksOn && !linkTypesLoaded) void useLinkStore.getState().load() }, [linksOn, linkTypesLoaded])

  const activeGrid = grids.find(g => g.id === activeGridId)
  const nameCol = columns.find(c => c.is_name_column === 1)

  // Find the row in the loaded grid data
  const row = rowId != null ? rows.find(r => r.row_id === rowId) : undefined

  const knownName = useMemo(() => {
    if (!row || !nameCol) return null
    return (row[`col_${nameCol.id}` as keyof GridRow] as string | null) ?? null
  }, [row, nameCol])
  const clientName = knownName ?? `Unknown ${t('record')}`

  // Track as recently visited
  useEffect(() => {
    if (rowId == null || !activeGrid || knownName == null) return
    addRecentProfile({
      rowId,
      gridId: activeGrid.id,
      name: clientName,
      gridName: activeGrid.name,
      visitedAt: new Date().toISOString(),
    })
  }, [rowId, knownName]) // Re-run when the name loads

  // Prev / Next based on sortedRowIds
  const currentIndex = rowId != null ? sortedRowIds.indexOf(rowId) : -1
  const total = sortedRowIds.length
  const prevRowId = currentIndex > 0 ? sortedRowIds[currentIndex - 1] : null
  const nextRowId = currentIndex < total - 1 ? sortedRowIds[currentIndex + 1] : null

  const handleRowUpdate = useCallback(
    (updates: Partial<{ is_starred: 0 | 1 }>) => {
      if (rowId != null) void updateRow(rowId, updates)
    },
    [rowId, updateRow]
  )

  const handleDateSave = useCallback(
    async (columnId: number, value: string | null) => {
      if (rowId != null) await updateCell(rowId, columnId, value)
    },
    [rowId, updateCell]
  )

  async function handleExportPdf() {
    if (!rowId || !activeGridId) return
    const saveRes = await safeInvoke<SaveDialogResult>(IPC.APP_SHOW_SAVE_DIALOG, {
      title: 'Export Profile as PDF',
      defaultPath: clientFileName(clientName, 'profile', 'pdf', recordKind),
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
    })
    if (!saveRes.ok || saveRes.data.canceled || !saveRes.data.filePath) return
    const result = await safeInvoke<boolean>(IPC.EXPORT_PDF_PROFILE, {
      rowId,
      gridId: activeGridId,
      destPath: saveRes.data.filePath,
      includeSections: { deadlines: true, checklist: true, caseLog: true, scratchPad: true, contactInfo: true, gridData: true }
    })
    if (!result.ok) toast.error('We couldn\'t export this profile. Please try again.')
    else noteUnencryptedExport()
  }

  const goBack = useCallback(() => {
    navigate('/grid')
  }, [navigate])

  function goPrev() {
    if (prevRowId != null) navigate(`/profile/${prevRowId}`)
  }

  function goNext() {
    if (nextRowId != null) navigate(`/profile/${nextRowId}`)
  }

  // Refs to avoid stale closures in keyboard handler
  const prevRowIdRef = useRef(prevRowId)
  const nextRowIdRef = useRef(nextRowId)
  const showLetterModalRef = useRef(showLetterModal)
  const showPrintLayoutRef = useRef(showPrintLayout)
  useEffect(() => { prevRowIdRef.current = prevRowId }, [prevRowId])
  useEffect(() => { nextRowIdRef.current = nextRowId }, [nextRowId])
  useEffect(() => { showLetterModalRef.current = showLetterModal }, [showLetterModal])
  useEffect(() => { showPrintLayoutRef.current = showPrintLayout }, [showPrintLayout])

  // Keyboard shortcuts: Escape → back, Alt+Left/Right → prev/next
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        // Escape that closes a menu, cancels an edit or closes a dialog must not
        // also leave the page and drop what was typed (R-01).
        if (escapeBelongsElsewhere(e)) return
        if (showLetterModalRef.current || showPrintLayoutRef.current) return
        goBack()
      } else if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault()
        if (prevRowIdRef.current != null) navigate(`/profile/${prevRowIdRef.current}`)
      } else if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault()
        if (nextRowIdRef.current != null) navigate(`/profile/${nextRowIdRef.current}`)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [navigate, goBack])

  // Restore scroll position when returning to grid — stored in profileStore
  // (Grid view reads savedScrollTop on mount)

  if (rowId == null) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500">
        Invalid profile link.
      </div>
    )
  }

  if (!row) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500">
        {t('record', { cap: true })} not found — it may have been archived or deleted.
        <button
          onClick={goBack}
          className="hit-44 ml-4 text-blue-600 hover:underline focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 rounded-sm"
        >
          Return to grid
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Navigation bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex-shrink-0 flex-wrap"
        style={{ minHeight: 48 }}
      >
        {/* Back button */}
        <Tooltip content="Back to grid (Escape)" placement="bottom">
          <button
            onClick={goBack}
            className="hit-44 flex items-center gap-1 text-base text-slate-600 dark:text-slate-400
                       hover:text-slate-900 dark:hover:text-slate-100
                       focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 rounded-sm px-1"
            title="Back to grid (Escape)"
          >
            <ChevronLeft className="w-4 h-4" />
            Grid
          </button>
        </Tooltip>

        <span className="text-slate-300 dark:text-slate-500">|</span>

        {/* Prev/Next */}
        <div className="flex items-center gap-1">
          <Tooltip content={`Previous ${t('record')} (Alt+Left)`} placement="bottom">
            <button
              onClick={goPrev}
              disabled={prevRowId == null}
              className="hit-44 p-1 rounded-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200
                         disabled:opacity-30 disabled:cursor-not-allowed
                         focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
              title={`Previous ${t('record')} (Alt+←)`}
              aria-label={`Previous ${t('record')} (Alt+←)`}
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          </Tooltip>

          {total > 0 && (
            <span className="text-sm text-slate-500 dark:text-slate-400 tabular-nums select-none" style={{ minWidth: '5rem', textAlign: 'center' }}>
              {currentIndex >= 0 ? `${currentIndex + 1} of ${total}` : `— of ${total}`}
            </span>
          )}

          <Tooltip content={`Next ${t('record')} (Alt+Right)`} placement="bottom">
            <button
              onClick={goNext}
              disabled={nextRowId == null}
              className="hit-44 p-1 rounded-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200
                         disabled:opacity-30 disabled:cursor-not-allowed
                         focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
              title={`Next ${t('record')} (Alt+→)`}
              aria-label={`Next ${t('record')} (Alt+→)`}
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </Tooltip>
        </div>

        <span className="text-sm text-slate-500 dark:text-slate-400 select-none ml-1">
          Alt+←/→ to navigate
        </span>
      </div>

      {/* Profile content area — two independent scroll regions */}
      <div className="flex-1 flex overflow-hidden">

        {/* Left sidebar — Checklist + ScratchPad, scrolls independently */}
        <div className="w-1/4 min-w-[260px] flex-shrink-0 flex flex-col border-r border-slate-200 dark:border-slate-700 overflow-y-auto no-scrollbar bg-slate-50 dark:bg-slate-800/50">
          <div className="p-4 space-y-4">
            {/* 3.4 — Checklist */}
            {showChecklists && (
              <div data-tour="checklist" title={`Checklist — track tasks for this ${t('record')}`}>
                <Checklist rowId={rowId} clientName={clientName} focusAddRef={checklistFocusRef} />
              </div>
            )}

            {/* 3.5 — Scrap Notes */}
            <div data-tour="scratch-pad" title={`Scratch pad — quick notes for this ${t('record')}`}>
              <ScratchPad rowId={rowId} clientName={clientName} snippets={snippets} />
            </div>
          </div>
        </div>

        {/* Main column — scrolls independently */}
        <div className="flex-1 overflow-y-auto no-scrollbar">
          <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">
            {/* 3.2 — Profile Header */}
            <ProfileHeader
              row={row}
              columns={[...columns, ...hiddenColumns]}
              gridId={activeGridId!}
              onRowUpdate={handleRowUpdate}
              onAddTask={showChecklists ? () => checklistFocusRef.current?.() : undefined}
              onPrint={() => setShowPrintLayout(true)}
              onExportPdf={handleExportPdf}
              onGenerateLetter={showLetters ? () => setShowLetterModal(true) : undefined}
              onAuditTrail={() => setShowAuditTrail(true)}
              onHandoff={handoffOn ? () => setShowHandoff(true) : undefined}
            />

            {activeGridId && showRequirements && <ContactStatusLine rowId={rowId} gridId={activeGridId} />}

            {/* W08 — Fill a form for this record */}
            {formsOn && activeGridId && profileForms.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base text-slate-600 dark:text-slate-300">Fill in a form:</span>
                {profileForms.map(f => (
                  <button key={f.id} type="button" className="btn-compact-secondary"
                    onClick={() => pulseEvents.emit('form:fill', { formId: f.id, gridId: activeGridId, rowId })}>{f.name}</button>
                ))}
              </div>
            )}

            {/* 3.3 — Deadline Panel */}
            <div data-tour="deadline-panel" title="Deadlines — upcoming dates and alerts">
            <DeadlinePanel
              row={row}
              columns={[...columns, ...hiddenColumns]}
              alertRules={alertRules}
              onDateSave={handleDateSave}
            />
            </div>

            {/* W09 — Files */}
            {filesOn && (
              <CollapsibleSection title="Files" sectionKey="profile-files" defaultExpanded>
                <RecordFiles rowId={rowId} />
              </CollapsibleSection>
            )}

            {/* W07 — Appointments */}
            {apptsOn && activeGridId && (
              <CollapsibleSection title={t('appointment', { many: true, cap: true })} sectionKey="profile-appointments" defaultExpanded>
                <RecordAppointments rowId={rowId} gridId={activeGridId} name={clientName} />
              </CollapsibleSection>
            )}

            {/* W06 — Stage history */}
            {stageColumn && activeGridId && (
              <CollapsibleSection title={`${stageColumn.name} history`} sectionKey="profile-stage-history" defaultExpanded={false}>
                <StageHistory gridId={activeGridId} columnId={stageColumn.id} columnName={stageColumn.name} rowId={rowId}
                  value={(row[`col_${stageColumn.id}` as keyof typeof row] as string | null) ?? null} />
              </CollapsibleSection>
            )}

            {/* W04 — Linked records */}
            {linksOn && hasLinkTypes && (
              <CollapsibleSection title="Linked" sectionKey="profile-linked-records" defaultExpanded>
                <LinkedRecords rowId={rowId} />
              </CollapsibleSection>
            )}

            {/* 7.x — Linked Providers */}
            {activeGridId && showContacts && (
              <CollapsibleSection title={`Linked ${t('contact', { many: true, cap: true })}`} sectionKey="profile-linked-providers" defaultExpanded>
                <LinkedProviders rowId={rowId} gridId={activeGridId} />
              </CollapsibleSection>
            )}

            {/* 3.6 — Case Log */}
            <CollapsibleSection title={t('activityLog', { cap: true })} sectionKey="profile-case-log" defaultExpanded>
              <div data-tour="case-log" title={`${t('activityLog', { cap: true })} — chronological record of interactions`}>
                <CaseLog rowId={rowId} clientName={clientName} snippets={snippets} />
              </div>
            </CollapsibleSection>

            {/* 3.10 — Grid Data Summary */}
            <CollapsibleSection title={`${t('record', { cap: true })} details`} sectionKey="profile-client-data" defaultExpanded>
              <GridDataSummary
                row={row}
                columns={[...columns, ...hiddenColumns]}
                alertRules={alertRules}
                gridId={activeGridId!}
                onCellSave={updateCell}
              />
            </CollapsibleSection>

          </div>
        </div>

        {/* Right sidebar — Activity Timeline, scrolls independently */}
        <div className="w-1/4 min-w-[260px] flex-shrink-0 flex flex-col border-l border-slate-200 dark:border-slate-700 overflow-y-auto no-scrollbar bg-slate-50 dark:bg-slate-800/50">
          <div className="p-4">
            {/* 3.9 — Activity Timeline */}
            <ActivityTimeline rowId={rowId} />
          </div>
        </div>

      </div>

      {/* Generate Letter modal */}
      {showHandoff && rowId != null && activeGridId != null && (
        <HandoffDialog rowId={rowId} gridId={activeGridId} clientName={clientName} onClose={closeHandoff} />
      )}
      {showAuditTrail && rowId != null && (
        <AuditReportDialog rowId={rowId} label={clientName} onClose={closeAuditTrail} />
      )}
      {showLetterModal && rowId != null && activeGridId != null && (
        <GenerateLetterModal
          rowId={rowId}
          gridId={activeGridId}
          clientName={clientName}
          onClose={() => setShowLetterModal(false)}
        />
      )}

      {/* Print layout overlay */}
      {showPrintLayout && rowId != null && activeGridId != null && (
        <ProfilePrintLayout
          rowId={rowId}
          gridId={activeGridId}
          clientName={clientName}
          onClose={() => setShowPrintLayout(false)}
        />
      )}
    </div>
  )
}
