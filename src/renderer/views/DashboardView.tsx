/**
 * DashboardView — count tiles, then the tabs What's due, Overdue, This week,
 * This month, then the cards people chose (Recently archived among them).
 */
import { onTabListKeyDown } from '../utils/tabListKeys'
import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { AlertTriangle, Calendar, CheckCircle, Clock, Users, Archive, ClipboardList, RefreshCw, Printer, ShieldCheck, CalendarPlus, LayoutGrid, Mail } from 'lucide-react'
import { CalendarExportDialog } from '../components/reports/CalendarExportDialog'
import { ComplianceSummaryDialog } from '../components/reports/ComplianceSummaryDialog'
import toast from 'react-hot-toast'
import { useSettingsStore } from '../stores/settingsStore'
import { localDateString } from '../../shared/dates'
import { useToday } from '../hooks/useToday'
import { noteUnencryptedExport } from '../utils/exportNotice'
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
import { daysLeftInWeek, monthTabCount, weekTabCount } from './dashboard/tabCounts'
import { ChooseListDialog } from '../components/shared/ChooseListDialog'
import { wordNow } from '../utils/vocab'

import type { FollowUpRow, RawDeadlineRow, ArchivedRow, ExtendedDeadlineInfo, TopTab, PriorityItem } from './dashboard/types'
import { SummaryCard } from './dashboard/SummaryCard'
import { DeadlineRow } from './dashboard/DeadlineRow'
import { completeDeadlines, skippedForBulkDone } from './dashboard/completeDeadline'
import { dashboardTileCounts, deadlinesMayBeCut, followUpsMayBeCut, isLateDeadline } from './dashboard/tileCounts'
import { useListsChanged } from './dashboard/useDashboardRefresh'
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
import { RecentlyArchivedTab } from './dashboard/RecentlyArchivedTab'
import { useFeature } from '../hooks/useFeature'

const LOAD_ERROR = "We couldn't load the dashboard — try again"

export default function DashboardView(): React.ReactElement {
  const showTasks = useFeature('tasks')
  const showChecklists = useFeature('checklists')
  const [customizing, setCustomizing] = useState(false)
  const gettingStarted = useGettingStarted()
  const weekStart = useSettingsStore(s => s.weekStart)
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
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [archiveSearch, setArchiveSearch] = useState('')
  const [debouncedArchiveSearch, setDebouncedArchiveSearch] = useState('')
  const [showSpinner, setShowSpinner] = useState(false)
  const [showCompliance, setShowCompliance] = useState(false)
  const closeCompliance = useCallback(() => setShowCompliance(false), [])
  const [showCalendar, setShowCalendar] = useState(false)
  const closeCalendar = useCallback(() => setShowCalendar(false), [])

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

  // The tiles count deadlines the way the morning briefing and desktop reminder do
  // (overdue includes a used-up quota); tasks, checklist items and follow-ups due
  // or late get their own tile, the same as the briefing's "task due" lines
  const derivedCounts = useMemo(() => dashboardTileCounts({
    deadlines, deadlinesCut: deadlinesCut, followUpDays: followUpsWithDays.map(f => f.daysUntil), followUpsCut: followUpsCut,
    otherDueDays: [...tasksWithDays, ...checklistWithDays].map(x => x.daysUntil), server: stats,
  }), [deadlines, deadlinesCut, tasksWithDays, checklistWithDays, followUpsWithDays, followUpsCut, stats])

  const filteredItems = useMemo((): PriorityItem[] => {
    const q = debouncedSearch.toLowerCase()
    const items: PriorityItem[] = []

    for (const d of deadlines) {
      if (d.threshold === null) continue
      if (q && !d.clientName.toLowerCase().includes(q) && !d.columnName.toLowerCase().includes(q) && !d.gridName.toLowerCase().includes(q)) continue
      items.push({ kind: 'deadline', data: d, sortKey: d.daysUntil })
    }
    for (const { task, daysUntil } of tasksWithDays) {
      if (q && !task.title.toLowerCase().includes(q) && !(task.category ?? '').toLowerCase().includes(q)) continue
      items.push({ kind: 'task', data: task, daysUntil, sortKey: daysUntil })
    }
    for (const { item: ci, daysUntil } of checklistWithDays) {
      if (q && !ci.title.toLowerCase().includes(q) && !(ci.client_name ?? '').toLowerCase().includes(q) && !ci.grid_name.toLowerCase().includes(q)) continue
      items.push({ kind: 'checklist', data: ci, daysUntil, sortKey: daysUntil })
    }
    for (const { followUp, daysUntil } of followUpsWithDays) {
      if (q && !(followUp.client_name ?? '').toLowerCase().includes(q) && !followUp.content.toLowerCase().includes(q) && !followUp.grid_name.toLowerCase().includes(q)) continue
      items.push({ kind: 'followup', data: followUp, daysUntil, sortKey: daysUntil })
    }

    return items.sort((a, b) => a.sortKey - b.sortKey)
  }, [deadlines, tasksWithDays, checklistWithDays, followUpsWithDays, debouncedSearch])

  const overdueItems = useMemo((): PriorityItem[] => {
    const items: PriorityItem[] = []
    // Like the Overdue tile: late, or a used-up quota
    for (const d of deadlines) { if (isLateDeadline(d)) items.push({ kind: 'deadline', data: d, sortKey: d.daysUntil }) }
    for (const { task, daysUntil } of tasksWithDays) { if (daysUntil < 0) items.push({ kind: 'task', data: task, daysUntil, sortKey: daysUntil }) }
    for (const { item: ci, daysUntil } of checklistWithDays) { if (daysUntil < 0) items.push({ kind: 'checklist', data: ci, daysUntil, sortKey: daysUntil }) }
    for (const { followUp, daysUntil } of followUpsWithDays) { if (daysUntil < 0) items.push({ kind: 'followup', data: followUp, daysUntil, sortKey: daysUntil }) }
    return items.sort((a, b) => a.sortKey - b.sortKey)
  }, [deadlines, tasksWithDays, checklistWithDays, followUpsWithDays])

  const filteredArchived = useMemo(() => {
    if (!debouncedArchiveSearch) return archivedRows
    const q = debouncedArchiveSearch.toLowerCase()
    return archivedRows.filter(r =>
      (r.client_name ?? '').toLowerCase().includes(q) ||
      r.grid_name.toLowerCase().includes(q) ||
      (r.archived_reason ?? '').toLowerCase().includes(q)
    )
  }, [archivedRows, debouncedArchiveSearch])

  // Each tab says how many rows are behind it (UX D-20); the counts use the tabs' own filters
  const tabCounts = useMemo<Record<TopTab, number>>(() => {
    const todayStart = new Date(today + 'T00:00:00')
    return {
      priority: deadlines.filter(d => d.threshold !== null).length + tasksWithDays.length + checklistWithDays.length + followUpsWithDays.length,
      overdue: overdueItems.length,
      week: weekTabCount({ deadlines, tasksWithDays, checklistWithDays, followUpsWithDays, daysLeft: daysLeftInWeek(todayStart, weekStart) }),
      month: monthTabCount(deadlines, todayStart),
    }
  }, [deadlines, tasksWithDays, checklistWithDays, followUpsWithDays, overdueItems, today, weekStart])

  const TOP_TABS = useMemo<{ key: TopTab; label: string; icon: React.ReactNode }[]>(() => [
    { key: 'priority',   label: "What's due",   icon: <AlertTriangle className="w-4 h-4" /> },
    { key: 'overdue',    label: 'Overdue',      icon: <AlertTriangle className="w-4 h-4" /> },
    { key: 'week',       label: 'This week',    icon: <Clock className="w-4 h-4" /> },
    { key: 'month',      label: 'This month',   icon: <Calendar className="w-4 h-4" /> },
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

  async function printWeeklyPlanner() {
    // Start of this week per the user's preference (Sunday or Monday)
    const startsMonday = useSettingsStore.getState().weekStart === 'monday'
    const d = new Date()
    const back = startsMonday ? (d.getDay() + 6) % 7 : d.getDay()
    d.setDate(d.getDate() - back)
    const res = await safeInvoke(IPC.EXPORT_WEEKLY_PLANNER, localDateString(d))
    if (!res.ok) { toast.error("We couldn't make the PDF of this week — try again"); return }
    if (res.data) { toast.success('Saved the PDF of this week.'); noteUnencryptedExport() }
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
        <button type="button" className="btn-compact-primary" disabled={bulkBusy || selectedDeadlines.size === 0} onClick={() => void markSelectedDone(visible)}>
          {bulkBusy ? 'Marking…' : 'Mark done'}
        </button>
        <button type="button" className="btn-compact-secondary" onClick={() => setSelectedDeadlines(new Set())}>Clear</button>
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
            </div>
          )}

          {/* What's due tab */}
          {topTab === 'priority' && (
            <>
              <div className="flex items-center justify-end px-4 py-2 border-b border-slate-200 dark:border-slate-700 flex-wrap gap-2">
                <input
                  type="search"
                  placeholder="Search…"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="input w-48 py-1.5 text-base"
                  style={{ minHeight: 44 }}
                />
              </div>
              {isLoading ? (
                showSpinner ? <LoadingOverlay label="Loading dashboard…" /> : <div className="py-16" />
              ) : filteredItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-2 text-slate-500 dark:text-slate-400">
                  {debouncedSearch.trim() ? (
                    // A search that finds nothing isn't an empty dashboard
                    <p className="text-base font-semibold text-slate-700 dark:text-slate-300">Nothing matches &ldquo;{debouncedSearch.trim()}&rdquo;</p>
                  ) : stats?.totalActive === 0 ? (
                    <>
                      <p className="text-base font-semibold text-slate-700 dark:text-slate-300">Nothing here yet</p>
                      <p className="text-base text-slate-500 dark:text-slate-400">Your dashboard fills up as you add {t('record', { many: true })} with dates.</p>
                      <button type="button" className="btn-secondary mt-2" onClick={() => pulseEvents.emit('starters:open', { sample: true })}>
                        See an example with sample data
                      </button>
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-12 h-12 text-green-400 dark:text-green-500 opacity-60" />
                      <p className="text-base font-semibold text-slate-700 dark:text-slate-300">All clear!</p>
                      <p className="text-base text-slate-500 dark:text-slate-400">No deadlines, tasks, or follow-ups need attention right now.</p>
                    </>
                  )}
                </div>
              ) : (
                <div role="list">
                  {renderBulkBar(filteredItems)}
                  {filteredItems.map((item, i) =>
                    item.kind === 'deadline' ? (
                      <DeadlineRow
                        key={`dl-${item.data.rowId}-${item.data.columnId}-${i}`}
                        deadline={item.data}
                        selected={selectedDeadlines.has(deadlineKey(item.data))}
                        onToggleSelect={selecting ? () => toggleDeadline(item.data) : undefined}
                        onMarkDone={(rowId, columnId) => {
                          setRawDeadlines(prev => prev.filter(r => !(r.row_id === rowId && r.column_id === columnId)))
                          void deadlinesChanged()
                        }}
                        onUndoneMarkDone={deadlinesChanged}
                      />
                    ) : item.kind === 'task' ? (
                      <TaskRow
                        key={`task-${item.data.id}`}
                        task={item.data}
                        daysUntil={item.daysUntil}
                        onComplete={(id) => {
                          setTasksDue(prev => prev.filter(t => t.id !== id))
                        }}
                        onRestore={(t) => {
                          setTasksDue(prev => prev.some(x => x.id === t.id) ? prev : [...prev, t])
                        }}
                      />
                    ) : item.kind === 'checklist' ? (
                      <ChecklistDueRow
                        key={`cl-${item.data.id}`}
                        item={item.data}
                        daysUntil={item.daysUntil}
                        onComplete={(id) => {
                          setChecklistDue(prev => prev.filter(ci => ci.id !== id))
                        }}
                        onRestore={(ci) => {
                          setChecklistDue(prev => prev.some(x => x.id === ci.id) ? prev : [...prev, ci])
                        }}
                      />
                    ) : (
                      <FollowUpDashRow
                        key={`fu-${item.data.id}`}
                        followUp={item.data}
                        daysUntil={item.daysUntil}
                        onComplete={(id) => {
                          setFollowUps(prev => prev.filter(f => f.id !== id))
                        }}
                        onReloadFollowUps={async () => { await reloadFollowUps() }}
                      />
                    )
                  )}
                </div>
              )}
            </>
          )}

          {/* Overdue tab */}
          {topTab === 'overdue' && (
            overdueItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-2 text-slate-500 dark:text-slate-400">
                <CheckCircle className="w-12 h-12 text-green-400 dark:text-green-500 opacity-60" />
                <p className="text-base font-semibold text-slate-700 dark:text-slate-300">Nothing overdue</p>
                <p className="text-base text-slate-500 dark:text-slate-400">Great work — you're all caught up!</p>
              </div>
            ) : (
              <div role="list">
                {renderBulkBar(overdueItems)}
                {overdueItems.map((item, i) =>
                  item.kind === 'deadline' ? (
                    <DeadlineRow
                      key={`dl-${item.data.rowId}-${item.data.columnId}-${i}`}
                      deadline={item.data}
                      selected={selectedDeadlines.has(deadlineKey(item.data))}
                      onToggleSelect={selecting ? () => toggleDeadline(item.data) : undefined}
                      onMarkDone={(rowId, columnId) => {
                          setRawDeadlines(prev => prev.filter(r => !(r.row_id === rowId && r.column_id === columnId)))
                          void deadlinesChanged()
                        }}
                        onUndoneMarkDone={deadlinesChanged}
                    />
                  ) : item.kind === 'task' ? (
                    <TaskRow
                      key={`task-${item.data.id}`}
                      task={item.data}
                      daysUntil={item.daysUntil}
                      onComplete={(id) => {
                        setTasksDue(prev => prev.filter(t => t.id !== id))
                      }}
                      onRestore={(t) => {
                        setTasksDue(prev => prev.some(x => x.id === t.id) ? prev : [...prev, t])
                      }}
                    />
                  ) : item.kind === 'checklist' ? (
                    <ChecklistDueRow
                      key={`cl-${item.data.id}`}
                      item={item.data}
                      daysUntil={item.daysUntil}
                      onComplete={(id) => {
                        setChecklistDue(prev => prev.filter(ci => ci.id !== id))
                      }}
                      onRestore={(ci) => {
                        setChecklistDue(prev => prev.some(x => x.id === ci.id) ? prev : [...prev, ci])
                      }}
                    />
                  ) : (
                    <FollowUpDashRow
                      key={`fu-${item.data.id}`}
                      followUp={item.data}
                      daysUntil={item.daysUntil}
                      onComplete={(id) => {
                        setFollowUps(prev => prev.filter(f => f.id !== id))
                      }}
                      onReloadFollowUps={async () => { await reloadFollowUps() }}
                    />
                  )
                )}
              </div>
            )
          )}

          {/* This Week tab */}
          {topTab === 'week' && (
            <WeekViewTab deadlines={deadlines} tasksWithDays={tasksWithDays} checklistWithDays={checklistWithDays} followUpsWithDays={followUpsWithDays} isLoading={showSpinner}
              onMarkDone={dropAndReload} onUndone={deadlinesChanged} />
          )}

          {/* This Month tab */}
          {topTab === 'month' && (
            <MonthViewTab deadlines={deadlines} isLoading={showSpinner} onMarkDone={dropAndReload} onUndone={deadlinesChanged} />
          )}

        </div>
      </div>
  )

  // Recently archived is a card people can hide or move, not a tab among the deadlines (UX D-20)
  const recentlyArchived = (
    <section aria-labelledby="recently-archived-title" className="mb-6 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
      <h2 id="recently-archived-title" className="flex items-center gap-2 px-4 pt-3 text-base font-semibold text-slate-700 dark:text-slate-200">
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
    { label: 'Print this week', hint: 'A one-page PDF of everything due this week, to print or carry', icon: <Printer className="w-4 h-4" />, onSelect: () => void printWeeklyPlanner() },
    { label: 'Monthly summary', hint: `How the month is going: ${t('requirement', { many: true })}, deadlines on time, missing information. A PDF.`, icon: <ShieldCheck className="w-4 h-4" />, onSelect: () => setShowCompliance(true) },
    { label: 'Add to my calendar…', hint: 'Save deadlines and follow-ups to Outlook or Google Calendar', icon: <CalendarPlus className="w-4 h-4" />, onSelect: () => setShowCalendar(true) },
    ...(lettersOn && allGrids.length > 0 ? [{ label: 'Print reminder letters', hint: 'Letters or postcards for everyone with a deadline next month', icon: <Mail className="w-4 h-4" />, onSelect: () => setPickingLettersList(true) }] : []),
  ]

  return (
    <div className="h-full overflow-auto bg-white dark:bg-slate-900">
      <div className="max-w-4xl xl:max-w-6xl mx-auto px-6 py-6">
        {/* The buttons wrap among themselves, right-aligned, instead of dropping under the title */}
        <div className="flex items-start gap-3 mb-6">
          <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100 shrink-0 py-2">Dashboard</h1>
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
            <button type="button" className="btn-compact-secondary" aria-pressed={customizing} onClick={() => setCustomizing(c => !c)} title="Choose which cards show, and their order">
              <LayoutGrid className="w-4 h-4" aria-hidden="true" />
              Customize
            </button>
          </div>
          {showCompliance && <ComplianceSummaryDialog onClose={closeCompliance} />}
          {showCalendar && <CalendarExportDialog onClose={closeCalendar} />}
        </div>

        {/* The full card while a workspace is new; one line under the counts once most steps are done (UX D-02) */}
        {!gettingStarted.compact && <GettingStartedCard state={gettingStarted} />}

        {/* Cards, in the order people chose (W10 §4) */}
        <DashboardCards customizing={customizing} onDoneCustomizing={() => setCustomizing(false)} whatsDue={whatsDue} recentlyArchived={recentlyArchived} summary={
        <>
        {/* One row of tiles; each opens what it counts (UX D-06) */}
        <div className="flex flex-wrap gap-3 mb-6 [&>*]:flex-1 [&>*]:min-w-[150px]">
          <SummaryCard
            label={activeLabel}
            value={stats?.totalActive ?? '—'}
            icon={<Users className="w-5 h-5" />}
            colorClass="text-blue-600 dark:text-blue-400"
            href="/grid"
          />
          <SummaryCard
            label="Overdue deadlines"
            value={isLoading ? '—' : derivedCounts.overdue}
            icon={<AlertTriangle className="w-5 h-5" />}
            colorClass={derivedCounts.overdue > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-500'}
            urgent={derivedCounts.overdue > 0}
            onClick={() => openTab('overdue')}
          />
          <SummaryCard
            label="Due in the next 7 days"
            value={isLoading ? '—' : derivedCounts.dueThisWeek}
            icon={<Clock className="w-5 h-5" />}
            colorClass="text-orange-700 dark:text-orange-400"
            onClick={() => openTab('week')}
          />
          <SummaryCard
            label="Due in the next 30 days"
            value={isLoading ? '—' : derivedCounts.dueThisMonth}
            icon={<Calendar className="w-5 h-5" />}
            colorClass="text-yellow-700 dark:text-yellow-400"
            onClick={() => openTab('month')}
          />
          {(showTasks || showChecklists) && (<>
            <SummaryCard
              label="Tasks, checklist items and follow-ups due or late"
              value={isLoading ? '—' : derivedCounts.otherDue}
              icon={<ClipboardList className="w-5 h-5" />}
              colorClass={derivedCounts.otherDue > 0 ? 'text-purple-600 dark:text-purple-400' : 'text-slate-500'}
              urgent={derivedCounts.otherDue > 0}
              href="/tasks"
            />
          </>)}
        </div>
        {gettingStarted.compact && <GettingStartedCard state={gettingStarted} />}
        </>
        } />

      </div>
    </div>
  )
}
