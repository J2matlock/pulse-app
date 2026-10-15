import React, { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
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
import { isEmptyCell } from '../utils/emptyCell'
import { MoreSectionsOffer, settingsFeaturePath, useHiddenSections } from '../components/profile/MoreSectionsOffer'
import { LinkedProviders } from '../components/profile/LinkedProviders'
import { IPC } from '../../shared/ipc-channels'
import { safeInvoke } from '../utils/safeInvoke'
import toast from 'react-hot-toast'
import { ProfilePrintLayout } from '../components/profile/ProfilePrintLayout'
import { ProfileExportDialog, type ProfileSections } from '../components/profile/ProfileExportDialog'
import { RecordLetterDialog } from '../components/profile/RecordLetterDialog'
import { MoveToGridModal } from '../components/grid/MoveToGridModal'
import type { MoreMenuItem } from '../components/profile/ProfileMoreMenu'
import { isPersonKind, type GridRow, type SaveDialogResult } from '../../shared/types'
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
import { suggestedNote } from '../utils/suggestedNote'
import { useActivityTypes } from '../hooks/useActivityTypes'

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
  }, [rowIdStr, rowId, navigate, t])
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
  // Sections chosen in "Save as PDF…" while the print layout is up
  const [printSections, setPrintSections] = useState<ProfileSections | null>(null)
  const showPrintLayout = printSections !== null
  const closePrintLayout = useCallback(() => setPrintSections(null), [])
  // "More ▾" actions (3.6)
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
  // An archived record's page shows its own copy of the record: keep it current after a save, Undo included (F-016)
  useEffect(() => pulseEvents.on('cell:saved', ({ rowId: savedId, columnId, value }) => {
    setLookup(l => l?.rowId === savedId && l.archivedRow ? { ...l, archivedRow: { ...l.archivedRow, [`col_${columnId}`]: value } } : l)
  }), [])
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
  // "Client details (4 filled)": how many typed-in columns have something in them (C-02)
  const filledCount = useMemo(() => row ? [...columns, ...hiddenColumns].filter(c => !isEmptyCell(c, (row[`col_${c.id}` as keyof GridRow] as string | null) ?? null)).length : 0, [row, columns, hiddenColumns])
  // A late contact-like deadline opens the note box with the kind that brings it up to date (Q2)
  const noteTypes = useActivityTypes().active
  const noteSuggestion = useMemo(() => row && !isArchived && alertsLoaded
    ? suggestedNote(row, [...columns, ...hiddenColumns], new Map(alertRules.map(r => [r.id, r])), noteTypes)
    : null, [row, isArchived, alertsLoaded, columns, hiddenColumns, alertRules, noteTypes])

  // Track as recently visited: once per record, and again when its name loads,
  // not every time the list of lists reloads
  const recordVisit = useEffectEvent(() => {
    if (rowId == null || !activeGrid || knownName == null) return
    addRecentProfile({
      rowId,
      gridId: activeGrid.id,
      name: clientName,
      gridName: activeGrid.name,
      visitedAt: new Date().toISOString(),
    })
  })
  useEffect(() => { recordVisit() }, [rowId, knownName])

  // Prev / Next based on sortedRowIds, without records that have left the list since
  // it was sorted (archived or trashed from here), so "10 of 48" counts what's there (C-17)
  const listedIds = useMemo(() => {
    const present = new Set(rows.map(r => r.row_id))
    return sortedRowIds.filter(id => present.has(id))
  }, [rows, sortedRowIds])
  const currentIndex = rowId != null ? listedIds.indexOf(rowId) : -1
  const total = listedIds.length
  const prevRowId = currentIndex > 0 ? listedIds[currentIndex - 1] : null
  const nextRowId = currentIndex >= 0 && currentIndex < total - 1 ? listedIds[currentIndex + 1] : null

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
      title: 'Save as PDF',
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
    if (!result.ok) toast.error('We couldn\'t export this profile — try again')
    else noteUnencryptedExport()
  }

  // Back goes where the user came from (the dashboard, the calendar…), or to the list.
  // From another record (Prev/Next, a link) it goes to the list, so the label and the
  // place it leads agree (C-17)
  const cameFrom = previousPage(location.pathname)
  const fromOtherPage = !!cameFrom && canGoBack() && !cameFrom.startsWith('/profile/')
  const goBack = useCallback(() => {
    if (fromOtherPage) navigate(-1)
    else navigate('/grid')
  }, [navigate, fromOtherPage])
  const listName = activeGrid?.name ?? t('list', { cap: true })
  const backLabel = !fromOtherPage || cameFrom.startsWith('/grid') || cameFrom === '/' ? listName
    : pageTitle(cameFrom, t) ?? listName

  // Prev/Next mark the move, so leaving a record after archiving it goes on to the next only then
  const stepped = (location.state as { stepped?: boolean } | null)?.stepped === true
  function goPrev() {
    if (prevRowId != null) navigate(`/profile/${prevRowId}`, { state: { stepped: true } })
  }

  function goNext() {
    if (nextRowId != null) navigate(`/profile/${nextRowId}`, { state: { stepped: true } })
  }

  /** After archiving or trashing: on to the next record when going through them with
   *  Prev/Next, otherwise back to the list, where the row visibly goes (C-17) */
  function leaveRecord() {
    const next = nextRowId ?? prevRowId
    if (stepped && next != null) navigate(`/profile/${next}`, { state: { stepped: true } })
    else goBack()
  }

  // Archive and Trash don't ask first: the Undo toast is global, so Undo works from the list (Q4).
  // Archiving cancels upcoming appointments too, like the list's Archive (1.13); the toast offers "Add a reason…"
  async function archiveNow() {
    if (rowId == null) return
    await archiveRow(rowId, undefined, { cancelAppointments: true })
    leaveRecord()
  }

  async function trashNow() {
    if (rowId == null) return
    await deleteRow(rowId)
    leaveRecord()
  }

  const hiddenSections = useHiddenSections()

  /** The copy is named "<name> (copy)" and its page opens, so the two aren't mistaken for each other (C-03) */
  async function duplicateHere() {
    if (rowId == null) return
    const copyId = await duplicateRow(rowId)
    if (copyId == null) return
    navigate(`/profile/${copyId}`)
    toast.success('Opened the copy — rename it', { id: 'duplicate-opened' })
  }

  // "Print or save ▾": every PDF this page makes, in one place (C-08)
  const holdsPeople = isPersonKind(recordKind)
  const printItems: MoreMenuItem[] = [
    { label: 'Save as PDF…', description: 'Print or save this page', onSelect: () => setShowExportDialog(true) },
    { label: 'Change history PDF…', description: `The audit trail: every change and ${t('activity')}, with dates`, onSelect: () => setShowAuditTrail(true) },
    ...(handoffOn ? [{
      label: holdsPeople ? 'Handoff packet…' : `${t('record', { cap: true })} packet…`,
      description: 'For a transfer or discharge',
      onSelect: () => setShowHandoff(true),
    }] : []),
  ]

  const moreItems: MoreMenuItem[] = [
    ...(row && row.is_active !== 0 ? [{ label: 'Archive', onSelect: () => void archiveNow() }] : []),
    ...(rowInList ? [{ label: `Duplicate (copies details, not ${t('activity', { many: true })})`, onSelect: () => void duplicateHere() }] : []),
    ...(grids.length > 1 ? [{ label: `Move to another ${t('list')}…`, onSelect: () => setShowMove(true) }] : []),
    ...(hiddenSections.length > 0 ? [{ label: 'Add more sections…', onSelect: () => navigate(settingsFeaturePath()) }] : []),
    { label: 'Move to the Trash', onSelect: () => void trashNow(), danger: true },
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
        if (prevRowIdRef.current != null) navigate(`/profile/${prevRowIdRef.current}`, { state: { stepped: true } })
      } else if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault()
        if (nextRowIdRef.current != null) navigate(`/profile/${nextRowIdRef.current}`, { state: { stepped: true } })
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
        ? `This ${t('record')} was on ${t('list', { article: true })} that has been deleted.`
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
            Back to {backLabel}
          </button>
        </Tooltip>

        <span className="text-slate-300 dark:text-slate-500">|</span>

        {/* Prev/Next */}
        <div className="flex items-center gap-1">
          <Tooltip content={`Previous ${t('record')} (Alt+Left)`} placement="bottom">
            <button
              onClick={goPrev}
              data-allow-repeat=""
              disabled={prevRowId == null}
              className="hit-44 p-1 rounded-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200
                         disabled:opacity-30 disabled:cursor-not-allowed
                         focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
              title={`Previous ${t('record')} (Alt+←)`}
              aria-label={`Previous ${t('record')}`}
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
              data-allow-repeat=""
              disabled={nextRowId == null}
              className="hit-44 p-1 rounded-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200
                         disabled:opacity-30 disabled:cursor-not-allowed
                         focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
              title={`Next ${t('record')} (Alt+→)`}
              aria-label={`Next ${t('record')}`}
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </Tooltip>
        </div>

        {/* The Alt+arrow keys are in the Prev/Next tooltips, not on the bar (C-28) */}
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
        <div className="w-[28%] min-w-[340px] max-w-[420px] flex-shrink-0 flex flex-col border-r border-slate-200 dark:border-slate-700 overflow-y-auto bg-slate-50 dark:bg-slate-800/50">
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
              printItems={printItems}
              moreItems={moreItems}
              onGenerateLetter={showLetters ? () => setShowLetterModal(true) : undefined}
            />

            {activeGridId && showRequirements && <ContactStatusLine rowId={rowId} gridId={activeGridId} />}

            {/* Note box, deadlines, then the notes log: "what happened last time?" is why the
                page was opened, so the details block comes after it, collapsed (C-02) */}
            <div data-tour="case-log" className="space-y-6">
              <CaseLog rowId={rowId} clientName={clientName} snippets={snippets} focusRef={noteFocusRef} suggestion={noteSuggestion} between={
                <div data-tour="deadline-panel">
                  <DeadlinePanel
                    row={row}
                    columns={[...columns, ...hiddenColumns]}
                    alertRules={alertRules}
                    onDateSave={handleDateSave}
                  />
                </div>
              } />

              <CollapsibleSection title={`${t('record', { cap: true })} details`} sectionKey={`profile-client-data-${activeGridId}`}
                defaultExpanded={false} count={filledCount} countLabel={`${filledCount} filled`} keepMounted>
                <div className="space-y-3">
                  {/* W08 — a form fills this record in (C-40: lives with the details it fills) */}
                  {formsOn && activeGridId && profileForms.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 px-2">
                      <span className="text-base text-slate-600 dark:text-slate-300">Fill in from a form:</span>
                      {profileForms.map(f => (
                        <button key={f.id} type="button" className="btn-compact-secondary"
                          onClick={() => pulseEvents.emit('form:fill', { formId: f.id, gridId: activeGridId, rowId })}>{f.name}</button>
                      ))}
                    </div>
                  )}
                  <GridDataSummary
                    row={row}
                    columns={[...columns, ...hiddenColumns]}
                    alertRules={alertRules}
                    gridId={activeGridId!}
                    onCellSave={updateCell}
                  />
                </div>
              </CollapsibleSection>
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

            {/* Sections a switched-off feature hides, so they can be found (C-04) */}
            <MoreSectionsOffer />
          </div>
        </div>

      </div>

      {/* Handoff, PDF, audit trail and letter dialogs */}
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
