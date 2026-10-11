import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { canGoBack, previousPage } from '../utils/navHistory'
import { pageTitle } from '../components/layout/TopBar'
import { ChevronLeft, ChevronRight } from 'lucide-react'
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
import { IPC } from '../../shared/ipc-channels'
import { safeInvoke } from '../utils/safeInvoke'
import toast from 'react-hot-toast'
import { ProfilePrintLayout } from '../components/profile/ProfilePrintLayout'
import { ProfileExportDialog, type ProfileSections } from '../components/profile/ProfileExportDialog'
import { RecordLetterDialog } from '../components/profile/RecordLetterDialog'
import { ConfirmDialog } from '../components/shared/ConfirmDialog'
import { MoveToGridModal } from '../components/grid/MoveToGridModal'
import { CancelAppointmentsCheckbox, useUpcomingAppointments } from '../components/grid/GridDialogs'
import type { MoreMenuItem } from '../components/profile/ProfileMoreMenu'
import type { GridRow, SaveDialogResult } from '../../shared/types'
import type { RowLocation } from '../../shared/ipc-contract'
import { Tooltip } from '../components/shared/Tooltip'
import { clientFileName, noteUnencryptedExport } from '../utils/exportNotice'
import { useRecordKind } from '../hooks/useRecordKind'
import { useVocab } from '../hooks/useVocab'
import { useFeature } from '../hooks/useFeature'
import { useLinkStore } from '../stores/linkStore'
import { LinkedRecords } from '../components/profile/LinkedRecords'
import { StageHistory } from '../components/profile/StageHistory'
import { RecordAppointments } from '../components/profile/RecordAppointments'
import { RecordFiles } from '../components/profile/RecordFiles'
import { useFormStore } from '../stores/formStore'
import { pulseEvents } from '../events'
import type { Form } from '../../shared/forms'
import { stageColumnOf } from '../../shared/stages'
import { escapeBelongsElsewhere } from '../utils/domHelpers'
import { getClientName } from '../utils/clientName'

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
  const location = useLocation()

  // Redirect to grid if rowId is invalid (e.g. /profile/abc)
  useEffect(() => {
    if (rowIdStr && rowId === null) {
      toast.error(`That ${t('record')} link isn't valid — going back to the ${t('list')}.`)
      navigate('/')
    }
  }, [rowIdStr, rowId, navigate])
  const [searchParams] = useSearchParams()

  const checklistFocusRef = useRef<(() => void) | null>(null)
  const noteFocusRef = useRef<(() => void) | null>(null)
  // Section counts reported by the sections themselves ("Files (2)")
  const [counts, setCounts] = useState<{ files?: number; appointments?: number; upcoming?: number; linked?: number; contacts?: number }>({})
  const countFiles = useCallback((n: number) => setCounts(c => c.files === n ? c : { ...c, files: n }), [])
  const countAppointments = useCallback((n: number, upcoming: number) => setCounts(c => c.appointments === n && c.upcoming === upcoming ? c : { ...c, appointments: n, upcoming }), [])
  const countLinked = useCallback((n: number) => setCounts(c => c.linked === n ? c : { ...c, linked: n }), [])
  const countContacts = useCallback((n: number) => setCounts(c => c.contacts === n ? c : { ...c, contacts: n }), [])
  const [showLetterModal, setShowLetterModal] = useState(false)
  const [showAuditTrail, setShowAuditTrail] = useState(false)
  const closeAuditTrail = useCallback(() => setShowAuditTrail(false), [])
  const [showHandoff, setShowHandoff] = useState(false)
  const closeHandoff = useCallback(() => setShowHandoff(false), [])
  // Sections chosen in "Print / PDF…" while the print layout is up
  const [printSections, setPrintSections] = useState<ProfileSections | null>(null)
  const showPrintLayout = printSections !== null
  const closePrintLayout = useCallback(() => setPrintSections(null), [])
  // "More ▾" actions (3.6)
  const [askArchive, setAskArchive] = useState(false)
  const [archiveReason, setArchiveReason] = useState('')
  // Archiving here offers to cancel upcoming appointments, like the list's Archive (1.13)
  const [cancelAppts, setCancelAppts] = useState(true)
  const [askTrash, setAskTrash] = useState(false)
  const [showMove, setShowMove] = useState(false)
  const [showExportDialog, setShowExportDialog] = useState(false)
  const closeExportDialog = useCallback(() => setShowExportDialog(false), [])

  const { rows, columns, hiddenColumns, grids, activeGridId, sortedRowIds, isLoading } = useGridStore(useShallow(s => ({
    rows: s.rows, columns: s.columns, hiddenColumns: s.hiddenColumns,
    grids: s.grids, activeGridId: s.activeGridId, sortedRowIds: s.sortedRowIds, isLoading: s.isLoading,
  })))
  const { updateRow, updateCell, loadGrid, unarchiveRow, archiveRow, deleteRow, duplicateRow } = useGridStore(useShallow(s => ({
    updateRow: s.updateRow, updateCell: s.updateCell, loadGrid: s.loadGrid, unarchiveRow: s.unarchiveRow,
    archiveRow: s.archiveRow, deleteRow: s.deleteRow, duplicateRow: s.duplicateRow,
  })))
  const { addRecentProfile, removeRecentProfile } = useProfileStore(useShallow(s => ({
    addRecentProfile: s.addRecentProfile, removeRecentProfile: s.removeRecentProfile,
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

  // A ?gridId= hint (Dashboard, Calendar, links) opens that list once per record.
  // Applying it again whenever the list changes fought the lookup below when the
  // record had since moved to another list: the two reloaded each other forever.
  const appliedGridParam = useRef<string | null>(null)
  useEffect(() => {
    const gridIdParam = searchParams.get('gridId')
    if (!gridIdParam || rowId == null) return
    const key = `${rowId}:${gridIdParam}`
    if (appliedGridParam.current === key) return
    appliedGridParam.current = key
    const targetGridId = parseInt(gridIdParam, 10)
    if (!isNaN(targetGridId) && targetGridId !== useGridStore.getState().activeGridId) {
      void loadGrid(targetGridId)
    }
  }, [searchParams, rowId, loadGrid])

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

  const upcomingAppts = useUpcomingAppointments(askArchive && rowId != null ? [rowId] : null)
  const activeGrid = grids.find(g => g.id === activeGridId)
  const nameCol = columns.find(c => c.is_name_column === 1)

  // Find the row in the loaded list. A record from another list (Recent, Contacts,
  // Focus Mode, the palette…) or an archived one isn't there: ask main where it
  // lives, open that list, and fetch an archived record on its own (1.24).
  const rowInList = rowId != null ? rows.find(r => r.row_id === rowId) : undefined
  const [lookup, setLookup] = useState<{ rowId: number; status: RowLocation['status'] | 'missing'; archivedRow?: GridRow; archivedReason?: string | null } | null>(null)
  // The record whose list was reloaded for it, so a record that still isn't there
  // after one reload counts as missing instead of reloading again
  const reloadedFor = useRef<number | null>(null)
  useEffect(() => {
    if (rowId == null || rowInList || isLoading || lookup?.rowId === rowId) return
    let live = true
    void (async () => {
      const res = await safeInvoke<RowLocation | null>(IPC.ROW_LOCATE, rowId)
      if (!live) return
      if (!res.ok || !res.data) { setLookup({ rowId, status: 'missing' }); return }
      const loc = res.data
      if ((loc.status === 'active' || loc.status === 'archived') && loc.gridId !== useGridStore.getState().activeGridId) {
        reloadedFor.current = rowId
        await loadGrid(loc.gridId)
        if (!live) return
      } else if (loc.status === 'active' && reloadedFor.current !== rowId) {
        // Active in the open list but not in its loaded rows: the record was added
        // somewhere else (a linked "New", another window). Reload the list once.
        reloadedFor.current = rowId
        await loadGrid(loc.gridId)
        if (!live || useGridStore.getState().rows.some(r => r.row_id === rowId)) return
      }
      if (loc.status === 'archived') {
        const got = await safeInvoke<GridRow | null>(IPC.ROW_GET, loc.gridId, rowId)
        if (!live) return
        if (got.ok && got.data) { setLookup({ rowId, status: 'archived', archivedRow: got.data, archivedReason: loc.archivedReason }); return }
        setLookup({ rowId, status: 'missing' })
        return
      }
      setLookup({ rowId, status: loc.status === 'active' ? 'missing' : loc.status })
    })()
    return () => { live = false }
  }, [rowId, rowInList, isLoading, lookup?.rowId, loadGrid])
  // A record that's gone leaves Recent, so it stops leading here
  const goneStatus = lookup?.rowId === rowId && !rowInList && lookup.status !== 'active' && lookup.status !== 'archived' ? lookup.status : null
  useEffect(() => { if (rowId != null && goneStatus) removeRecentProfile?.(rowId) }, [rowId, goneStatus, removeRecentProfile])
  const archivedRow = lookup?.rowId === rowId && !rowInList ? lookup.archivedRow : undefined
  const row = rowInList ?? archivedRow
  const isArchived = !!row && row.is_active === 0
  const [unarchiving, setUnarchiving] = useState(false)
  async function handleUnarchive() {
    if (rowId == null) return
    setUnarchiving(true)
    try {
      await unarchiveRow(rowId)
      setLookup(null)
    } finally {
      setUnarchiving(false)
    }
  }

  // The same name the header shows (last name, the list's display format), so
  // "Archive …?", the PDF file name and Recent don't say just the first name
  const knownName = useMemo(() => {
    if (!row || !nameCol) return null
    return getClientName(row, columns, '') || null
  }, [row, nameCol, columns])
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

  async function handleExportPdf(sections: ProfileSections) {
    setShowExportDialog(false)
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
      includeSections: sections,
    })
    if (!result.ok) toast.error('We couldn\'t export this profile. Please try again.')
    else noteUnencryptedExport()
  }

  // Back goes where the user came from (the dashboard, another record…), or to the list
  const goBack = useCallback(() => {
    if (canGoBack()) navigate(-1)
    else navigate('/grid')
  }, [navigate])
  const cameFrom = previousPage(location.pathname)
  const backLabel = !cameFrom || !canGoBack() ? (activeGrid?.name ?? t('list', { cap: true }))
    : cameFrom.startsWith('/grid') || cameFrom === '/' ? (activeGrid?.name ?? t('list', { cap: true }))
      : pageTitle(cameFrom, t) ?? 'Back'

  function goPrev() {
    if (prevRowId != null) navigate(`/profile/${prevRowId}`)
  }

  function goNext() {
    if (nextRowId != null) navigate(`/profile/${nextRowId}`)
  }

  /** After archiving or trashing: on to the next record, or back to the list */
  function leaveRecord() {
    const next = nextRowId ?? prevRowId
    if (next != null) navigate(`/profile/${next}`)
    else goBack()
  }

  async function confirmArchive() {
    setAskArchive(false)
    if (rowId == null) return
    await archiveRow(rowId, archiveReason.trim() || undefined, { cancelAppointments: upcomingAppts > 0 && cancelAppts })
    setArchiveReason('')
    setCancelAppts(true)
    leaveRecord()
  }

  async function confirmTrash() {
    setAskTrash(false)
    if (rowId == null) return
    await deleteRow(rowId)
    leaveRecord()
  }

  const moreItems: MoreMenuItem[] = [
    { label: 'Print / PDF…', onSelect: () => setShowExportDialog(true) },
    ...(row && row.is_active !== 0 ? [{ label: 'Archive…', onSelect: () => setAskArchive(true) }] : []),
    ...(rowInList ? [{ label: 'Duplicate', onSelect: () => { if (rowId != null) void duplicateRow(rowId) } }] : []),
    ...(grids.length > 1 ? [{ label: `Move to another ${t('list')}…`, onSelect: () => setShowMove(true) }] : []),
    { label: 'Move to the Trash…', onSelect: () => setAskTrash(true), danger: true },
  ]

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
    const status = lookup?.rowId === rowId ? lookup.status : null
    if (status === null || isLoading) {
      return (
        <div className="flex items-center justify-center h-full text-base text-slate-500 dark:text-slate-400" role="status">
          Loading…
        </div>
      )
    }
    const message = status === 'trash'
      ? `This ${t('record')} is in the Trash. You can bring it back from there.`
      : status === 'list-deleted'
        ? `This ${t('record')} was on a ${t('list')} that has been deleted.`
        : `We couldn't find this ${t('record')}. It may have been deleted.`
    return (
      <div className="flex flex-col items-center justify-center gap-3 h-full text-base text-slate-600 dark:text-slate-300 px-6 text-center">
        <p>{message}</p>
        <div className="flex gap-3">
          {status === 'trash' && (
            <button onClick={() => navigate('/trash')} className="btn-secondary">Open Trash</button>
          )}
          <button
            onClick={goBack}
            className="hit-44 text-blue-600 dark:text-blue-400 hover:underline focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 rounded-sm"
          >
            Back to the {t('list')}
          </button>
        </div>
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
        <Tooltip content={`Back to ${backLabel} (Escape)`} placement="bottom">
          <button
            onClick={goBack}
            className="hit-44 flex items-center gap-1 text-base text-slate-600 dark:text-slate-400
                       hover:text-slate-900 dark:hover:text-slate-100
                       focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 rounded-sm px-1"
            title={`Back to ${backLabel} (Escape)`}
            aria-label={`Back to ${backLabel}`}
          >
            <ChevronLeft className="w-4 h-4" />
            {backLabel}
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

      {isArchived && (
        <div role="status" className="flex flex-wrap items-center gap-3 px-4 py-2 border-b border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 text-base text-amber-900 dark:text-amber-100 flex-shrink-0">
          <span className="font-semibold">Archived</span>
          <span className="flex-1 min-w-0">
            This {t('record')} is archived{lookup?.rowId === rowId && lookup.archivedReason ? ` (${lookup.archivedReason})` : ''} and doesn't show in the {t('list')}.
          </span>
          <button type="button" className="btn-secondary" disabled={unarchiving} onClick={() => void handleUnarchive()}>
            {unarchiving ? 'Unarchiving…' : 'Unarchive'}
          </button>
        </div>
      )}

      {/* Profile content area — two independent scroll regions. Keyed by record so
          Prev/Next starts clean: no draft, edit or scroll position carries over to
          the next person, and pending scratch-pad saves flush to the right row. */}
      <div key={rowId} className="flex-1 flex overflow-hidden">

        {/* Left sidebar — Checklist + ScratchPad, scrolls independently */}
        <div className="w-[28%] min-w-[300px] max-w-[420px] flex-shrink-0 flex flex-col border-r border-slate-200 dark:border-slate-700 overflow-y-auto bg-slate-50 dark:bg-slate-800/50">
          <div className="p-4 space-y-4">
            {showChecklists && (
              <div data-tour="checklist">
                <Checklist rowId={rowId} clientName={clientName} focusAddRef={checklistFocusRef} />
              </div>
            )}
            <div data-tour="scratch-pad">
              <ScratchPad rowId={rowId} clientName={clientName} snippets={snippets} />
            </div>
          </div>
        </div>

        {/* Main column: the note box first, then deadlines and details, then past
            notes and everything else (3.4). Normal scrollbars, so it's clear it scrolls. */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">
            <ProfileHeader
              row={row}
              columns={[...columns, ...hiddenColumns]}
              gridId={activeGridId!}
              onRowUpdate={handleRowUpdate}
              onAddNote={() => noteFocusRef.current?.()}
              moreItems={moreItems}
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

            <div data-tour="case-log" className="space-y-6">
              <CaseLog rowId={rowId} clientName={clientName} snippets={snippets} focusRef={noteFocusRef} between={<>
                <div data-tour="deadline-panel">
                  <DeadlinePanel
                    row={row}
                    columns={[...columns, ...hiddenColumns]}
                    alertRules={alertRules}
                    onDateSave={handleDateSave}
                  />
                </div>

                <CollapsibleSection title={`${t('record', { cap: true })} details`} sectionKey={`profile-client-data-${activeGridId}`} defaultExpanded>
                  <GridDataSummary
                    row={row}
                    columns={[...columns, ...hiddenColumns]}
                    alertRules={alertRules}
                    gridId={activeGridId!}
                    onCellSave={updateCell}
                  />
                </CollapsibleSection>
              </>} />
            </div>

            {/* The rest: collapsed when empty, with counts in the titles; open/closed is remembered per list */}
            {filesOn && (
              <CollapsibleSection title="Files" sectionKey={`profile-files-${activeGridId}`} count={counts.files} keepMounted>
                <RecordFiles rowId={rowId} onCount={countFiles} />
              </CollapsibleSection>
            )}

            {apptsOn && activeGridId && (
              <CollapsibleSection title={t('appointment', { many: true, cap: true })} sectionKey={`profile-appointments-${activeGridId}`}
                count={counts.appointments} countLabel={counts.upcoming ? `${counts.upcoming} coming up` : undefined} keepMounted>
                <RecordAppointments rowId={rowId} gridId={activeGridId} name={clientName} onCount={countAppointments} />
              </CollapsibleSection>
            )}

            {stageColumn && activeGridId && (
              <CollapsibleSection title={`${stageColumn.name} history`} sectionKey={`profile-stage-history-${activeGridId}`} defaultExpanded={false}>
                <StageHistory gridId={activeGridId} columnId={stageColumn.id} columnName={stageColumn.name} rowId={rowId}
                  value={(row[`col_${stageColumn.id}` as keyof typeof row] as string | null) ?? null} />
              </CollapsibleSection>
            )}

            {linksOn && hasLinkTypes && (
              <CollapsibleSection title="Linked" sectionKey={`profile-linked-records-${activeGridId}`} count={counts.linked} keepMounted>
                <LinkedRecords rowId={rowId} onCount={countLinked} />
              </CollapsibleSection>
            )}

            {activeGridId && showContacts && (
              <CollapsibleSection title={`Linked ${t('contact', { many: true, cap: true })}`} sectionKey={`profile-linked-providers-${activeGridId}`} count={counts.contacts} keepMounted>
                <LinkedProviders rowId={rowId} gridId={activeGridId} onCount={countContacts} />
              </CollapsibleSection>
            )}
          </div>
        </div>

      </div>

      {/* Generate Letter modal */}
      {showHandoff && rowId != null && activeGridId != null && (
        <HandoffDialog rowId={rowId} gridId={activeGridId} clientName={clientName} onClose={closeHandoff} />
      )}
      {showExportDialog && activeGridId != null && (
        <ProfileExportDialog gridId={activeGridId} clientName={clientName}
          onSave={sections => void handleExportPdf(sections)}
          onPrint={sections => { setShowExportDialog(false); setPrintSections(sections) }}
          onClose={closeExportDialog} />
      )}
      {showAuditTrail && rowId != null && (
        <AuditReportDialog rowId={rowId} label={clientName} onClose={closeAuditTrail} />
      )}
      {showLetterModal && rowId != null && activeGridId != null && (
        <RecordLetterDialog rowId={rowId} gridId={activeGridId} clientName={clientName} onClose={() => setShowLetterModal(false)} />
      )}

      {/* Print layout overlay */}
      {printSections && rowId != null && activeGridId != null && (
        <ProfilePrintLayout rowId={rowId} gridId={activeGridId} clientName={clientName} row={row} sections={printSections} onClose={closePrintLayout} />
      )}

      <ConfirmDialog
        open={askArchive}
        title={`Archive ${clientName}?`}
        message={`An archived ${t('record')} leaves the ${t('list')} and stops showing deadlines. You can bring it back any time (Show archived).`}
        confirmLabel="Archive"
        destructive={false}
        onConfirm={() => void confirmArchive()}
        onCancel={() => { setAskArchive(false); setArchiveReason(''); setCancelAppts(true) }}
      >
        <label htmlFor="archive-reason" className="block text-base font-medium text-slate-700 dark:text-slate-200 mb-1">Reason (optional)</label>
        <input id="archive-reason" className="input w-full" value={archiveReason} maxLength={1000}
          onChange={e => setArchiveReason(e.target.value)} placeholder="e.g. Discharged, Moved away, Job finished" />
        <div className="mt-3"><CancelAppointmentsCheckbox count={upcomingAppts} checked={cancelAppts} onChange={setCancelAppts} /></div>
      </ConfirmDialog>

      <ConfirmDialog
        open={askTrash}
        title={`Move ${clientName} to the Trash?`}
        message={`It stays in the Trash for 30 days, and you can restore it from there or with Undo.`}
        confirmLabel="Move to the Trash"
        onConfirm={() => void confirmTrash()}
        onCancel={() => setAskTrash(false)}
      />

      {showMove && rowId != null && activeGridId != null && (
        <MoveToGridModal
          rowId={rowId}
          sourceGridId={activeGridId}
          sourceColumns={[...columns, ...hiddenColumns]}
          onDone={() => { setShowMove(false); void loadGrid(activeGridId) }}
          onCancel={() => setShowMove(false)}
        />
      )}
    </div>
  )
}
