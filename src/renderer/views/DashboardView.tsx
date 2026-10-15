/**
 * DashboardView — count tiles, then the tabs What's due, Overdue, Next 7 days,
 * Next 30 days, then the cards people chose (Recently archived among them).
 */
import { onTabListKeyDown } from '../utils/tabListKeys'
import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { AlertTriangle, Calendar, Check, CheckCircle, Clock, Users, Archive, RefreshCw, Printer, ShieldCheck, CalendarPlus, LayoutGrid, Mail, LayoutDashboard } from 'lucide-react'
import { PrimaryButton, SecondaryButton } from '../components/ui/Button'
import { Tooltip } from '../components/shared/Tooltip'
import { CalendarExportDialog } from '../components/reports/CalendarExportDialog'
import { PrintDueDialog } from './dashboard/PrintDueDialog'
import { ComplianceSummaryDialog } from '../components/reports/ComplianceSummaryDialog'
import toast from 'react-hot-toast'
import { useToday } from '../hooks/useToday'
import { IPC } from '../../shared/ipc-channels'
import { QUERY_LIMITS } from '../../shared/query-limits'
import type { DashboardStats, AlertThreshold, ParsedAlertRule, CaseloadTask, ChecklistDueItem } from '../../shared/types'
import { DEBOUNCE_SEARCH, DEBOUNCE_TASK_RELOAD, SPINNER_DELAY, MS_PER_DAY } from '../../shared/constants'
import { safeInvoke } from '../utils/safeInvoke'
import { useShallow } from 'zustand/react/shallow'
import { useAlertStore } from '../stores/alertStore'
import { computeDaysUntil, getMatchingThreshold } from '../utils/deadlineCalc'
import { useTaskStore } from '../stores/taskStore'
import { rlog } from '../utils/rendererLogger'
import { LoadingOverlay } from '../components/shared/LoadingSpinner'
import { pulseEvents } from '../events'
import { useVocab, useVocabByList } from '../hooks/useVocab'
import { GettingStartedCard, useGettingStarted } from './dashboard/GettingStartedCard'
import { PrintExportMenu } from './dashboard/PrintExportMenu'
import { datedItems, recordsIn, windowTabs } from './dashboard/tabCounts'
import { ChooseListDialog } from '../components/shared/ChooseListDialog'
import { wordNow } from '../utils/vocab'

import type { FollowUpRow, RawDeadlineRow, ArchivedRow, ExtendedDeadlineInfo, TopTab, PriorityItem } from './dashboard/types'
import { SummaryCard } from './dashboard/SummaryCard'
import { DeadlineRow } from './dashboard/DeadlineRow'
import { completeDeadlines, skippedForBulkDone } from './dashboard/completeDeadline'
import { dashboardTileCounts, deadlinesMayBeCut, followUpsMayBeCut } from './dashboard/tileCounts'
import { useListsChanged } from './dashboard/useDashboardRefresh'
import { deadlineLabel } from '../../shared/deadlineLabel'
import { ColorKeyPopover } from '../components/grid/ColorKeyPopover'
import { DashboardCards } from './dashboard/cards/DashboardCards'
import { BatchDocumentsDialog } from '../components/documents/BatchDocumentsDialog'
import { useGridStore } from '../stores/gridStore'
import { NO_INTERVAL, toRuleInterval, type RuleInterval } from '../../shared/ruleInterval'
import { TaskRow } from './dashboard/TaskRow'
import { FollowUpDashRow } from './dashboard/FollowUpDashRow'
import { ChecklistDueRow } from './dashboard/ChecklistDueRow'
import { WeekViewTab } from './dashboard/WeekViewTab'
import { MonthViewTab } from './dashboard/MonthViewTab'
import { RequirementsLine } from './dashboard/MonthlyContactsCard'
import { RecentlyArchivedTab } from './dashboard/RecentlyArchivedTab'
import { useFeature } from '../hooks/useFeature'
import { assertNever } from '../../shared/assertNever'
import { nextStep } from './dashboard/nextStep'
import { NextStepBanner } from './dashboard/NextStepBanner'
import { useLeavingItems } from './dashboard/useLeavingItems'
import { EmptyState } from '../components/shared/EmptyState'

const LOAD_ERROR = "We couldn't load the dashboard — try again"
/** Up to 2,000 items can come back; drawing them all took most of a second at 5,000 records (UX pass Q9b) */
const FIRST_ITEMS_SHOWN = 100
/** What's due starts with its worst few, so the cards under it are in reach (persona study R6) */
const WHATS_DUE_FIRST = 10
/** "Show all" on What's due stays open until the app closes; it isn't a setting */
const WHATS_DUE_ALL_KEY = 'pulse.dashboard.whatsDueAll'
function readWhatsDueAll(): boolean {
  try { return sessionStorage.getItem(WHATS_DUE_ALL_KEY) === '1' } catch { return false }
}

export default function DashboardView(): React.ReactElement {
  const showTasks = useFeature('tasks')
  const showChecklists = useFeature('checklists')
  const requirementsOn = useFeature('requirements')
  const [customizing, setCustomizing] = useState(false)
  const gettingStarted = useGettingStarted()
  const tabsRef = useRef<HTMLDivElement>(null)
  const lettersOn = useFeature('letters')
  const openGridId = useGridStore(s => s.activeGridId)
  const allGrids = useGridStore(s => s.grids)
  const [pickingLettersList, setPickingLettersList] = useState(false)
  const [reminderLetters, setReminderLetters] = useState(false)
  // The dashboard spans every list, so it uses the workspace's words
  const { t } = useVocab(null)
  const { rules: alertRules, isLoaded: rulesLoaded, loadRules } = useAlertStore(useShallow(s => ({
    rules: s.rules, isLoaded: s.isLoaded, loadRules: s.loadRules,
  })))
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [rawDeadlines, setRawDeadlines] = useState<RawDeadlineRow[]>([])
  const [archivedRows, setArchivedRows] = useState<ArchivedRow[]>([])
  const [tasksDue, setTasksDue] = useState<CaseloadTask[]>([])
  const [checklistDue, setChecklistDue] = useState<ChecklistDueItem[]>([])
  const [followUps, setFollowUps] = useState<FollowUpRow[]>([])
  // A list that came back at main's cap is missing the rest: the tiles then use main's
  // counts, and a change reloads everything so those stay right (F-024)
  const [deadlinesCut, setDeadlinesCut] = useState(false)
  const [followUpsCut, setFollowUpsCut] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [topTab, setTopTab] = useState<TopTab>('priority')
  // Bulk "mark done" selection, keyed rowId:columnId; the checkboxes only show
  // once "Select several…" is on, so the everyday list stays plain (UX D-25)
  const [selecting, setSelecting] = useState(false)
  const [selectedDeadlines, setSelectedDeadlines] = useState<Set<string>>(() => new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const { leaving, leaveThen } = useLeavingItems()
  const deadlineKey = (d: ExtendedDeadlineInfo) => `${d.rowId}:${d.columnId}`
  const toggleDeadline = useCallback((d: ExtendedDeadlineInfo) => {
    setSelectedDeadlines(prev => {
      const next = new Set(prev)
      const k = `${d.rowId}:${d.columnId}`
      if (next.has(k)) next.delete(k); else next.add(k)
      return next
    })
  }, [])
  useEffect(() => { setSelectedDeadlines(new Set()); setSelecting(false) }, [topTab])
  // Overdue and the search results draw their first FIRST_ITEMS_SHOWN items until this is on
  const [showAllItems, setShowAllItems] = useState(false)
  const [whatsDueAll, setWhatsDueAll] = useState(readWhatsDueAll)
  const showAllWhatsDue = useCallback(() => {
    setWhatsDueAll(true)
    try { sessionStorage.setItem(WHATS_DUE_ALL_KEY, '1') } catch { /* this session only, then */ }
  }, [])
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [archiveSearch, setArchiveSearch] = useState('')
  const [debouncedArchiveSearch, setDebouncedArchiveSearch] = useState('')
  const [showSpinner, setShowSpinner] = useState(false)
  const [showCompliance, setShowCompliance] = useState(false)
  const closeCompliance = useCallback(() => setShowCompliance(false), [])
  const [showCalendar, setShowCalendar] = useState(false)
  const closeCalendar = useCallback(() => setShowCalendar(false), [])
  const [printingDue, setPrintingDue] = useState(false)

  // Debounce spinner to prevent flash on fast loads
  useEffect(() => {
    if (!isLoading) { setShowSpinner(false); return }
    const t = setTimeout(() => setShowSpinner(true), SPINNER_DELAY)
    return () => clearTimeout(t)
  }, [isLoading])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), DEBOUNCE_SEARCH)
    return () => clearTimeout(t)
  }, [searchQuery])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedArchiveSearch(archiveSearch), DEBOUNCE_SEARCH)
    return () => clearTimeout(t)
  }, [archiveSearch])

  const reloadFollowUps = useCallback(async () => {
    const res = await safeInvoke<FollowUpRow[]>(IPC.DASHBOARD_GET_FOLLOWUPS)
    if (res.ok) { setFollowUps(res.data); setFollowUpsCut(followUpsMayBeCut(res.data.length)) }
  }, [])

  useEffect(() => {
    if (!rulesLoaded) loadRules()
  }, [rulesLoaded, loadRules])

  const reloadTasksDue = useCallback(async () => {
    const res = await safeInvoke<CaseloadTask[]>(IPC.TASK_GET_DUE)
    if (res.ok) setTasksDue(res.data)
  }, [])

  // Re-sync tasksDue when tasks array changes (handles undo/redo from anywhere).
  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout>
    // taskStore has no subscribeWithSelector middleware, so subscribe takes a single
    // (state, prev) listener — compare tasks ourselves.
    const unsub = useTaskStore.subscribe((state, prev) => {
      if (state.tasks === prev.tasks) return
      clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => { void reloadTasksDue() }, DEBOUNCE_TASK_RELOAD)
    })
    return () => { unsub(); clearTimeout(debounceTimer) }
  }, [reloadTasksDue])

  const reloadDeadlines = useCallback(async () => {
    const result = await safeInvoke<RawDeadlineRow[]>(IPC.DASHBOARD_GET_DEADLINES)
    if (result.ok) { setRawDeadlines(result.data); setDeadlinesCut(deadlinesMayBeCut(result.data.length)) }
  }, [])

  // Everything on the dashboard. `quiet` refreshes in place (after sample data or a list
  // changes) without blanking the tiles; a failed load says so instead of "all caught up"
  const loadAll = useCallback(async (opts: { quiet?: boolean; isCancelled?: () => boolean } = {}) => {
    const cancelled = opts.isCancelled ?? (() => false)
    if (!opts.quiet) setIsLoading(true)
    setLoadError(null)
    try {
      const [allRes, tasksRes, clRes] = await Promise.all([
        safeInvoke<{ stats: DashboardStats; deadlines: RawDeadlineRow[]; followUps: FollowUpRow[]; archived: ArchivedRow[] }>(IPC.DASHBOARD_GET_ALL),
        safeInvoke<CaseloadTask[]>(IPC.TASK_GET_DUE),
        safeInvoke<ChecklistDueItem[]>(IPC.CHECKLIST_GET_DUE),
      ])
      if (cancelled()) return
      if (allRes.ok) {
        setStats(allRes.data.stats)
        setRawDeadlines(allRes.data.deadlines)
        setDeadlinesCut(deadlinesMayBeCut(allRes.data.deadlines.length))
        setFollowUps(allRes.data.followUps)
        setFollowUpsCut(followUpsMayBeCut(allRes.data.followUps.length))
        setArchivedRows(allRes.data.archived)
      } else {
        rlog.error('Dashboard', 'Dashboard load failed:', allRes.error)
        setLoadError(LOAD_ERROR)
      }
      if (tasksRes.ok) setTasksDue(tasksRes.data)
      else rlog.error('Dashboard', 'Dashboard tasks load failed:', tasksRes.error)
      if (clRes.ok) setChecklistDue(clRes.data)
      else rlog.error('Dashboard', 'Dashboard checklist load failed:', clRes.error)
    } catch (err) {
      rlog.error('Dashboard', 'Dashboard load failed:', err)
      if (!cancelled()) setLoadError(LOAD_ERROR)
    } finally {
      if (!cancelled()) setIsLoading(false)
    }
  }, [])

  const reload = useCallback(() => loadAll(), [loadAll])
  const today = useToday()

  // Initial load
  useEffect(() => {
    let cancelled = false
    void loadAll({ isCancelled: () => cancelled })
    return () => { cancelled = true }
  }, [loadAll])

  // Sample data added or removed, a list added, deleted or restored, or a record reactivated
  // (here or by Undo) while the dashboard is open
  useListsChanged(() => { void loadAll({ quiet: true }) })

  // A new day while the dashboard is open: yesterday's "due today" is now overdue.
  // Main works deadlines out against today, so load again.
  useEffect(() => pulseEvents.on('day:changed', () => { void loadAll({ quiet: true }) }), [loadAll])

  // Done, Undo or an extension from any of the dashboard's lists: tell everything showing
  // deadlines (the cards too), and reload ours through the listener below
  const deadlinesChanged = useCallback(async () => { pulseEvents.emit('deadline:changed') }, [])

  // Refresh deadlines when cleared here, from FocusModeView or a note (or undone)
  useEffect(() => {
    const unsub = pulseEvents.on('deadline:changed', () => { void (deadlinesCut ? loadAll({ quiet: true }) : reloadDeadlines()) })
    return unsub
  }, [reloadDeadlines, deadlinesCut, loadAll])

  // Refresh follow-ups when completed/uncompleted from FocusModeView (or undone)
  useEffect(() => {
    const unsub = pulseEvents.on('followup:changed', () => { void (followUpsCut ? loadAll({ quiet: true }) : reloadFollowUps()) })
    return unsub
  }, [reloadFollowUps, followUpsCut, loadAll])

  // Enrich deadline rows with threshold/interval math
  const deadlines: ExtendedDeadlineInfo[] = useMemo(() => {
    return rawDeadlines.flatMap((row): ExtendedDeadlineInfo[] => {
      let alertRuleId: number | null = null
      let rule: ParsedAlertRule | undefined
      let intervalDays: number | null = 0
      let interval: RuleInterval = NO_INTERVAL
      let checklistTemplateId: number | null = null
      try {
        const cfg = JSON.parse(row.column_config || '{}') as { alert_rule_id?: number; done_checklist_id?: number }
        alertRuleId = cfg.alert_rule_id ?? null
        checklistTemplateId = cfg.done_checklist_id ?? null
        if (alertRuleId) {
          rule = alertRules.find(r => r.id === alertRuleId)
          if (rule) { intervalDays = rule.interval_days ?? 0; interval = toRuleInterval(rule) }
        }
      } catch { /* skip malformed config */ }

      // Main works deadlines out with the shared engine; older data shapes fall back to the window's math
      const daysUntil = row.daysUntil !== undefined ? row.daysUntil : computeDaysUntil(row.date_value, interval)
      // An unparseable date can't be placed on the timeline — don't show it as "due today"
      if (daysUntil === null) return []
      const threshold: AlertThreshold | null = rule ? getMatchingThreshold(daysUntil, rule.thresholds) ?? null : null
      return [{
        rowId: row.row_id,
        clientName: row.client_name ?? `Unnamed ${wordNow('record', {}, row.grid_id)}`,
        gridId: row.grid_id,
        gridName: row.grid_name,
        columnId: row.column_id,
        columnName: row.column_name,
        // "Appeal window", not "Appeal filed", when the date comes from another column (R6)
        title: deadlineLabel(rule, { name: row.column_name }).title,
        dateValue: row.date_value,
        daysUntil,
        alertRuleId,
        threshold,
        intervalDays,
        interval,
        checklistTemplateId,
        due: row.due ?? undefined,
        detail: row.detail,
        ruleKind: row.rule_kind,
        step: row.step,
        extensionId: row.extension_id,
        state: row.state,
        label: row.label,
        meter: row.meter,
      }]
    }).sort((a, b) => a.daysUntil - b.daysUntil)
  }, [rawDeadlines, alertRules])

  // Compute daysUntil for each due task (null due_date -> 9999 so they sort last)
  const tasksWithDays = useMemo(() => {
    const todayStart = new Date(today + 'T00:00:00')
    // Switched-off features hide their rows everywhere on the dashboard
    if (!showTasks) return []
    return tasksDue.map(t => {
      let daysUntil = 9999
      if (t.due_date) {
        const d = new Date(t.due_date + 'T00:00:00')
        daysUntil = Math.round((d.getTime() - todayStart.getTime()) / MS_PER_DAY)
      }
      return { task: t, daysUntil }
    })
  }, [tasksDue, showTasks, today])

  // Compute daysUntil for each checklist item with a due date
  const checklistWithDays = useMemo(() => {
    const todayStart = new Date(today + 'T00:00:00')
    if (!showChecklists) return []
    return checklistDue.map(ci => {
      const d = new Date(ci.due_date! + 'T00:00:00')
      const daysUntil = Math.round((d.getTime() - todayStart.getTime()) / MS_PER_DAY)
      return { item: ci, daysUntil }
    })
  }, [checklistDue, showChecklists, today])

  // Compute daysUntil for each follow-up
  const followUpsWithDays = useMemo(() => {
    const todayStart = new Date(today + 'T00:00:00')
    return followUps.map(f => {
      const d = new Date(f.follow_up_date + 'T00:00:00')
      const daysUntil = Math.round((d.getTime() - todayStart.getTime()) / MS_PER_DAY)
      return { followUp: f, daysUntil }
    })
  }, [followUps, today])

  // Done from the Week and Month tabs: like the Priority List, drop the row then reload
  const dropAndReload = useCallback((rowId: number, columnId: number) => {
    setRawDeadlines(prev => prev.filter(r => !(r.row_id === rowId && r.column_id === columnId)))
    void deadlinesChanged()
  }, [deadlinesChanged])

  // In each list's own words, lower case like the other tiles: "Active clients",
  // "Active customers and jobs"; more kinds than that read as a count of lists
  const tFor = useVocabByList()
  const activeLabel = useMemo(() => {
    const lists = stats?.activeByList ?? []
    const words = [...new Set(lists.map(l => tFor(l.grid_id)('record', { many: true })))]
    if (words.length <= 1) return `Active ${words[0] ?? t('record', { many: true })}`
    if (words.length === 2) return `Active ${words[0]} and ${words[1]}`
    return `Active, in ${lists.length} ${t('list', { many: true })}`
  }, [stats, tFor, t])

  const rulesInUse = useMemo(() => {
    const ids = new Set(deadlines.map(d => d.alertRuleId).filter((id): id is number => id != null))
    return alertRules.filter(r => ids.has(r.id))
  }, [deadlines, alertRules])

  // The tiles and the tabs they open count one way (persona study R6): every deadline,
  // task with a due date, checklist item and follow-up; overdue includes a used-up quota
  const derivedCounts = useMemo(() => dashboardTileCounts({
    deadlines, deadlinesCut: deadlinesCut, followUpDays: followUpsWithDays.map(f => f.daysUntil), followUpsCut: followUpsCut,
    otherDueDays: [...tasksWithDays.filter(t => t.task.due_date), ...checklistWithDays].map(x => x.daysUntil), server: stats,
  }), [deadlines, deadlinesCut, tasksWithDays, checklistWithDays, followUpsWithDays, followUpsCut, stats])

  // The Overdue, Next 7 days and Next 30 days tabs, filtered the way the tiles count
  const windows = useMemo(() => windowTabs(datedItems({ deadlines, tasksWithDays, checklistWithDays, followUpsWithDays })),
    [deadlines, tasksWithDays, checklistWithDays, followUpsWithDays])
  const overdueItems = windows.overdue
  // The Overdue tile counts items; say how many records they're about (R6). Unknown past main's cap
  const overdueRecords = deadlinesCut || followUpsCut ? null : recordsIn(overdueItems)

  // Everything on "What's due", soonest first; the search filters this, the next-step banner doesn't
  const priorityItems = useMemo((): PriorityItem[] => {
    const items: PriorityItem[] = []
    for (const d of deadlines) { if (d.threshold !== null) items.push({ kind: 'deadline', data: d, sortKey: d.daysUntil }) }
    for (const { task, daysUntil } of tasksWithDays) items.push({ kind: 'task', data: task, daysUntil, sortKey: daysUntil })
    for (const { item: ci, daysUntil } of checklistWithDays) items.push({ kind: 'checklist', data: ci, daysUntil, sortKey: daysUntil })
    for (const { followUp, daysUntil } of followUpsWithDays) items.push({ kind: 'followup', data: followUp, daysUntil, sortKey: daysUntil })
    return items.sort((a, b) => a.sortKey - b.sortKey)
  }, [deadlines, tasksWithDays, checklistWithDays, followUpsWithDays])

  const filteredItems = useMemo((): PriorityItem[] => {
    const q = debouncedSearch.toLowerCase()
    if (!q) return priorityItems
    const has = (s: string | null | undefined) => (s ?? '').toLowerCase().includes(q)
    return priorityItems.filter(it => {
      switch (it.kind) {
        case 'deadline': return has(it.data.clientName) || has(it.data.title) || has(it.data.columnName) || has(it.data.gridName)
        case 'task': return has(it.data.title) || has(it.data.category)
        case 'checklist': return has(it.data.title) || has(it.data.client_name) || has(it.data.grid_name)
        case 'followup': return has(it.data.client_name) || has(it.data.content) || has(it.data.grid_name)
        default: return assertNever(it, 'dashboard item')
      }
    })
  }, [priorityItems, debouncedSearch])

  // The one thing to do next, over the whole workload (Q2); the empty and error states speak for themselves
  const step = useMemo(() => nextStep({ overdueItems, priorityItems, t }), [overdueItems, priorityItems, t])
  const showNextStep = !isLoading && (stats?.totalActive ?? 0) > 0

  const filteredArchived = useMemo(() => {
    if (!debouncedArchiveSearch) return archivedRows
    const q = debouncedArchiveSearch.toLowerCase()
    return archivedRows.filter(r =>
      (r.client_name ?? '').toLowerCase().includes(q) ||
      r.grid_name.toLowerCase().includes(q) ||
      (r.archived_reason ?? '').toLowerCase().includes(q)
    )
  }, [archivedRows, debouncedArchiveSearch])

  // Each tab says how many rows are behind it (UX D-20): the length of what it shows
  const tabCounts = useMemo<Record<TopTab, number>>(() => ({
    priority: priorityItems.length,
    overdue: windows.overdue.length,
    next7: windows.next7.length,
    next30: windows.next30.length,
  }), [priorityItems, windows])

  const TOP_TABS = useMemo<{ key: TopTab; label: string; icon: React.ReactNode }[]>(() => [
    { key: 'priority',   label: "What's due",    icon: <AlertTriangle className="w-4 h-4" /> },
    { key: 'overdue',    label: 'Overdue',       icon: <AlertTriangle className="w-4 h-4" /> },
    { key: 'next7',      label: 'Next 7 days',   icon: <Clock className="w-4 h-4" /> },
    { key: 'next30',     label: 'Next 30 days',  icon: <Calendar className="w-4 h-4" /> },
  ], [])

  // A count tile opens its tab and brings the tabs into view (UX D-06)
  const openTab = useCallback((tab: TopTab) => {
    setTopTab(tab)
    const el = tabsRef.current
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [])

  if (loadError) return (
    <div className="max-w-4xl mx-auto px-6 py-16">
      <div className="flex items-center gap-3 p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200" role="alert">
        <span className="text-base">{loadError}</span>
        <button onClick={() => void reload()} className="hit-44 flex items-center gap-1.5 text-base underline hover:no-underline">
          <RefreshCw className="w-4 h-4" />
          Retry
        </button>
      </div>
    </div>
  )


  async function markSelectedDone(visible: PriorityItem[]) {
    const chosen = visible
      .filter((it): it is Extract<PriorityItem, { kind: 'deadline' }> => it.kind === 'deadline' && selectedDeadlines.has(deadlineKey(it.data)))
      .map(it => ({ rowId: it.data.rowId, columnId: it.data.columnId, columnName: it.data.columnName, clientName: it.data.clientName, dateValue: it.data.dateValue, interval: it.data.interval, checklistTemplateId: it.data.checklistTemplateId, ruleKind: it.data.ruleKind, step: it.data.step }))
    // Say what can't be marked done from here, and why, instead of quietly leaving it ticked
    const skipped = skippedForBulkDone(chosen)
    if (skipped.message) toast(skipped.message, { duration: 8000 })
    chosen.splice(0, chosen.length, ...skipped.rest)
    if (chosen.length === 0) return
    setBulkBusy(true)
    try {
      const done = await completeDeadlines(chosen, { onUndone: deadlinesChanged })
      const failed = chosen.length - done.length
      if (failed > 0) toast.error(`${failed} couldn't be marked done. Try ${failed === 1 ? 'it' : 'them'} one at a time.`)
      setRawDeadlines(prev => prev.filter(r => !done.some(d => d.rowId === r.row_id && d.columnId === r.column_id)))
      setSelectedDeadlines(new Set())
      // Repeating deadlines come back with their next due date
      void deadlinesChanged()
    } finally {
      setBulkBusy(false)
    }
  }

  // "Select several…" in the toolbar row; the checkboxes and this bar follow
  function renderSelectToggle() {
    return (
      <button type="button" aria-pressed={selecting} onClick={() => { setSelecting(s => !s); setSelectedDeadlines(new Set()) }}
        className="hit-44 text-base text-blue-700 dark:text-blue-300 underline hover:no-underline rounded-sm focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
        style={{ minHeight: 44 }}>
        {selecting ? 'Done selecting' : 'Select several…'}
      </button>
    )
  }

  // Stable keys, so a row leaving doesn't remount every row after it (Q6)
  function itemKey(item: PriorityItem): string {
    switch (item.kind) {
      case 'deadline': return `dl-${item.data.rowId}-${item.data.columnId}`
      case 'task': return `task-${item.data.id}`
      case 'checklist': return `cl-${item.data.id}`
      case 'followup': return `fu-${item.data.id}`
      default: return assertNever(item)
    }
  }

  function renderItem(item: PriorityItem, key: string): React.ReactNode {
    switch (item.kind) {
      case 'deadline': {
        const done = item.data
        return (
          <DeadlineRow
            deadline={done}
            selected={selectedDeadlines.has(deadlineKey(done))}
            onToggleSelect={selecting ? () => toggleDeadline(done) : undefined}
            // It slides out, then the list reloads (a repeating one comes back with its next date)
            onMarkDone={(rowId, columnId) => leaveThen(key, () => {
              setRawDeadlines(prev => prev.filter(r => !(r.row_id === rowId && r.column_id === columnId)))
              void deadlinesChanged()
            })}
            onUndoneMarkDone={deadlinesChanged}
          />
        )
      }
      case 'task':
        return (
          <TaskRow
            task={item.data}
            daysUntil={item.daysUntil}
            onComplete={(id) => leaveThen(key, () => setTasksDue(prev => prev.filter(t => t.id !== id)))}
            onRestore={(t) => {
              setTasksDue(prev => prev.some(x => x.id === t.id) ? prev : [...prev, t])
            }}
          />
        )
      case 'checklist':
        return (
          <ChecklistDueRow
            item={item.data}
            daysUntil={item.daysUntil}
            onComplete={(id) => leaveThen(key, () => setChecklistDue(prev => prev.filter(ci => ci.id !== id)))}
            onRestore={(ci) => {
              setChecklistDue(prev => prev.some(x => x.id === ci.id) ? prev : [...prev, ci])
            }}
          />
        )
      case 'followup':
        return (
          <FollowUpDashRow
            followUp={item.data}
            daysUntil={item.daysUntil}
            onComplete={(id) => leaveThen(key, () => setFollowUps(prev => prev.filter(f => f.id !== id)))}
            onReloadFollowUps={async () => { await reloadFollowUps() }}
          />
        )
      default:
        return assertNever(item)
    }
  }

  // The soonest first: a long list draws only its top, the rest a button away (UX pass Q9b)
  function renderList(items: PriorityItem[], cap = { first: FIRST_ITEMS_SHOWN, all: showAllItems, onShowAll: () => setShowAllItems(true) }): React.ReactElement {
    const seen = new Set<string>()
    const shown = cap.all ? items : items.slice(0, cap.first)
    return (
      <div role="list">
        {renderBulkBar(shown)}
        {shown.map((item, i) => {
          // The same record and column twice would share a key; the index only then
          let key = itemKey(item)
          if (seen.has(key)) key = `${key}-${i}`
          seen.add(key)
          return (
            <div key={key} className={leaving.has(key) ? 'motion-list-item motion-item-leave' : 'motion-list-item'}>
              {renderItem(item, key)}
            </div>
          )
        })}
        {shown.length < items.length && (
          <div className="flex items-center gap-3 px-4 py-3 flex-wrap border-t border-slate-200 dark:border-slate-700">
            <p className="flex-1 min-w-0 text-base text-slate-600 dark:text-slate-300">
              Showing the soonest {shown.length.toLocaleString()} of {items.length.toLocaleString()}.
            </p>
            <SecondaryButton size="compact" onClick={cap.onShowAll} data-testid="dashboard-show-all">
              Show all {items.length.toLocaleString()}
            </SecondaryButton>
          </div>
        )}
      </div>
    )
  }

  function renderBulkBar(visible: PriorityItem[]) {
    if (!selecting) return null
    const selectable = visible.filter((it): it is Extract<PriorityItem, { kind: 'deadline' }> => it.kind === 'deadline')
    const allShown = selectable.length > 0 && selectable.every(it => selectedDeadlines.has(deadlineKey(it.data)))
    return (
      <div className="sticky top-0 z-10 flex items-center gap-3 px-4 py-2 bg-blue-50 dark:bg-blue-900/40 border-b border-blue-200 dark:border-blue-800 flex-wrap">
        <label className="flex items-center gap-2 text-base text-blue-900 dark:text-blue-100 cursor-pointer" style={{ minHeight: 44 }}>
          <input type="checkbox" className="w-5 h-5" checked={allShown} disabled={selectable.length === 0}
            onChange={e => setSelectedDeadlines(e.target.checked ? new Set(selectable.map(it => deadlineKey(it.data))) : new Set())} />
          Select all shown
        </label>
        <span className="text-base font-medium text-blue-900 dark:text-blue-100 flex-1">{selectedDeadlines.size} selected</span>
        <PrimaryButton size="compact" icon={<Check className="w-4 h-4" />} busy={bulkBusy} disabled={selectedDeadlines.size === 0} onClick={() => void markSelectedDone(visible)}>
          {bulkBusy ? 'Marking…' : 'Mark done'}
        </PrimaryButton>
        <SecondaryButton size="compact" onClick={() => setSelectedDeadlines(new Set())}>Clear</SecondaryButton>
      </div>
    )
  }

  // "What's due" is a card like the others, second by default (D-21)
  const whatsDue = (
      <div className="mb-6" ref={tabsRef}>
        {/* Top tab bar */}
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
          <div data-tour="dashboard-tabs" className="flex border-b border-slate-200 dark:border-slate-700 overflow-x-auto overflow-y-hidden">
            {/* Only tabs inside the tablist; the color guide link sits beside it */}
            <div className="flex" role="tablist" aria-label="Dashboard views" onKeyDown={onTabListKeyDown}>
            {TOP_TABS.map(tab => (
              <button
                key={tab.key}
                role="tab"
                aria-selected={topTab === tab.key}
                tabIndex={topTab === tab.key ? 0 : -1}
                onClick={() => setTopTab(tab.key)}
                className={`flex items-center gap-2 px-4 py-3 text-base font-medium border-b-2 whitespace-nowrap transition-colors focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500
                  ${topTab === tab.key
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
                    : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}
                style={{ minHeight: 44 }}
              >
                {tab.icon}
                {tab.label}{!isLoading && <span className="tabular-nums">({tabCounts[tab.key]})</span>}
              </button>
            ))}
            </div>
            {/* The one color key, as a pop-up from a link: it doesn't push the due rows down (UX D-21) */}
            <ColorKeyPopover rules={rulesInUse} label="What do the colors mean?" triggerVariant="link" buttonClassName="ml-auto px-4 whitespace-nowrap"
              intro="The stripe on the left of each row: red = late or due today, orange = due this week, yellow = due this month.">
              What do the colors mean?
            </ColorKeyPopover>
          </div>

          {deadlinesCut && (
            <p className="px-4 py-2 text-base text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700" role="note">
              Showing the soonest {QUERY_LIMITS.DASHBOARD_PRIORITY.toLocaleString()} deadlines. The numbers above count all of them.
            </p>
          )}

          {/* Done explains itself here, not only in a hover tooltip (UX D-04) */}
          {(topTab === 'priority' || topTab === 'overdue') && (
            <div className="flex items-center gap-3 px-4 py-1 border-b border-slate-200 dark:border-slate-700 flex-wrap">
              <p className="flex-1 min-w-0 text-base text-slate-600 dark:text-slate-300">
                Done puts today's date in and starts the next cycle. Use "Done on…" if it happened earlier.
              </p>
              {renderSelectToggle()}
              {/* The search shares this row instead of taking one of its own: the due rows start higher */}
              {topTab === 'priority' && (
                <input
                  type="search"
                  placeholder="Search…"
                  aria-label="Search what's due"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="input w-48 py-1.5 text-base"
                  style={{ minHeight: 44 }}
                />
              )}
            </div>
          )}

          {/* What's due tab */}
          {topTab === 'priority' && (
            <>
              {isLoading ? (
                showSpinner ? <LoadingOverlay label="Loading dashboard…" /> : <div className="py-16" />
              ) : filteredItems.length === 0 ? (
                debouncedSearch.trim() ? (
                  // A search that finds nothing isn't an empty dashboard: words, no action
                  <p className="py-16 text-center text-base font-semibold text-slate-700 dark:text-slate-300">Nothing matches &ldquo;{debouncedSearch.trim()}&rdquo;</p>
                ) : stats?.totalActive === 0 ? (
                  <EmptyState icon={<LayoutDashboard />} title="Nothing here yet"
                    description={`Your dashboard fills up as you add ${t('record', { many: true })} with dates.`}
                    action={{ label: 'See an example with sample data', onClick: () => pulseEvents.emit('starters:open', { sample: true }) }} />
                ) : (
                  <EmptyState size="panel" icon={<CheckCircle />} title="All clear!"
                    description="No deadlines, tasks, or follow-ups need attention right now." />
                )
              ) : (
                // A search shows what it found; otherwise the worst 10, then "Show all"
                renderList(filteredItems, debouncedSearch.trim() ? undefined : { first: WHATS_DUE_FIRST, all: whatsDueAll, onShowAll: showAllWhatsDue })
              )}
            </>
          )}

          {/* Overdue tab */}
          {topTab === 'overdue' && (
            overdueItems.length === 0 ? (
              <EmptyState size="panel" icon={<CheckCircle />} title="Nothing overdue"
                description="Great work — you're all caught up!" />
            ) : (
              renderList(overdueItems)
            )
          )}

          {/* Next 7 days and Next 30 days: rolling from today; the calendar week and month are on the Calendar */}
          {topTab === 'next7' && (
            <WeekViewTab items={windows.next7} today={today} isLoading={showSpinner} onMarkDone={dropAndReload} onUndone={deadlinesChanged} />
          )}
          {topTab === 'next30' && (
            <MonthViewTab items={windows.next30} today={today} isLoading={showSpinner} onMarkDone={dropAndReload} onUndone={deadlinesChanged} />
          )}

        </div>
      </div>
  )

  // Recently archived is a card people can hide or move, not a tab among the deadlines (UX D-20)
  const recentlyArchived = (
    // A heading on the page, not a card (Q8)
    <section aria-labelledby="recently-archived-title" className="mb-8">
      <h2 id="recently-archived-title" className="flex items-center gap-2 text-xl font-semibold text-slate-800 dark:text-slate-100">
        <Archive className="w-5 h-5 text-slate-500 dark:text-slate-400" aria-hidden="true" />
        Recently archived
      </h2>
      <RecentlyArchivedTab
        rows={filteredArchived}
        isLoading={showSpinner}
        search={archiveSearch}
        onSearchChange={setArchiveSearch}
        // The tab announces it, and useListsChanged reloads the rest
        onReactivated={(id) => setArchivedRows(prev => prev.filter(r => r.id !== id))}
      />
    </section>
  )

  const printExportItems = [
    // The What's due rows on paper, worst first, 12 pt black (persona study R7)
    { label: "Print what's due", hint: 'Overdue and the next 30 days, worst first, on paper', icon: <Printer className="w-4 h-4" />, onSelect: () => setPrintingDue(true) },
    { label: 'Monthly summary', hint: `How the month is going: ${t('requirement', { many: true })}, deadlines on time, missing information. A PDF.`, icon: <ShieldCheck className="w-4 h-4" />, onSelect: () => setShowCompliance(true) },
    { label: 'Add to my calendar…', hint: 'Save deadlines and follow-ups to Outlook or Google Calendar', icon: <CalendarPlus className="w-4 h-4" />, onSelect: () => setShowCalendar(true) },
    ...(lettersOn && allGrids.length > 0 ? [{ label: 'Print reminder letters', hint: 'Letters or postcards for everyone with a deadline next month', icon: <Mail className="w-4 h-4" />, onSelect: () => setPickingLettersList(true) }] : []),
  ]

  return (
    <div className="h-full overflow-auto bg-white dark:bg-slate-900">
      <div className="max-w-4xl xl:max-w-6xl mx-auto px-6 py-6">
        {/* The buttons wrap among themselves, right-aligned, instead of dropping under the title */}
        <div className="flex items-start gap-3 mb-6">
          <h1 className="text-2xl font-semibold text-slate-800 dark:text-slate-100 shrink-0 py-2">Dashboard</h1>
          <div className="flex flex-1 min-w-0 flex-wrap justify-end gap-3">
            {/* The occasional actions share one menu; Customize stays out (UX D-19) */}
            <PrintExportMenu items={printExportItems} />
            {/* The dashboard covers every list, so ask which one the letters are for (audit D-35) */}
            {pickingLettersList && (
              <ChooseListDialog title="Print reminder letters" grids={allGrids} initialId={openGridId} confirmLabel={`Choose this ${t('list')}`}
                onCancel={() => setPickingLettersList(false)}
                onChoose={id => {
                  setPickingLettersList(false)
                  void useGridStore.getState().loadGrid(id).then(() => setReminderLetters(true))
                }} />
            )}
            {reminderLetters && openGridId != null && <BatchDocumentsDialog gridId={openGridId} title="Print reminder letters" preferTemplate="Reminder" onClose={() => setReminderLetters(false)} />}
            <Tooltip content="Choose which cards show, and their order">
              <SecondaryButton size="compact" aria-pressed={customizing} onClick={() => setCustomizing(c => !c)} icon={<LayoutGrid className="w-4 h-4" />}>
                Customize
              </SecondaryButton>
            </Tooltip>
          </div>
          {showCompliance && <ComplianceSummaryDialog onClose={closeCompliance} />}
          {showCalendar && <CalendarExportDialog onClose={closeCalendar} />}
          {printingDue && <PrintDueDialog onClose={() => setPrintingDue(false)} />}
        </div>

        {showNextStep && <NextStepBanner step={step} />}

        {/* The full card while a workspace is new; one line under the counts once most steps are done (UX D-02) */}
        {!gettingStarted.compact && <GettingStartedCard state={gettingStarted} />}

        {/* Cards, in the order people chose (W10 §4) */}
        <DashboardCards customizing={customizing} onDoneCustomizing={() => setCustomizing(false)} whatsDue={whatsDue} recentlyArchived={recentlyArchived} summary={
        <>
        {/* One row of tiles; each opens what it counts (UX D-06). Only the status counts are coloured, and only above 0 (Q8) */}
        <div className="flex flex-wrap gap-3 mb-6 [&>*]:flex-1 [&>*]:min-w-[150px]">
          <SummaryCard
            label={activeLabel}
            value={stats?.totalActive ?? '—'}
            icon={<Users className="w-5 h-5" />}
            colorClass="text-slate-800 dark:text-slate-100"
            href="/grid"
          />
          <SummaryCard
            label="Overdue"
            value={isLoading ? '—' : derivedCounts.overdue}
            sub={!isLoading && overdueRecords ? `for ${overdueRecords} ${t('record', { count: overdueRecords })}` : undefined}
            icon={<AlertTriangle className="w-5 h-5" />}
            colorClass={derivedCounts.overdue > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-600 dark:text-slate-300'}
            urgent={derivedCounts.overdue > 0}
            onClick={() => openTab('overdue')}
          />
          <SummaryCard
            label="Due in the next 7 days"
            value={isLoading ? '—' : derivedCounts.next7}
            icon={<Clock className="w-5 h-5" />}
            colorClass={derivedCounts.next7 > 0 ? 'text-orange-700 dark:text-orange-400' : 'text-slate-600 dark:text-slate-300'}
            onClick={() => openTab('next7')}
          />
          <SummaryCard
            label="Due in the next 30 days"
            value={isLoading ? '—' : derivedCounts.next30}
            icon={<Calendar className="w-5 h-5" />}
            colorClass={derivedCounts.next30 > 0 ? 'text-yellow-700 dark:text-yellow-400' : 'text-slate-600 dark:text-slate-300'}
            onClick={() => openTab('next30')}
          />
          {/* Tasks, checklist items and follow-ups count in the three tiles above, like the tabs they open (R6) */}
        </div>
        {/* How the requirements stand, without scrolling past What's due to their card (R6) */}
        {requirementsOn && <RequirementsLine />}
        {gettingStarted.compact && <GettingStartedCard state={gettingStarted} />}
        </>
        } />

      </div>
    </div>
  )
}
