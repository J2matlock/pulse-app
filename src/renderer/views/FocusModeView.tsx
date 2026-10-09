/**
 * FocusModeView — Ctrl+Shift+F full-screen overlay.
 * Shows only what needs attention today: client deadlines + admin tasks.
 * Big [Complete ✓] buttons with celebration animation.
 */
import React, { useEffect, useState, useCallback, useRef } from 'react'
import { X, CheckCircle2, AlertTriangle, Pin, ListChecks, MessageSquare, CalendarClock } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { IPC } from '../../shared/ipc-channels'
import type { CaseloadTask, AlertThreshold, ChecklistDueItem } from '../../shared/types'
import { MS_PER_DAY } from '../../shared/constants'
import { safeInvoke } from '../utils/safeInvoke'
import { computeDaysUntil, computeEffectiveDeadline, getMatchingThreshold } from '../utils/deadlineCalc'
import { useGridStore } from '../stores/gridStore'
import { useTaskStore } from '../stores/taskStore'
import { useUndoStore } from '../stores/undoStore'
import { pulseEvents } from '../events'
import type { RawDeadlineRow, FocusItem, FocusTask, FocusFollowUp, UrgentChecklistItem } from './focus-mode/types'
import { FocusSection } from './focus-mode/FocusSection'
import { ClientFocusItem } from './focus-mode/ClientFocusItem'
import { ChecklistFocusItem } from './focus-mode/ChecklistFocusItem'
import { FollowUpFocusItem } from './focus-mode/FollowUpFocusItem'
import { TaskFocusItem } from './focus-mode/TaskFocusItem'
import { rlog } from '../utils/rendererLogger'
import { toRuleInterval } from '../../shared/ruleInterval'
import { useVocab } from '../hooks/useVocab'
import { wordNow } from '../utils/vocab'
import { useFeature } from '../hooks/useFeature'

interface Props {
  onClose: () => void
}

export default function FocusModeView({ onClose }: Props): React.ReactElement {
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

  // Clean up celebration timer on unmount
  useEffect(() => () => { clearTimeout(celebrationTimerRef.current) }, [])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

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

        if (deadlinesResult.ok) {
          const items: FocusItem[] = deadlinesResult.data
            .flatMap(r => {
              const daysUntil = computeDaysUntil(r.date_value, toRuleInterval(r))
              // Unparseable date: not a real deadline (and would crash the date formatting below)
              if (daysUntil === null) return []
              let thresholds: AlertThreshold[] = []
              try {
                thresholds = r.alert_thresholds ? JSON.parse(r.alert_thresholds) as AlertThreshold[] : []
              } catch { /* ignore malformed */ }
              return [{ ...r, daysUntil, thresholds }]
            })
            .filter(r => {
              // Show if overdue/today OR if an alert threshold is actively triggered
              if (r.daysUntil <= 0) return true
              if (r.thresholds.length > 0) {
                return getMatchingThreshold(r.daysUntil, r.thresholds) !== undefined
              }
              return false
            })
            .slice(0, 20)
            .map(r => {
              const effectiveDate = computeEffectiveDeadline(r.date_value, toRuleInterval(r))
              const dueDateStr = effectiveDate?.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) ?? r.date_value
              return {
                id: `${r.row_id}-${r.column_id}`,
                rowId: r.row_id,
                columnId: r.column_id,
                clientName: r.client_name ?? `Unknown ${wordNow('record', {}, r.grid_id)}`,
                label: r.column_name,
                subLabel: r.grid_name,
                urgency: (r.daysUntil < 0 ? 'overdue' : r.daysUntil === 0 ? 'today' : 'upcoming') as 'overdue' | 'today' | 'upcoming',
                type: 'client' as const,
                daysUntil: r.daysUntil,
                dueDateStr,
                dateValue: r.date_value,
              }
            })
          setClientItems(items)
        }

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
  }, [])

  const handleDismissClientItem = useCallback(async (item: FocusItem) => {
    const key = item.id
    setCelebratingId(key)
    try {
      const res = await safeInvoke<{ sysLogId: number | null }>(IPC.CELL_UPDATE, item.rowId, item.columnId, null)
      if (activeGridId) void loadGrid(activeGridId)
      let sysLogId = res.ok ? res.data.sysLogId : null
      // If the column doesn't have log_changes enabled, create a case log entry explicitly
      if (sysLogId == null && res.ok) {
        const fmt = (d: string) => new Date(d.includes('T') ? d : `${d}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        const content = `${item.label} completed (was ${fmt(item.dateValue)})`
        const logRes = await safeInvoke<{ id: number }>(IPC.CASE_LOG_CREATE, item.rowId, content, 'system', null)
        if (logRes.ok) sysLogId = logRes.data.id
      }
      useUndoStore.getState().pushWithToast({
        id: crypto.randomUUID(),
        description: `Cleared deadline for ${item.clientName}`,
        timestamp: Date.now(),
        category: 'logged',
        icon: 'x',
        contextLabel: item.clientName,
        sideEffects: sysLogId != null ? [{ type: 'void_case_log', caseLogId: sysLogId }] : undefined,
        undo: async () => {
          setDismissed(prev => { const s = new Set(prev); s.delete(key); return s })
          await safeInvoke(IPC.CELL_UPDATE, item.rowId, item.columnId, item.dateValue)
          if (activeGridId) void loadGrid(activeGridId)
          pulseEvents.emit('deadline:changed')
        },
        redo: async () => {
          setDismissed(prev => new Set([...prev, key]))
          await safeInvoke(IPC.CELL_UPDATE, item.rowId, item.columnId, null)
          if (activeGridId) void loadGrid(activeGridId)
          pulseEvents.emit('deadline:changed')
        },
      })
      pulseEvents.emit('deadline:changed')
    } catch (err) { rlog.error('FocusModeView', 'Failed to dismiss client item', err) }
    clearTimeout(celebrationTimerRef.current)
    celebrationTimerRef.current = setTimeout(() => {
      setDismissed(prev => new Set([...prev, item.id]))
      setCelebratingId(null)
    }, 600)
  }, [activeGridId, loadGrid])

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
            await safeInvoke(IPC.CASE_LOG_UNCOMPLETE_FOLLOWUP, followUp.id)
            pulseEvents.emit('followup:changed')
          },
          redo: async () => {
            setCompletedFollowUps(prev => new Set([...prev, followUp.id]))
            await safeInvoke(IPC.CASE_LOG_COMPLETE_FOLLOWUP, followUp.id)
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
      const completedAt = new Date().toISOString()
      const item = urgentChecklists.find(i => i.id === itemId)
      const res = await safeInvoke<{ sysLogId: number | null }>(IPC.CHECKLIST_UPDATE_ITEM, itemId, { is_completed: 1, completed_at: completedAt })
      if (res.ok) {
        const sysLogId = res.data.sysLogId
        useUndoStore.getState().pushWithToast({
          id: crypto.randomUUID(),
          description: `Completed "${item?.title ?? 'checklist item'}"`,
          timestamp: Date.now(),
          category: sysLogId != null ? 'logged' : 'silent',
          icon: 'check-square',
          contextLabel: item?.client_name ?? undefined,
          sideEffects: sysLogId != null ? [{ type: 'void_case_log', caseLogId: sysLogId }] : undefined,
          undo: async () => {
            setCompletedChecklists(prev => { const s = new Set(prev); s.delete(itemId); return s })
            if (item) setUrgentChecklists(prev => prev.some(c => c.id === itemId) ? prev : [...prev, item])
            await safeInvoke(IPC.CHECKLIST_UPDATE_ITEM, itemId, { is_completed: 0, completed_at: null })
            pulseEvents.emit('urgentchecklist:changed')
          },
          redo: async () => {
            setCompletedChecklists(prev => new Set([...prev, itemId]))
            await safeInvoke(IPC.CHECKLIST_UPDATE_ITEM, itemId, { is_completed: 1, completed_at: completedAt })
            pulseEvents.emit('urgentchecklist:changed')
          },
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
      await useTaskStore.getState().completeTask(taskId)
      const task = tasks.find(t => t.id === taskId)
      useUndoStore.getState().pushWithToast({
        id: crypto.randomUUID(),
        description: `Completed task "${task?.title ?? 'task'}"`,
        timestamp: Date.now(),
        category: 'silent',
        icon: 'check',
        undo: async () => {
          await safeInvoke(IPC.TASK_RESTORE, taskId)
          setCompletedTasks(prev => { const s = new Set(prev); s.delete(taskId); return s })
        },
        redo: async () => {
          await useTaskStore.getState().completeTask(taskId)
          setCompletedTasks(prev => new Set([...prev, taskId]))
        },
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
      const completedAt = new Date().toISOString()
      const ci = checklistDueItems.find(i => i.id === itemId)
      await safeInvoke(IPC.CHECKLIST_UPDATE_ITEM, itemId, { is_completed: 1, completed_at: completedAt })
      useUndoStore.getState().pushWithToast({
        id: crypto.randomUUID(),
        description: `Completed "${ci?.title ?? 'checklist item'}"`,
        timestamp: Date.now(),
        category: 'silent',
        icon: 'check-square',
        contextLabel: ci?.client_name ?? undefined,
        undo: async () => {
          setCompletedChecklistDue(prev => { const s = new Set(prev); s.delete(itemId); return s })
          await safeInvoke(IPC.CHECKLIST_UPDATE_ITEM, itemId, { is_completed: 0, completed_at: null })
        },
        redo: async () => {
          setCompletedChecklistDue(prev => new Set([...prev, itemId]))
          await safeInvoke(IPC.CHECKLIST_UPDATE_ITEM, itemId, { is_completed: 1, completed_at: completedAt })
        },
      })
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
    <div ref={trapRef} className="fixed inset-0 z-[200] bg-slate-900 flex flex-col overflow-hidden" role="dialog" aria-modal="true">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-8 py-5 border-b border-slate-700 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center">
            <CheckCircle2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-white">Focus Mode</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">What needs your attention today</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-700 transition-colors focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
          style={{ minHeight: 44 }}
        >
          <X className="w-4 h-4" />
          Exit Focus Mode
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-8 py-6">
        <div className="max-w-2xl mx-auto space-y-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-24 text-slate-500 dark:text-slate-400">
              Loading your day…
            </div>
          ) : loadError ? (
            <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
              <div className="w-16 h-16 rounded-full bg-red-900/30 flex items-center justify-center">
                <AlertTriangle className="w-8 h-8 text-red-400" />
              </div>
              <p className="text-xl font-semibold text-white">Something went wrong</p>
              <p className="text-slate-500 dark:text-slate-400">{loadError}</p>
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
              <div className="w-16 h-16 rounded-full bg-green-900/30 flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8 text-green-400" />
              </div>
              <p className="text-xl font-semibold text-white">You're all caught up!</p>
              <p className="text-slate-500 dark:text-slate-400">No deadlines or tasks are due today.</p>
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
              {/* Client deadlines section */}
              {visibleClientItems.length > 0 && (
                <FocusSection
                  icon={<AlertTriangle className="w-5 h-5" />}
                  title={`${w('record', { cap: true })} deadlines needing attention`}
                  iconColor="text-red-400"
                  count={visibleClientItems.length}
                  expanded={clientExpanded}
                  onToggle={() => setClientExpanded(v => !v)}
                >
                  {visibleClientItems.map(item => (
                    <ClientFocusItem
                      key={item.id}
                      item={item}
                      celebrating={celebratingId === item.id}
                      onComplete={() => void handleDismissClientItem(item)}
                      onNavigate={() => navigateToProfile(item.rowId)}
                    />
                  ))}
                </FocusSection>
              )}

              {/* Admin tasks section */}
              {visibleTasks.length > 0 && (
                <FocusSection
                  icon={<Pin className="w-5 h-5" />}
                  title="Admin Tasks Due Today"
                  iconColor="text-purple-400"
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
                  title="Checklist Items Due"
                  iconColor="text-teal-400"
                  count={visibleChecklistDue.length}
                  expanded={checklistDueExpanded}
                  onToggle={() => setChecklistDueExpanded(v => !v)}
                >
                  {visibleChecklistDue.map(ci => {
                    const dueDateFormatted = (() => { const [y = NaN, m = NaN, d = NaN] = ci.due_date!.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) })()
                    const urgencyLabel = ci.daysUntil < 0 ? `${Math.abs(ci.daysUntil)}d overdue` : ci.daysUntil === 0 ? 'Due today' : `${ci.daysUntil}d`
                    const urgencyColor = ci.daysUntil < 0 ? 'text-red-400' : ci.daysUntil === 0 ? 'text-red-400' : ci.daysUntil <= 7 ? 'text-orange-400' : 'text-slate-500'
                    return (
                      <div
                        key={ci.id}
                        className={`flex items-center gap-4 px-5 py-4 ${celebratingId === `cldue-${ci.id}` ? 'celebrating' : ''}`}
                        style={{ minHeight: 64 }}
                      >
                        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0 bg-teal-400" />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-white truncate">{ci.title}</div>
                          <div className="text-sm text-slate-500 dark:text-slate-400 truncate">
                            <button
                              onClick={() => { onClose(); navigate(`/profile/${ci.row_id}?gridId=${ci.grid_id}`) }}
                              className="hit-44 hover:text-teal-300 hover:underline transition-colors"
                            >
                              {ci.client_name ?? 'Unknown'}
                            </button>
                            {' · '}{ci.grid_name}
                          </div>
                        </div>
                        <div className="flex-shrink-0 text-right mr-2">
                          <div className="text-sm text-slate-500 dark:text-slate-400 tabular-nums">{dueDateFormatted}</div>
                          <div className={`text-sm ${urgencyColor} tabular-nums`}>{urgencyLabel}</div>
                        </div>
                        <button
                          onClick={() => void handleCompleteChecklistDue(ci.id)}
                          disabled={celebratingId === `cldue-${ci.id}`}
                          className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-600 text-white text-base font-medium transition-colors focus:outline-hidden focus-visible:ring-3 focus-visible:ring-teal-400 disabled:opacity-50"
                          style={{ minHeight: 44 }}
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          Complete
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
                  iconColor="text-sky-400"
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
                  iconColor="text-amber-400"
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
