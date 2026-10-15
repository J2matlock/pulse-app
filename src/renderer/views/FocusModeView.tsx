/**
 * FocusModeView — Ctrl+Shift+F full-screen overlay.
 * Shows only what needs attention today: record deadlines, tasks, checklist
 * items and follow-ups, each with Done (and the dashboard's Done on…,
 * Extend… and a Not now to put one aside). Follows the app theme (UX D-07).
 */
import React, { useEffect, useState, useCallback, useRef, useId } from 'react'
import { X, CheckCircle2, AlertTriangle, Pin, ListChecks, MessageSquare, CalendarClock } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { IPC } from '../../shared/ipc-channels'
import type { CaseloadTask, ChecklistDueItem } from '../../shared/types'
import { MS_PER_DAY } from '../../shared/constants'
import { safeInvoke, mustInvoke } from '../utils/safeInvoke'
import { useGridStore } from '../stores/gridStore'
import { useTaskStore } from '../stores/taskStore'
import { useUndoStore } from '../stores/undoStore'
import { pulseEvents } from '../events'
import { useToday } from '../hooks/useToday'
import { tickChecklistItem } from '../utils/checklistTick'
import type { RawDeadlineRow, FocusItem, FocusTask, FocusFollowUp, UrgentChecklistItem } from './focus-mode/types'
import { FocusSection } from './focus-mode/FocusSection'
import { ClientFocusItem } from './focus-mode/ClientFocusItem'
import { ChecklistFocusItem } from './focus-mode/ChecklistFocusItem'
import { FollowUpFocusItem } from './focus-mode/FollowUpFocusItem'
import { TaskFocusItem } from './focus-mode/TaskFocusItem'
import { rlog } from '../utils/rendererLogger'
import { focusDeadlineItems } from './focus-mode/focusItems'
import { completeDeadlines, isOneOffDeadline } from './dashboard/completeDeadline'
import { OneOffDoneDialog, type OneOffChoice } from './dashboard/OneOffDoneDialog'
import { MeterReadingDialog } from './dashboard/MeterReadingDialog'
import { DoneOnDayDialog } from './dashboard/DoneOnDayDialog'
import { ExtendDeadlineDialog } from './dashboard/ExtendDeadlineDialog'
import { extendDeadline } from './dashboard/extendDeadline'
import { useVocab } from '../hooks/useVocab'
import { wordNow } from '../utils/vocab'
import { useFeature } from '../hooks/useFeature'
import { shortYmd } from '../../shared/dates'

interface Props {
  onClose: () => void
}

export default function FocusModeView({ onClose }: Props): React.ReactElement {
  const dialogTitleId = useId()
  const tasksOn = useFeature('tasks')
  const checklistsOn = useFeature('checklists')
  const { t: w } = useVocab(null)
  const trapRef = useRef<HTMLDivElement>(null)
  useFocusTrap(trapRef, true)
  const navigate = useNavigate()
  const activeGridId = useGridStore(s => s.activeGridId)
  const loadGrid = useGridStore(s => s.loadGrid)
  const celebrationTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [isLoading, setIsLoading] = useState(true)
  const [clientItems, setClientItems] = useState<FocusItem[]>([])
  const [tasks, setTasks] = useState<FocusTask[]>([])
  const [urgentChecklists, setUrgentChecklists] = useState<UrgentChecklistItem[]>([])
  const [checklistDueItems, setChecklistDueItems] = useState<Array<ChecklistDueItem & { daysUntil: number }>>([])
  const [completedChecklistDue, setCompletedChecklistDue] = useState<Set<number>>(new Set())
  const [followUps, setFollowUps] = useState<FocusFollowUp[]>([])
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [completedTasks, setCompletedTasks] = useState<Set<number>>(new Set())
  const [completedChecklists, setCompletedChecklists] = useState<Set<number>>(new Set())
  const [completedFollowUps, setCompletedFollowUps] = useState<Set<number>>(new Set())
  const [loadError, setLoadError] = useState<string | null>(null)
  const [celebratingId, setCelebratingId] = useState<string | null>(null)
  const [clientExpanded, setClientExpanded] = useState(true)
  const [tasksExpanded, setTasksExpanded] = useState(true)
  const [checklistsExpanded, setChecklistsExpanded] = useState(true)
  const [checklistDueExpanded, setChecklistDueExpanded] = useState(true)
  const [followUpsExpanded, setFollowUpsExpanded] = useState(true)
  const [askReading, setAskReading] = useState<FocusItem | null>(null)
  const [askOneOff, setAskOneOff] = useState<FocusItem | null>(null)
  const [askDay, setAskDay] = useState<FocusItem | null>(null)
  const [extending, setExtending] = useState<FocusItem | null>(null)

  // Clean up celebration timer on unmount
  useEffect(() => () => { clearTimeout(celebrationTimerRef.current) }, [])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // A dialog open on top (the meter reading) closes itself first
      if (e.key === 'Escape' && document.querySelectorAll('[aria-modal="true"]').length <= 1) onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const today = useToday()
  useEffect(() => {
    async function load() {
      try {
        const [deadlinesResult, tasksResult, checklistsResult, clDueResult, followUpsResult] = await Promise.all([
          safeInvoke<RawDeadlineRow[]>(IPC.DASHBOARD_GET_DEADLINES),
          safeInvoke<CaseloadTask[]>(IPC.TASK_GET_DUE),
          safeInvoke<UrgentChecklistItem[]>(IPC.CHECKLIST_GET_URGENT),
          safeInvoke<ChecklistDueItem[]>(IPC.CHECKLIST_GET_DUE),
          safeInvoke<Array<{
            id: number; row_id: number; content: string; follow_up_date: string
            grid_name: string; client_name: string | null
          }>>(IPC.DASHBOARD_GET_FOLLOWUPS),
        ])

        // safeInvoke doesn't throw: without this a failed load showed "all clear"
        if (![deadlinesResult, tasksResult, checklistsResult, clDueResult, followUpsResult].every(r => r.ok)) {
          setLoadError('Could not load your focus items. Try closing and reopening Focus Mode.')
          return
        }
        if (deadlinesResult.ok) setClientItems(focusDeadlineItems(deadlinesResult.data))

        if (tasksResult.ok) {
          const today = new Date(); today.setHours(0, 0, 0, 0)
          setTasks(tasksResult.data.slice(0, 20).map(t => {
            let daysUntil = 9999
            if (t.due_date) {
              const d = new Date(t.due_date + 'T00:00:00')
              daysUntil = Math.round((d.getTime() - today.getTime()) / MS_PER_DAY)
            }
            return { id: t.id, title: t.title, category: t.category, priority: t.priority, due_date: t.due_date, daysUntil }
          }))
        }

        if (checklistsResult.ok) {
          setUrgentChecklists(checklistsResult.data.slice(0, 20))
        }

        if (clDueResult.ok) {
          const today = new Date(); today.setHours(0, 0, 0, 0)
          setChecklistDueItems(clDueResult.data.slice(0, 20).map(ci => {
            const d = new Date(ci.due_date! + 'T00:00:00')
            const daysUntil = Math.round((d.getTime() - today.getTime()) / MS_PER_DAY)
            return { ...ci, daysUntil }
          }))
        }

        if (followUpsResult.ok) {
          const today = new Date(); today.setHours(0, 0, 0, 0)
          const items: FocusFollowUp[] = followUpsResult.data.slice(0, 20).map(f => {
            const d = new Date(f.follow_up_date + 'T00:00:00')
            const daysUntil = Math.round((d.getTime() - today.getTime()) / MS_PER_DAY)
            return {
              id: f.id,
              rowId: f.row_id,
              clientName: f.client_name ?? `Unknown ${wordNow('record', {}, null)}`,
              gridName: f.grid_name,
              content: f.content,
              followUpDate: f.follow_up_date,
              daysUntil,
            }
          })
          setFollowUps(items)
        }
      } catch (err) {
        rlog.error('FocusModeView', 'Failed to load focus data', err)
        setLoadError('Could not load your focus items. Try closing and reopening Focus Mode.')
      } finally {
        setIsLoading(false)
      }
    }
    load()
    // Loaded again at midnight: "due today" and "overdue" move on with the day
  }, [today])

  const reloadClientItems = useCallback(async () => {
    const res = await safeInvoke<RawDeadlineRow[]>(IPC.DASHBOARD_GET_DEADLINES)
    if (res.ok) { setClientItems(focusDeadlineItems(res.data)); setDismissed(new Set()) }
  }, [])

  // Done goes through the deadline engine, like the dashboard: a repeating
  // rule starts its next cycle, a step is checked off, a meter asks for the
  // reading. Only a plain one-off date is cleared.
  const completeClientItem = useCallback(async (item: FocusItem, reading?: number, oneOff?: OneOffChoice, doneOn?: string) => {
    setCelebratingId(item.id)
    let ok = false
    try {
      const done = await completeDeadlines([{
        rowId: item.rowId, columnId: item.columnId, columnName: item.columnName, clientName: item.clientName,
        dateValue: item.dateValue, interval: item.interval, checklistTemplateId: item.checklistTemplateId,
        ruleKind: item.ruleKind, reading, step: item.step, oneOff, doneOn,
      }], {
        onUndone: async () => {
          if (activeGridId) void loadGrid(activeGridId)
          await reloadClientItems()
          pulseEvents.emit('deadline:changed')
        },
      })
      ok = done.length > 0
      if (ok) {
        if (activeGridId) void loadGrid(activeGridId)
        pulseEvents.emit('deadline:changed')
      }
    } catch (err) { rlog.error('FocusModeView', 'Failed to mark deadline done', err) }
    clearTimeout(celebrationTimerRef.current)
    if (!ok) { setCelebratingId(null); return }
    celebrationTimerRef.current = setTimeout(() => {
      setDismissed(prev => new Set([...prev, item.id]))
      setCelebratingId(null)
    }, 600)
  }, [activeGridId, loadGrid, reloadClientItems])

  const handleDoneClientItem = useCallback((item: FocusItem) => {
    // Quotas are renewed with new dates and a new count, on the record
    if (item.ruleKind === 'quota') { onClose(); navigate(`/profile/${item.rowId}?gridId=${item.gridId}`); return }
    if (item.ruleKind === 'meter') { setAskReading(item); return }
    if (isOneOffDeadline(item)) { setAskOneOff(item); return }
    void completeClientItem(item)
  }, [completeClientItem, onClose, navigate])

  // The dashboard's Extend…, as one undo step; the list reloads with the new date
  const extendClientItem = useCallback(async (item: FocusItem, newDue: string, reason: string) => {
    const changed = async () => { await reloadClientItems(); pulseEvents.emit('deadline:changed') }
    await extendDeadline(item.rowId, item.columnId, item.columnName, newDue, reason, changed)
  }, [reloadClientItems])

  const navigateToProfile = useCallback((rowId: number) => {
    onClose()
    navigate(`/profile/${rowId}`)
  }, [onClose, navigate])

  const reloadFollowUps = useCallback(async () => {
    const res = await safeInvoke<Array<{
      id: number; row_id: number; content: string; follow_up_date: string
      grid_name: string; client_name: string | null
    }>>(IPC.DASHBOARD_GET_FOLLOWUPS)
    if (res.ok) {
      const today = new Date(); today.setHours(0, 0, 0, 0)
      const items: FocusFollowUp[] = res.data.slice(0, 20).map(f => {
        const d = new Date(f.follow_up_date + 'T00:00:00')
        const daysUntil = Math.round((d.getTime() - today.getTime()) / MS_PER_DAY)
        return {
          id: f.id, rowId: f.row_id, clientName: f.client_name ?? `Unknown ${wordNow('record', {}, null)}`,
          gridName: f.grid_name, content: f.content, followUpDate: f.follow_up_date, daysUntil,
        }
      })
      setFollowUps(items)
    }
  }, [])

  const reloadUrgentChecklists = useCallback(async () => {
    const res = await safeInvoke<UrgentChecklistItem[]>(IPC.CHECKLIST_GET_URGENT)
    if (res.ok) setUrgentChecklists(res.data.slice(0, 20))
  }, [])

  // Reload when undo/redo updates checklist state externally (cross-mount)
  useEffect(() => {
    const unsub = pulseEvents.on('urgentchecklist:changed', () => { void reloadUrgentChecklists() })
    return unsub
  }, [reloadUrgentChecklists])

  useEffect(() => {
    const unsub = pulseEvents.on('followup:changed', () => { void reloadFollowUps() })
    return unsub
  }, [reloadFollowUps])

  const handleCompleteFollowUp = useCallback(async (followUp: FocusFollowUp) => {
    const key = `followup-${followUp.id}`
    setCelebratingId(key)
    try {
      const res = await safeInvoke<{ sysLogId: number | null }>(IPC.CASE_LOG_COMPLETE_FOLLOWUP, followUp.id)
      if (res.ok) {
        const sysLogId = res.data.sysLogId
        useUndoStore.getState().pushWithToast({
          id: crypto.randomUUID(),
          description: `Completed follow-up for ${followUp.clientName}`,
          timestamp: Date.now(),
          category: sysLogId != null ? 'logged' : 'silent',
          icon: 'check',
          contextLabel: followUp.clientName,
          sideEffects: sysLogId != null ? [{ type: 'void_case_log', caseLogId: sysLogId }] : undefined,
          undo: async () => {
            setCompletedFollowUps(prev => { const s = new Set(prev); s.delete(followUp.id); return s })
            setFollowUps(prev => prev.some(f => f.id === followUp.id) ? prev : [...prev, followUp])
            await mustInvoke(IPC.CASE_LOG_UNCOMPLETE_FOLLOWUP, followUp.id)
            pulseEvents.emit('followup:changed')
          },
          redo: async () => {
            setCompletedFollowUps(prev => new Set([...prev, followUp.id]))
            await mustInvoke(IPC.CASE_LOG_COMPLETE_FOLLOWUP, followUp.id)
            pulseEvents.emit('followup:changed')
          },
        })
      }
    } catch (err) { rlog.error('FocusModeView', 'Failed to complete follow-up', err) }
    clearTimeout(celebrationTimerRef.current)
    celebrationTimerRef.current = setTimeout(() => {
      setCompletedFollowUps(prev => new Set([...prev, followUp.id]))
      setCelebratingId(null)
    }, 600)
  }, [])

  const handleCompleteChecklist = useCallback(async (itemId: number) => {
    const key = `checklist-${itemId}`
    setCelebratingId(key)
    try {
      const item = urgentChecklists.find(i => i.id === itemId)
      if (item) {
        await tickChecklistItem(item, {
          onUndo: () => {
            setCompletedChecklists(prev => { const s = new Set(prev); s.delete(itemId); return s })
            setUrgentChecklists(prev => prev.some(c => c.id === itemId) ? prev : [...prev, item])
          },
          onRedo: () => setCompletedChecklists(prev => new Set([...prev, itemId])),
        })
      }
    } catch (err) { rlog.error('FocusModeView', 'Failed to complete checklist item', err) }
    clearTimeout(celebrationTimerRef.current)
    celebrationTimerRef.current = setTimeout(() => {
      setCompletedChecklists(prev => new Set([...prev, itemId]))
      setCelebratingId(null)
    }, 600)
  }, [urgentChecklists])

  const handleCompleteTask = useCallback(async (taskId: number) => {
    const key = `task-${taskId}`
    setCelebratingId(key)
    try {
      // completeTask pushes the one undo step (with its toast)
      const task = tasks.find(t => t.id === taskId)
      await useTaskStore.getState().completeTask(taskId, {
        task: task ? { title: task.title, due_date: task.due_date } : undefined,
        toast: true,
        onUndo: () => setCompletedTasks(prev => { const s = new Set(prev); s.delete(taskId); return s }),
        onRedo: () => setCompletedTasks(prev => new Set([...prev, taskId])),
      })
    } catch (err) { rlog.error('FocusModeView', 'Failed to complete task', err) }
    clearTimeout(celebrationTimerRef.current)
    celebrationTimerRef.current = setTimeout(() => {
      setCompletedTasks(prev => new Set([...prev, taskId]))
      setCelebratingId(null)
    }, 600)
  }, [tasks])

  const handleCompleteChecklistDue = useCallback(async (itemId: number) => {
    const key = `cldue-${itemId}`
    setCelebratingId(key)
    try {
      // The completion note is voided on undo, like everywhere else
      const ci = checklistDueItems.find(i => i.id === itemId)
      if (ci) {
        await tickChecklistItem(ci, {
          onUndo: () => setCompletedChecklistDue(prev => { const s = new Set(prev); s.delete(itemId); return s }),
          onRedo: () => setCompletedChecklistDue(prev => new Set([...prev, itemId])),
        })
      }
    } catch (err) { rlog.error('FocusModeView', 'Failed to complete checklist due item', err) }
    clearTimeout(celebrationTimerRef.current)
    celebrationTimerRef.current = setTimeout(() => {
      setCompletedChecklistDue(prev => new Set([...prev, itemId]))
      setCelebratingId(null)
    }, 600)
  }, [checklistDueItems])

  const visibleClientItems = clientItems.filter(item => !dismissed.has(item.id))
  // Switched-off features drop out of Focus mode entirely
  const visibleTasks = tasksOn ? tasks.filter(t => !completedTasks.has(t.id)) : []
  const visibleChecklists = checklistsOn ? urgentChecklists.filter(c => !completedChecklists.has(c.id)) : []
  const visibleChecklistDue = checklistsOn ? checklistDueItems.filter(c => !completedChecklistDue.has(c.id)) : []
  const visibleFollowUps = followUps.filter(f => !completedFollowUps.has(f.id))

  const hasAnything = !isLoading && (
    visibleClientItems.length > 0 || visibleTasks.length > 0 ||
    visibleChecklists.length > 0 || visibleChecklistDue.length > 0 || visibleFollowUps.length > 0
  )

  return (
    <div ref={trapRef} className="fixed inset-0 z-[200] bg-slate-100 dark:bg-slate-900 flex flex-col overflow-hidden" role="dialog" aria-modal="true" aria-labelledby={dialogTitleId}>
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-8 py-5 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center">
            <CheckCircle2 className="w-5 h-5 text-white" aria-hidden="true" />
          </div>
          <div>
            <h1 id={dialogTitleId} className="text-lg font-semibold text-slate-900 dark:text-white">Focus mode</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">What needs your attention today</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
          style={{ minHeight: 44 }}
        >
          <X className="w-4 h-4" aria-hidden="true" />
          Exit focus mode
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-8 py-6">
        <div className="max-w-2xl mx-auto space-y-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-24 text-slate-600 dark:text-slate-400">
              Loading your day…
            </div>
          ) : loadError ? (
            <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
              <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <AlertTriangle className="w-8 h-8 text-red-600 dark:text-red-400" aria-hidden="true" />
              </div>
              <p className="text-xl font-semibold text-slate-900 dark:text-white">Something went wrong</p>
              <p className="text-slate-600 dark:text-slate-400">{loadError}</p>
              <button
                onClick={onClose}
                className="mt-2 px-6 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-400"
                style={{ minHeight: 44 }}
              >
                Close
              </button>
            </div>
          ) : !hasAnything ? (
            <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
              <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8 text-green-600 dark:text-green-400" aria-hidden="true" />
              </div>
              <p className="text-xl font-semibold text-slate-900 dark:text-white">You're all caught up!</p>
              <p className="text-slate-600 dark:text-slate-400">No deadlines or tasks are due today.</p>
              <button
                onClick={onClose}
                className="mt-2 px-6 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-400"
                style={{ minHeight: 44 }}
              >
                Back to work
              </button>
            </div>
          ) : (
            <>
              {/* What the buttons do, said once (UX D-04, D-07) */}
              <p className="text-base text-slate-700 dark:text-slate-300">
                Each item in turn. Done puts today's date in and starts the next cycle; use Done on… if it happened earlier. Not now puts one aside until you open Focus mode again.
              </p>

              {/* Record deadlines section */}
              {visibleClientItems.length > 0 && (
                <FocusSection
                  icon={<AlertTriangle className="w-5 h-5" />}
                  title={`${w('record', { cap: true })} deadlines`}
                  iconColor="text-red-600 dark:text-red-400"
                  count={visibleClientItems.length}
                  expanded={clientExpanded}
                  onToggle={() => setClientExpanded(v => !v)}
                >
                  {visibleClientItems.map(item => (
                    <ClientFocusItem
                      key={item.id}
                      item={item}
                      celebrating={celebratingId === item.id}
                      onComplete={() => handleDoneClientItem(item)}
                      onDoneOnDay={() => setAskDay(item)}
                      onExtend={() => setExtending(item)}
                      onNotNow={() => setDismissed(prev => new Set([...prev, item.id]))}
                      onNavigate={() => navigateToProfile(item.rowId)}
                    />
                  ))}
                </FocusSection>
              )}

              {/* Tasks section */}
              {visibleTasks.length > 0 && (
                <FocusSection
                  icon={<Pin className="w-5 h-5" />}
                  title="Tasks due"
                  iconColor="text-purple-600 dark:text-purple-400"
                  count={visibleTasks.length}
                  expanded={tasksExpanded}
                  onToggle={() => setTasksExpanded(v => !v)}
                >
                  {visibleTasks.map(task => (
                    <TaskFocusItem
                      key={task.id}
                      task={task}
                      celebrating={celebratingId === `task-${task.id}`}
                      onComplete={() => void handleCompleteTask(task.id)}
                    />
                  ))}
                </FocusSection>
              )}

              {/* Checklist items with due dates */}
              {visibleChecklistDue.length > 0 && (
                <FocusSection
                  icon={<CalendarClock className="w-5 h-5" />}
                  title="Checklist items due"
                  iconColor="text-teal-600 dark:text-teal-400"
                  count={visibleChecklistDue.length}
                  expanded={checklistDueExpanded}
                  onToggle={() => setChecklistDueExpanded(v => !v)}
                >
                  {visibleChecklistDue.map(ci => {
                    const dueDateFormatted = shortYmd(ci.due_date!)
                    const urgencyLabel = ci.daysUntil < 0 ? `${Math.abs(ci.daysUntil)}d overdue` : ci.daysUntil === 0 ? 'Due today' : `${ci.daysUntil}d`
                    const urgencyColor = ci.daysUntil <= 0 ? 'text-red-700 dark:text-red-400' : ci.daysUntil <= 7 ? 'text-orange-700 dark:text-orange-400' : 'text-slate-600 dark:text-slate-400'
                    return (
                      <div
                        key={ci.id}
                        className={`flex items-center gap-4 px-5 py-4 ${celebratingId === `cldue-${ci.id}` ? 'celebrating' : ''}`}
                        style={{ minHeight: 64 }}
                      >
                        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0 bg-teal-400" />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-slate-900 dark:text-white truncate">{ci.title}</div>
                          <div className="text-sm text-slate-600 dark:text-slate-400 truncate">
                            <button
                              onClick={() => { onClose(); navigate(`/profile/${ci.row_id}?gridId=${ci.grid_id}`) }}
                              className="hit-44 hover:underline transition-colors focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-400 rounded-sm"
                            >
                              {ci.client_name ?? `Unknown ${wordNow('record', {}, ci.grid_id)}`}
                            </button>
                            {' · '}{ci.grid_name}
                          </div>
                        </div>
                        <div className="flex-shrink-0 text-right mr-2">
                          <div className="text-sm text-slate-600 dark:text-slate-400 tabular-nums">{dueDateFormatted}</div>
                          <div className={`text-sm ${urgencyColor} tabular-nums`}>{urgencyLabel}</div>
                        </div>
                        <button
                          onClick={() => void handleCompleteChecklistDue(ci.id)}
                          disabled={celebratingId === `cldue-${ci.id}`}
                          aria-label={`Mark ${ci.title} done`}
                          className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-600 text-white text-base font-medium transition-colors focus:outline-hidden focus-visible:ring-3 focus-visible:ring-teal-400 disabled:opacity-50"
                          style={{ minHeight: 44 }}
                        >
                          <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                          Done
                        </button>
                      </div>
                    )
                  })}
                </FocusSection>
              )}

              {/* Case note follow-ups */}
              {visibleFollowUps.length > 0 && (
                <FocusSection
                  icon={<MessageSquare className="w-5 h-5" />}
                  title={`${w('activity', { cap: true })} follow-ups due`}
                  iconColor="text-sky-600 dark:text-sky-400"
                  count={visibleFollowUps.length}
                  expanded={followUpsExpanded}
                  onToggle={() => setFollowUpsExpanded(v => !v)}
                >
                  {visibleFollowUps.map(f => (
                    <FollowUpFocusItem
                      key={f.id}
                      followUp={f}
                      celebrating={celebratingId === `followup-${f.id}`}
                      onComplete={() => void handleCompleteFollowUp(f)}
                      onNavigate={() => navigateToProfile(f.rowId)}
                    />
                  ))}
                </FocusSection>
              )}

              {/* Urgent client checklist items */}
              {visibleChecklists.length > 0 && (
                <FocusSection
                  icon={<ListChecks className="w-5 h-5" />}
                  title="Urgent checklist items"
                  iconColor="text-amber-600 dark:text-amber-400"
                  count={visibleChecklists.length}
                  expanded={checklistsExpanded}
                  onToggle={() => setChecklistsExpanded(v => !v)}
                >
                  {visibleChecklists.map(item => (
                    <ChecklistFocusItem
                      key={item.id}
                      item={item}
                      celebrating={celebratingId === `checklist-${item.id}`}
                      onComplete={() => void handleCompleteChecklist(item.id)}
                      onNavigate={() => navigateToProfile(item.row_id)}
                    />
                  ))}
                </FocusSection>
              )}
            </>
          )}
        </div>
      </div>

      {askOneOff && (
        <OneOffDoneDialog title={`${askOneOff.columnName}: ${askOneOff.clientName}`} currentDue={askOneOff.dueYmd} onClose={() => setAskOneOff(null)}
          onSave={choice => { const item = askOneOff; setAskOneOff(null); void completeClientItem(item, undefined, choice) }} />
      )}
      {askReading && (
        <MeterReadingDialog title={`${askReading.columnName}: ${askReading.clientName}`} info={askReading.meter} onClose={() => setAskReading(null)}
          onSave={reading => { const item = askReading; setAskReading(null); void completeClientItem(item, reading) }} />
      )}
      {askDay && (
        <DoneOnDayDialog title={`Mark ${askDay.columnName} done for ${askDay.clientName}`} onClose={() => setAskDay(null)}
          onSave={day => { const item = askDay; setAskDay(null); void completeClientItem(item, undefined, undefined, day) }} />
      )}
      {extending && (
        <ExtendDeadlineDialog title={`${extending.columnName}: ${extending.clientName}`} currentDue={extending.dueYmd} gridId={extending.gridId} onClose={() => setExtending(null)}
          onSave={(newDue, reason) => { const item = extending; setExtending(null); void extendClientItem(item, newDue, reason) }} />
      )}

      {/* CSS animations */}
      <style>{`
        @keyframes celebrate-check {
          0%   { transform: scale(1); opacity: 1; }
          30%  { transform: scale(1.08); }
          60%  { transform: scale(0.96); }
          100% { transform: scale(1) translateX(20px); opacity: 0; }
        }
        .celebrating {
          animation: celebrate-check 0.6s ease-in-out forwards;
        }
      `}</style>
    </div>
  )
}
