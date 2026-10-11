/**
 * DashboardView — Four tabs: Priority List, This Month, Completion, Recently Archived
 */
import { onTabListKeyDown } from '../utils/tabListKeys'
import React, { useEffect, useState, useMemo, useCallback } from 'react'
import { AlertTriangle, Calendar, CheckCircle, Clock, Users, Archive, ClipboardList, RefreshCw, Info, Printer, ShieldCheck, CalendarPlus, LayoutGrid, Mail } from 'lucide-react'
import { CalendarExportDialog } from '../components/reports/CalendarExportDialog'
import { ComplianceSummaryDialog } from '../components/reports/ComplianceSummaryDialog'
import toast from 'react-hot-toast'
import { useSettingsStore } from '../stores/settingsStore'
import { localDateString } from '../../shared/dates'
import { noteUnencryptedExport } from '../utils/exportNotice'
import { IPC } from '../../shared/ipc-channels'
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
import { GettingStartedCard } from './dashboard/GettingStartedCard'
import { ChooseListDialog } from '../components/shared/ChooseListDialog'
import { wordNow } from '../utils/vocab'

import type { FollowUpRow, RawDeadlineRow, ArchivedRow, ExtendedDeadlineInfo, TopTab, FilterTab, PriorityItem } from './dashboard/types'
import { SummaryCard } from './dashboard/SummaryCard'
import { DeadlineRow } from './dashboard/DeadlineRow'
import { completeDeadlines, skippedForBulkDone } from './dashboard/completeDeadline'
import { countDeadlineTiles, isLateDeadline } from './dashboard/tileCounts'
import { useListsChanged } from './dashboard/useDashboardRefresh'
import { RuleColorKey } from '../components/alerts/RuleColorKey'
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

const LOAD_ERROR = 'We couldn\u2019t load the dashboard \u2014 try again.'

export default function DashboardView(): React.ReactElement {
  const showTasks = useFeature('tasks')
  const showChecklists = useFeature('checklists')
  const [customizing, setCustomizing] = useState(false)
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
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [topTab, setTopTab] = useState<TopTab>('priority')
  // Bulk "mark done" selection, keyed rowId:columnId
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
  useEffect(() => { setSelectedDeadlines(new Set()) }, [topTab])
  // The "All | Overdue" sub-filter is gone: the Overdue tab covers it (D-21)
  const [filterTab] = useState<FilterTab>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [archiveSearch, setArchiveSearch] = useState('')
  const [debouncedArchiveSearch, setDebouncedArchiveSearch] = useState('')
  const [showSpinner, setShowSpinner] = useState(false)
  const [showColorLegend, setShowColorLegend] = useState(false)
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
    if (res.ok) setFollowUps(res.data)
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
    if (result.ok) setRawDeadlines(result.data)
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
        setFollowUps(allRes.data.followUps)
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

  // Initial load
  useEffect(() => {
    let cancelled = false
    void loadAll({ isCancelled: () => cancelled })
    return () => { cancelled = true }
  }, [loadAll])

  // Sample data added or removed, a list added, deleted or restored, or a record reactivated
  // (here or by Undo) while the dashboard is open
  useListsChanged(() => { void loadAll({ quiet: true }) })

  // Done, Undo or an extension from any of the dashboard's lists: tell everything showing
  // deadlines (the cards too), and reload ours through the listener below
  const deadlinesChanged = useCallback(async () => { pulseEvents.emit('deadline:changed') }, [])

  // Refresh deadlines when cleared here, from FocusModeView or a note (or undone)
  useEffect(() => {
    const unsub = pulseEvents.on('deadline:changed', () => { void reloadDeadlines() })
    return unsub
  }, [reloadDeadlines])

  // Refresh follow-ups when completed/uncompleted from FocusModeView (or undone)
  useEffect(() => {
    const unsub = pulseEvents.on('followup:changed', () => { void reloadFollowUps() })
    return unsub
  }, [reloadFollowUps])

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
    const today = new Date(); today.setHours(0,0,0,0)
    // Switched-off features hide their rows everywhere on the dashboard
    if (!showTasks) return []
    return tasksDue.map(t => {
      let daysUntil = 9999
      if (t.due_date) {
        const d = new Date(t.due_date + 'T00:00:00')
        daysUntil = Math.round((d.getTime() - today.getTime()) / MS_PER_DAY)
      }
      return { task: t, daysUntil }
    })
  }, [tasksDue, showTasks])

  // Compute daysUntil for each checklist item with a due date
  const checklistWithDays = useMemo(() => {
    const today = new Date(); today.setHours(0,0,0,0)
    if (!showChecklists) return []
    return checklistDue.map(ci => {
      const d = new Date(ci.due_date! + 'T00:00:00')
      const daysUntil = Math.round((d.getTime() - today.getTime()) / MS_PER_DAY)
      return { item: ci, daysUntil }
    })
  }, [checklistDue, showChecklists])

  // Compute daysUntil for each follow-up
  const followUpsWithDays = useMemo(() => {
    const today = new Date(); today.setHours(0,0,0,0)
    return followUps.map(f => {
      const d = new Date(f.follow_up_date + 'T00:00:00')
      const daysUntil = Math.round((d.getTime() - today.getTime()) / MS_PER_DAY)
      return { followUp: f, daysUntil }
    })
  }, [followUps])

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
  const derivedCounts = useMemo(() => {
    const c = countDeadlineTiles(deadlines)
    const otherDue = [...tasksWithDays, ...checklistWithDays, ...followUpsWithDays].filter(x => x.daysUntil <= 0).length
    return { ...c, otherDue }
  }, [deadlines, tasksWithDays, checklistWithDays, followUpsWithDays])

  const filteredItems = useMemo((): PriorityItem[] => {
    const q = debouncedSearch.toLowerCase()
    const items: PriorityItem[] = []

    const matchesTab = (daysUntil: number, isDeadline?: boolean, threshold?: unknown) => {
      if (filterTab === 'overdue') return daysUntil < 0
      return isDeadline ? threshold !== null : true
    }

    for (const d of deadlines) {
      if (!matchesTab(d.daysUntil, true, d.threshold)) continue
      if (q && !d.clientName.toLowerCase().includes(q) && !d.columnName.toLowerCase().includes(q) && !d.gridName.toLowerCase().includes(q)) continue
      items.push({ kind: 'deadline', data: d, sortKey: d.daysUntil })
    }
    for (const { task, daysUntil } of tasksWithDays) {
      if (!matchesTab(daysUntil)) continue
      if (q && !task.title.toLowerCase().includes(q) && !(task.category ?? '').toLowerCase().includes(q)) continue
      items.push({ kind: 'task', data: task, daysUntil, sortKey: daysUntil })
    }
    for (const { item: ci, daysUntil } of checklistWithDays) {
      if (!matchesTab(daysUntil)) continue
      if (q && !ci.title.toLowerCase().includes(q) && !(ci.client_name ?? '').toLowerCase().includes(q) && !ci.grid_name.toLowerCase().includes(q)) continue
      items.push({ kind: 'checklist', data: ci, daysUntil, sortKey: daysUntil })
    }
    for (const { followUp, daysUntil } of followUpsWithDays) {
      if (!matchesTab(daysUntil)) continue
      if (q && !(followUp.client_name ?? '').toLowerCase().includes(q) && !followUp.content.toLowerCase().includes(q) && !followUp.grid_name.toLowerCase().includes(q)) continue
      items.push({ kind: 'followup', data: followUp, daysUntil, sortKey: daysUntil })
    }

    return items.sort((a, b) => a.sortKey - b.sortKey)
  }, [deadlines, tasksWithDays, checklistWithDays, followUpsWithDays, filterTab, debouncedSearch])

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

  const TOP_TABS = useMemo<{ key: TopTab; label: string; icon: React.ReactNode }[]>(() => [
    { key: 'priority',   label: 'Priority List',       icon: <AlertTriangle className="w-4 h-4" /> },
    { key: 'overdue',    label: 'Overdue',              icon: <AlertTriangle className="w-4 h-4" /> },
    { key: 'week',       label: 'This Week',            icon: <Clock className="w-4 h-4" /> },
    { key: 'month',      label: 'This Month',           icon: <Calendar className="w-4 h-4" /> },
  ], [])

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
    if (!res.ok) { toast.error("We couldn't create the weekly planner. Please try again."); return }
    if (res.data) { toast.success('Weekly planner saved.'); noteUnencryptedExport() }
  }

  function renderBulkBar(visible: PriorityItem[]) {
    if (selectedDeadlines.size === 0) return null
    return (
      <div className="sticky top-0 z-10 flex items-center gap-3 px-4 py-2 bg-blue-50 dark:bg-blue-900/40 border-b border-blue-200 dark:border-blue-800">
        <span className="text-base font-medium text-blue-900 dark:text-blue-100 flex-1">{selectedDeadlines.size} selected</span>
        <button type="button" className="btn-compact-primary" disabled={bulkBusy} onClick={() => void markSelectedDone(visible)}>
          {bulkBusy ? 'Marking…' : 'Mark done'}
        </button>
        <button type="button" className="btn-compact-secondary" onClick={() => setSelectedDeadlines(new Set())}>Clear</button>
      </div>
    )
  }

  // "What's due" is a card like the others, second by default (D-21)
  const whatsDue = (
      <div className="mb-6">
        {/* Utilities row: color legend toggle */}
        <div className="flex items-center mb-4">
          <button
            onClick={() => setShowColorLegend(prev => !prev)}
            className="hit-44 flex items-center gap-1.5 text-base text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 rounded px-2 py-1"
            title="Toggle deadline color guide"
            aria-label="Toggle deadline color guide"
            aria-expanded={showColorLegend}
            style={{ minHeight: 44 }}
          >
            <Info className="w-4 h-4" />
            Deadline Colors
          </button>
        </div>

        {/* Deadline color legend */}
        {showColorLegend && (
          <div className="mb-4 p-3 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
            <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Deadline Color Guide</h3>
            {/* Built from the rules in use: each sets its own colors (D-29) */}
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">
              The stripe on the left of each row: red = late or due today, orange = due this week, yellow = due this month.
            </p>
            <div className="space-y-2">
              {rulesInUse.length === 0
                ? <p className="text-sm text-slate-500 dark:text-slate-400">No deadline rules are in use yet.</p>
                : rulesInUse.map(r => <RuleColorKey key={r.id} rule={r} />)}
            </div>
          </div>
        )}

        {/* Top tab bar */}
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
          <div data-tour="dashboard-tabs" className="flex border-b border-slate-200 dark:border-slate-700 overflow-x-auto overflow-y-hidden" role="tablist" onKeyDown={onTabListKeyDown}>
            {TOP_TABS.map(tab => (
              <button
                key={tab.key}
                role="tab"
                aria-selected={topTab === tab.key}
                tabIndex={topTab === tab.key || (topTab === 'archived' && tab.key === 'priority') ? 0 : -1}
                onClick={() => setTopTab(tab.key)}
                className={`flex items-center gap-2 px-4 py-3 text-base font-medium border-b-2 whitespace-nowrap transition-colors focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500
                  ${topTab === tab.key
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
                    : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}
                style={{ minHeight: 44 }}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
            {/* Recently archived sits behind a link, not among the deadline tabs (D-21) */}
            <button type="button" onClick={() => setTopTab(topTab === 'archived' ? 'priority' : 'archived')} aria-pressed={topTab === 'archived'}
              className="ml-auto flex items-center gap-1.5 px-4 text-base text-blue-700 dark:text-blue-300 underline hover:no-underline whitespace-nowrap focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
              style={{ minHeight: 44 }}>
              <Archive className="w-4 h-4" aria-hidden="true" />
              {topTab === 'archived' ? 'Back to what\'s due' : 'Recently archived'}
            </button>
          </div>

          {/* Priority List tab */}
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
                  {filterTab === 'all' && stats?.totalActive === 0 ? (
                    <>
                      <p className="text-base font-semibold text-slate-700 dark:text-slate-300">Nothing here yet</p>
                      <p className="text-base text-slate-500 dark:text-slate-400">Your dashboard fills up as you add {t('record', { many: true })} with dates.</p>
                      <button type="button" className="btn-secondary mt-2" onClick={() => pulseEvents.emit('starters:open', { sample: true })}>
                        See an example with sample data
                      </button>
                    </>
                  ) : filterTab === 'all' ? (
                    <>
                      <CheckCircle className="w-12 h-12 text-green-400 dark:text-green-500 opacity-60" />
                      <p className="text-base font-semibold text-slate-700 dark:text-slate-300">All clear!</p>
                      <p className="text-base text-slate-500 dark:text-slate-400">No deadlines, tasks, or follow-ups need attention right now.</p>
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-12 h-12 text-green-400 dark:text-green-500 opacity-60" />
                      <p className="text-base font-semibold text-slate-700 dark:text-slate-300">Nothing overdue</p>
                      <p className="text-base text-slate-500 dark:text-slate-400">Great work — you're all caught up!</p>
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
                        onToggleSelect={() => toggleDeadline(item.data)}
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
                      onToggleSelect={() => toggleDeadline(item.data)}
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

          {/* Recently Archived tab */}
          {topTab === 'archived' && (
            <RecentlyArchivedTab
              rows={filteredArchived}
              isLoading={showSpinner}
              search={archiveSearch}
              onSearchChange={setArchiveSearch}
              // The tab announces it, and useListsChanged reloads the rest
              onReactivated={(id) => setArchivedRows(prev => prev.filter(r => r.id !== id))}
            />
          )}
        </div>
      </div>
  )

  return (
    <div className="h-full overflow-auto bg-white dark:bg-slate-900">
      <div className="max-w-4xl xl:max-w-6xl mx-auto px-6 py-6">
        {/* The buttons wrap among themselves, right-aligned, instead of dropping under the title */}
        <div className="flex items-start gap-3 mb-6">
          <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100 shrink-0 py-2">Dashboard</h1>
          <div className="flex flex-1 min-w-0 flex-wrap justify-end gap-3">
            <button type="button" className="btn-compact-secondary" onClick={() => void printWeeklyPlanner()} title="A one-page PDF of everything due this week, to print or carry">
              <Printer className="w-4 h-4" aria-hidden="true" />
              Print this week
            </button>
            <button type="button" className="btn-compact-secondary" onClick={() => setShowCompliance(true)} title={`${t('activity', { many: true, cap: true })} and deadlines for a month, with exceptions, as a PDF`}>
              <ShieldCheck className="w-4 h-4" aria-hidden="true" />
              Monthly summary
            </button>
            <button type="button" className="btn-compact-secondary" onClick={() => setShowCalendar(true)} title="Save deadlines and follow-ups to Outlook or Google Calendar">
              <CalendarPlus className="w-4 h-4" aria-hidden="true" />
              Add to calendar
            </button>
            {lettersOn && allGrids.length > 0 && (
              <button type="button" className="btn-compact-secondary" onClick={() => setPickingLettersList(true)} title="Letters or postcards for everyone with a deadline next month">
                <Mail className="w-4 h-4" aria-hidden="true" />
                Print reminder letters
              </button>
            )}
            {/* The dashboard covers every list, so ask which one the letters are for (audit D-35) */}
            {pickingLettersList && (
              <ChooseListDialog title="Print reminder letters" grids={allGrids} initialId={openGridId} confirmLabel="Continue"
                onCancel={() => setPickingLettersList(false)}
                onChoose={id => {
                  setPickingLettersList(false)
                  void useGridStore.getState().loadGrid(id).then(() => setReminderLetters(true))
                }} />
            )}
            {reminderLetters && openGridId != null && <BatchDocumentsDialog gridId={openGridId} onClose={() => setReminderLetters(false)} />}
            <button type="button" className="btn-compact-secondary" aria-pressed={customizing} onClick={() => setCustomizing(c => !c)} title="Choose which cards show, and their order">
              <LayoutGrid className="w-4 h-4" aria-hidden="true" />
              Customize
            </button>
          </div>
          {showCompliance && <ComplianceSummaryDialog onClose={closeCompliance} />}
          {showCalendar && <CalendarExportDialog onClose={closeCalendar} />}
        </div>

        <GettingStartedCard />

        {/* Cards, in the order people chose (W10 §4) */}
        <DashboardCards customizing={customizing} onDoneCustomizing={() => setCustomizing(false)} whatsDue={whatsDue} summary={
        <div className="grid grid-cols-2 gap-4 mb-6 sm:grid-cols-3 xl:grid-cols-5">
          <SummaryCard
            label={activeLabel}
            value={stats?.totalActive ?? '—'}
            icon={<Users className="w-5 h-5" />}
            colorClass="text-blue-600 dark:text-blue-400"
          />
          <SummaryCard
            label="Overdue deadlines"
            value={isLoading ? '—' : derivedCounts.overdue}
            icon={<AlertTriangle className="w-5 h-5" />}
            colorClass={derivedCounts.overdue > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-500'}
            urgent={derivedCounts.overdue > 0}
          />
          <SummaryCard
            label="Due in the next 7 days"
            value={isLoading ? '—' : derivedCounts.dueThisWeek}
            icon={<Clock className="w-5 h-5" />}
            colorClass="text-orange-600 dark:text-orange-400"
          />
          <SummaryCard
            label="Due in the next 30 days"
            value={isLoading ? '—' : derivedCounts.dueThisMonth}
            icon={<Calendar className="w-5 h-5" />}
            colorClass="text-yellow-600 dark:text-yellow-400"
          />
          {(showTasks || showChecklists) && (<>
            <SummaryCard
              label="Tasks & follow-ups due or late"
              value={isLoading ? '—' : derivedCounts.otherDue}
              icon={<ClipboardList className="w-5 h-5" />}
              colorClass={derivedCounts.otherDue > 0 ? 'text-purple-600 dark:text-purple-400' : 'text-slate-500'}
              urgent={derivedCounts.otherDue > 0}
              href="/tasks"
            />
          </>)}
        </div>
        } />

      </div>
    </div>
  )
}
