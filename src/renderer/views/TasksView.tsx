import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { ChevronDown, ChevronRight, ClipboardList, FolderPlus, RefreshCw } from 'lucide-react'
import { GroupPicker } from '../components/shared/GroupPicker'
import { useSearchParams, useNavigate } from 'react-router-dom'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { useShallow } from 'zustand/react/shallow'
import { ConfirmDialog } from '../components/shared/ConfirmDialog'
import { EmptyState } from '../components/shared/EmptyState'
import { useTaskStore, type TaskSortMode } from '../stores/taskStore'
import { useGridStore } from '../stores/gridStore'
import { useUndoStore } from '../stores/undoStore'
import { TaskItem, CompletedTaskItem } from '../components/tasks/TaskItem'
import { TemplateManager } from '../components/profile/Checklist'
import { ChecklistGroupHeader } from '../components/shared/GroupHeader'
import { ScratchPad } from '../components/profile/ScratchPad'
import { IPC } from '../../shared/ipc-channels'
import type { CaseloadTask, TaskGroup as TaskGroupType, UrgentChecklistItem } from '../../shared/types'
import { safeInvoke, mustInvoke } from '../utils/safeInvoke'
import { rlog } from '../utils/rendererLogger'
import { pulseEvents } from '../events'
import { tickChecklistItem } from '../utils/checklistTick'
import { LoadingOverlay } from '../components/shared/LoadingSpinner'

import { ViewBreadcrumb } from '../components/shared/ViewBreadcrumb'
import { isOverdue, isSnoozed, PRIORITY_ORDER } from './tasks/taskHelpers'
import { TaskFormDialog, type NewTask } from './tasks/TaskFormDialog'
import { SnoozeDialog } from './tasks/SnoozeDialog'
import { TaskGroup } from './tasks/TaskGroup'
import { UrgentChecklistSection } from './tasks/UrgentChecklistSection'
import { isMod, modHelp } from '../utils/keys'
import { useVocab } from '../hooks/useVocab'
import { useFeature } from '../hooks/useFeature'

export default function TasksView(): React.ReactElement {
  const checklistsOn = useFeature('checklists')
  const { t: w } = useVocab(null)
  const { tasks, loading, loadTasks, createTask, updateTask, deleteTask, deleteTasks, completeTask, snoozeTask, reorderTasks, sortMode, setSortMode } = useTaskStore(useShallow(s => ({
    tasks: s.tasks, loading: s.loading, loadTasks: s.loadTasks,
    createTask: s.createTask, updateTask: s.updateTask, deleteTask: s.deleteTask,
    completeTask: s.completeTask, snoozeTask: s.snoozeTask,
    reorderTasks: s.reorderTasks,
    deleteTasks: s.deleteTasks,
    sortMode: s.sortMode,
    setSortMode: s.setSortMode,
  })))
  const loadGrid = useGridStore(s => s.loadGrid)
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [editingTask, setEditingTask] = useState<CaseloadTask | null>(null)
  const [showCompleted, setShowCompleted] = useState(false)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [recentlyCheckedIds, setRecentlyCheckedIds] = useState<Set<number>>(new Set())
  const checkedTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())
  const [snoozeTaskId, setSnoozeTaskId] = useState<number | null>(null)
  const [urgentItems, setUrgentItems] = useState<UrgentChecklistItem[]>([])
  const [showTemplates, setShowTemplates] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showSpinner, setShowSpinner] = useState(false)
  const addInputRef = useRef<HTMLInputElement>(null)

  // Task groups
  const [taskGroups, setTaskGroups] = useState<TaskGroupType[]>([])
  const [collapsedGroups, setCollapsedGroups] = useState<Set<number>>(new Set())
  const [groupAddTitles, setGroupAddTitles] = useState<Record<number, string>>({})
  const [confirmDeleteGroup, setConfirmDeleteGroup] = useState<{ id: number; name: string } | null>(null)
  const [pendingTemplateId, setPendingTemplateId] = useState<number | null>(null)

  // Debounce spinner to prevent flash on fast loads
  useEffect(() => {
    if (!loading) { setShowSpinner(false); return }
    const t = setTimeout(() => setShowSpinner(true), 200)
    return () => clearTimeout(t)
  }, [loading])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const loadUrgentItems = useCallback(async () => {
    try {
      const res = await safeInvoke<UrgentChecklistItem[]>(IPC.CHECKLIST_GET_URGENT)
      if (res.ok) { setUrgentItems(res.data); return true }
      rlog.error('Tasks', 'CHECKLIST_GET_URGENT failed:', res.error)
    } catch (err) {
      rlog.error('Tasks', 'CHECKLIST_GET_URGENT exception:', err)
    }
    return false
  }, [])

  const loadTaskGroups = useCallback(async () => {
    const res = await safeInvoke<TaskGroupType[]>(IPC.TASK_GROUP_GET_ALL)
    if (res.ok) {
      setTaskGroups(res.data)
      setCollapsedGroups(new Set(res.data.filter(g => g.is_collapsed === 1).map(g => g.id)))
    }
  }, [])

  const reloadAll = useCallback(async () => {
    setLoadError(null)
    // safeInvoke and the store don't throw: a failed load comes back as false,
    // and "no tasks" would be wrong then
    const failed = () => setLoadError('We couldn\u2019t load your tasks \u2014 please try again.')
    try {
      const [tasksOk, urgentOk] = await Promise.all([loadTasks(), loadUrgentItems(), loadTaskGroups()])
      if (tasksOk === false || (checklistsOn && !urgentOk)) failed()
    } catch {
      failed()
    }
  }, [loadTasks, loadUrgentItems, loadTaskGroups, checklistsOn])

  useEffect(() => {
    void reloadAll()
  }, [reloadAll])

  // Cleanup animation timers on unmount
  useEffect(() => {
    const timers = checkedTimersRef.current
    return () => { timers.forEach(t => clearTimeout(t)) }
  }, [])

  // Reload urgent items when undo/redo updates checklist state externally (cross-mount)
  useEffect(() => {
    const unsub = pulseEvents.on('urgentchecklist:changed', () => { void loadUrgentItems() })
    return unsub
  }, [loadUrgentItems])

  async function handleToggleUrgentItem(item: UrgentChecklistItem) {
    // Optimistically remove from list, then persist
    setUrgentItems(prev => prev.filter(i => i.id !== item.id))
    const done = await tickChecklistItem(item, {
      onUndo: () => setUrgentItems(prev => prev.some(i => i.id === item.id) ? prev : [...prev, item]),
      onRedo: () => setUrgentItems(prev => prev.filter(i => i.id !== item.id)),
    })
    if (!done) setUrgentItems(prev => prev.some(i => i.id === item.id) ? prev : [...prev, item])
  }

  // Open new task dialog when navigated here via ?action=new
  useEffect(() => {
    if (searchParams.get('action') === 'new') {
      setShowAddDialog(true)
      setSearchParams({}, { replace: true })
    }
  }, [searchParams, setSearchParams])

  // A task clicked on the calendar (?task=12) opens for editing (audit S-28)
  const taskParam = Number(searchParams.get('task'))
  useEffect(() => {
    if (!taskParam) return
    const task = tasks.find(t => t.id === taskParam)
    if (!task) return
    setEditingTask(task)
    setSearchParams({}, { replace: true })
  }, [taskParam, tasks, setSearchParams])

  // Ctrl+Shift+T — open add dialog locally when already on Tasks page
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isMod(e) && e.shiftKey && e.key === 'T') {
        e.preventDefault()
        e.stopImmediatePropagation()
        setShowAddDialog(true)
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [])

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleSaveTask(taskData: NewTask | Partial<CaseloadTask>) {
    if (editingTask) {
      // Only what the form changed (audit S-05)
      await updateTask(editingTask.id, taskData)
      setEditingTask(null)
    } else {
      await createTask(taskData as NewTask)
    }
  }

  const handleToggle = useCallback(async (id: number) => {
    const task = tasks.find(t => t.id === id)
    if (!task) return

    if (task.is_completed === 0) {
      setRecentlyCheckedIds(prev => new Set(prev).add(id))
      const timer = setTimeout(() => {
        checkedTimersRef.current.delete(timer)
        setRecentlyCheckedIds(prev => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }, 400)
      checkedTimersRef.current.add(timer)
      await completeTask(id)
    } else {
      await updateTask(id, { is_completed: 0, completed_at: null } as Partial<CaseloadTask>)
    }
  }, [tasks, completeTask, updateTask])

  const handleInlineAdd = useCallback(async (title: string) => {
    await createTask({
      grid_id: null,
      group_id: null,
      title,
      description: null,
      priority: 'normal',
      category: null,
      due_date: null,
      recurrence_rule: null,
      is_completed: 0,
      completed_at: null,
      snoozed_until: null,
      position: 0,
    })
  }, [createTask])

  // ── Task Group Handlers ─────────────────────────────────────────────────────

  const handleAddGroup = useCallback(async () => {
    const res = await safeInvoke<TaskGroupType>(IPC.TASK_GROUP_CREATE, 'New Group')
    if (res.ok) {
      const created = res.data
      setTaskGroups(prev => [...prev, created])
      // Redo makes the group again under a new id; undo must delete that one
      let groupId = created.id
      useUndoStore.getState().push({
        id: crypto.randomUUID(),
        description: 'Added task group',
        timestamp: Date.now(),
        category: 'structural',
        icon: 'folder-plus',
        undo: async () => {
          await mustInvoke(IPC.TASK_GROUP_DELETE, groupId)
          await loadTaskGroups()
        },
        redo: async () => {
          const again = await mustInvoke<TaskGroupType>(IPC.TASK_GROUP_CREATE, created.name)
          groupId = again.data.id
          await loadTaskGroups()
        },
      })
    }
  }, [loadTaskGroups])

  const handleRenameGroup = useCallback(async (groupId: number, name: string) => {
    const prevGroup = taskGroups.find(g => g.id === groupId)
    const prevName = prevGroup?.name ?? ''
    await safeInvoke(IPC.TASK_GROUP_UPDATE, groupId, { name })
    setTaskGroups(prev => prev.map(g => g.id === groupId ? { ...g, name } : g))
    useUndoStore.getState().push({
      id: crypto.randomUUID(),
      description: `Renamed group to "${name}"`,
      timestamp: Date.now(),
      category: 'logged',
      icon: 'edit',
      undo: async () => {
        await mustInvoke(IPC.TASK_GROUP_UPDATE, groupId, { name: prevName })
        await loadTaskGroups()
      },
      redo: async () => {
        await mustInvoke(IPC.TASK_GROUP_UPDATE, groupId, { name })
        await loadTaskGroups()
      },
    })
  }, [taskGroups, loadTaskGroups])

  const handleDeleteGroup = useCallback(async (groupId: number) => {
    const deletedGroup = taskGroups.find(g => g.id === groupId)
    const affectedTasks = tasks.filter(t => t.group_id === groupId)
    await safeInvoke(IPC.TASK_GROUP_DELETE, groupId)
    setTaskGroups(prev => prev.filter(g => g.id !== groupId))
    setConfirmDeleteGroup(null)
    void loadTasks() // Reload to reflect ungrouped tasks
    let currentId = groupId
    if (deletedGroup) {
      useUndoStore.getState().push({
        id: crypto.randomUUID(),
        description: `Deleted group "${deletedGroup.name}"`,
        timestamp: Date.now(),
        category: 'structural',
        icon: 'trash',
        undo: async () => {
          // The group comes back under a new id; redo must delete that one
          const res = await mustInvoke<TaskGroupType>(IPC.TASK_GROUP_CREATE, deletedGroup.name)
          currentId = res.data.id
          for (const t of affectedTasks) {
            await mustInvoke(IPC.TASK_MOVE_TO_GROUP, t.id, currentId)
          }
          await loadTaskGroups()
          await loadTasks()
        },
        redo: async () => {
          await mustInvoke(IPC.TASK_GROUP_DELETE, currentId)
          await loadTaskGroups()
          await loadTasks()
        },
      })
    }
  }, [taskGroups, tasks, loadTasks, loadTaskGroups])

  const handleToggleGroupCollapse = useCallback(async (groupId: number) => {
    const newCollapsed = !collapsedGroups.has(groupId)
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (newCollapsed) next.add(groupId)
      else next.delete(groupId)
      return next
    })
    await safeInvoke(IPC.TASK_GROUP_UPDATE, groupId, { is_collapsed: newCollapsed ? 1 : 0 })
  }, [collapsedGroups])

  const hasTaskGroups = taskGroups.length > 0

  // ── Derived data ────────────────────────────────────────────────────────────

  const activeRaw = useMemo(() =>
    tasks.filter(t => t.is_completed === 0 || recentlyCheckedIds.has(t.id)),
    [tasks, recentlyCheckedIds]
  )

  const activeManualItems = useMemo(() => {
    const nonSnoozed = activeRaw.filter(t => !isSnoozed(t))
    return [...nonSnoozed].sort((a, b) => a.position - b.position)
  }, [activeRaw])

  // Grouped items memo (only used in manual mode with groups)
  const groupedActiveTasks = useMemo(() => {
    const map = new Map<number | null, CaseloadTask[]>()
    for (const task of activeManualItems) {
      const key = task.group_id ?? null
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(task)
    }
    return map
  }, [activeManualItems])

  // Sort: My order (with groups and dragging), Due date (overdue first, no date last), or Priority
  const sortedActiveItems = useMemo(() => {
    const byDue = (a: CaseloadTask, b: CaseloadTask) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999')
    const byPriority = (a: CaseloadTask, b: CaseloadTask) => (PRIORITY_ORDER[a.priority ?? 'normal'] ?? 2) - (PRIORITY_ORDER[b.priority ?? 'normal'] ?? 2)
    return [...activeManualItems].sort((a, b) => sortMode === 'priority'
      ? byPriority(a, b) || byDue(a, b) || a.position - b.position
      : byDue(a, b) || byPriority(a, b) || a.position - b.position)
  }, [activeManualItems, sortMode])

  const activeManualRef = useRef(activeManualItems)
  activeManualRef.current = activeManualItems

  const overdueTasks = useMemo(() => activeRaw.filter(t => !isSnoozed(t) && isOverdue(t)), [activeRaw])
  const snoozedTasks = useMemo(() => tasks.filter(t => t.is_completed !== 1 && isSnoozed(t)), [tasks])

  const completedTasks = useMemo(() =>
    tasks.filter(t => t.is_completed === 1 && !recentlyCheckedIds.has(t.id))
      .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? '')),
    [tasks, recentlyCheckedIds]
  )

  const totalActive = activeRaw.filter(t => !recentlyCheckedIds.has(t.id)).length
  // Urgent checklist items only count while the Checklists feature (and its section) is on
  const shownUrgentCount = checklistsOn ? urgentItems.length : 0
  const totalAll = totalActive + completedTasks.length
  const progressPct = totalAll > 0 ? Math.round((completedTasks.length / totalAll) * 100) : 0
  const progressColor = progressPct === 100 ? '#22c55e' : progressPct >= 50 ? '#eab308' : '#94a3b8'

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    // Group reorder
    const activeStr = String(active.id)
    const overStr = String(over.id)
    if (activeStr.startsWith('group-') && overStr.startsWith('group-')) {
      const activeGroupId = Number(activeStr.replace('group-', ''))
      const overGroupId = Number(overStr.replace('group-', ''))
      const sorted = [...taskGroups].sort((a, b) => a.position - b.position)
      const oldIdx = sorted.findIndex(g => g.id === activeGroupId)
      const newIdx = sorted.findIndex(g => g.id === overGroupId)
      if (oldIdx === -1 || newIdx === -1) return
      const newOrder = arrayMove(sorted, oldIdx, newIdx)
      setTaskGroups(newOrder.map((g, i) => ({ ...g, position: i })))
      await safeInvoke(IPC.TASK_GROUP_REORDER, newOrder.map(g => g.id))
      return
    }

    // Item reorder
    const currentItems = activeManualRef.current
    const activeIdx = currentItems.findIndex(i => i.id === active.id)
    const overIdx = currentItems.findIndex(i => i.id === over.id)
    if (activeIdx === -1 || overIdx === -1) return
    const newOrder = arrayMove(currentItems, activeIdx, overIdx)
    await reorderTasks(newOrder.map(i => i.id))
  }, [reorderTasks, taskGroups])

  /** createdGroupName: the template went into a group made just for it, which undo removes and redo makes again */
  const applyTaskTemplate = useCallback(async (templateId: number, groupId: number | null, createdGroupName?: string) => {
    const result = await safeInvoke<{ createdIds: number[] }>(IPC.TASK_APPLY_TEMPLATE, templateId, groupId)
    if (result.ok) {
      // Redo creates new tasks (and a new group), so undo and redo track the current ids
      let createdIds = result.data.createdIds
      let targetGroupId = groupId
      await loadTasks()
      if (createdIds.length > 0) {
        useUndoStore.getState().push({
          id: crypto.randomUUID(),
          description: `Applied template (${createdIds.length} task${createdIds.length === 1 ? '' : 's'} added)`,
          timestamp: Date.now(),
          category: 'structural',
          icon: 'clipboard-list',
          undo: async () => {
            for (const id of createdIds) await mustInvoke(IPC.TASK_DELETE, id)
            if (createdGroupName !== undefined && targetGroupId != null) await mustInvoke(IPC.TASK_GROUP_DELETE, targetGroupId)
            await loadTasks()
            await loadTaskGroups()
          },
          redo: async () => {
            if (createdGroupName !== undefined) {
              const group = await mustInvoke<TaskGroupType>(IPC.TASK_GROUP_CREATE, createdGroupName)
              targetGroupId = group.data.id
            }
            const again = await mustInvoke<{ createdIds: number[] }>(IPC.TASK_APPLY_TEMPLATE, templateId, targetGroupId)
            createdIds = again.data.createdIds
            await loadTasks()
            await loadTaskGroups()
          },
        })
      }
    }
  }, [loadTasks, loadTaskGroups])

  const sharedHandlers = {
    onComplete: handleToggle,
    onDelete: deleteTask,
    onEdit: setEditingTask,
    onSnooze: (id: number) => setSnoozeTaskId(id),
    onUpdate: updateTask,
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div data-tour="tasks-area" className="flex flex-col gap-1 px-6 pt-3 pb-3 border-b border-slate-200 dark:border-slate-700">
        <ViewBreadcrumb items={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Tasks' }]} />
        <div className="flex items-center gap-3 flex-wrap">
        <ClipboardList className="w-5 h-5 text-slate-500" />
        <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100 min-w-0">Tasks</h1>
        <span className="text-sm text-slate-500 dark:text-slate-400">
          {totalActive} active{shownUrgentCount > 0 && ` · ${shownUrgentCount} urgent`}{overdueTasks.length > 0 && ` · ${overdueTasks.length} overdue`}
        </span>

        <button
          onClick={() => setShowAddDialog(true)}
          title={modHelp('Add a new task (Ctrl+Shift+T)')}
          className="btn-compact-primary"
        >
          + Add Task
        </button>

        <label className="flex items-center gap-1.5 text-base text-slate-600 dark:text-slate-300">
          Sort:
          <select className="input" style={{ minHeight: 36 }} value={sortMode} onChange={e => setSortMode(e.target.value as TaskSortMode)}>
            <option value="manual">My order</option>
            <option value="due_date">Due date</option>
            <option value="priority">Priority</option>
          </select>
        </label>

        <button
          onClick={handleAddGroup}
          title="Add a group to organize tasks"
          className="btn-compact-secondary"
        >
          <FolderPlus className="w-3.5 h-3.5" />
          Group
        </button>

        <button
          onClick={() => setShowTemplates(true)}
          title="Apply a checklist template"
          className="btn-compact-soft"
        >
          Templates
        </button>
        </div>
      </div>

      {/* Progress bar */}
      {!loading && totalAll > 0 && (
        <div className="px-6 py-2 bg-slate-50 dark:bg-slate-800/50">
          <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden max-w-3xl">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${progressPct}%`, backgroundColor: progressColor }}
            />
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {completedTasks.length} of {totalAll} completed{progressPct === 100 ? ' — all done!' : ''}
          </p>
        </div>
      )}

      {/* Content: tasks + scratch pad side by side */}
      <div className="flex-1 flex overflow-hidden">
        {/* Task list — left column */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
          {loadError && (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200 mb-4" role="alert">
              <span className="text-base">{loadError}</span>
              <button onClick={() => void reloadAll()} className="hit-44 flex items-center gap-1.5 text-base underline hover:no-underline">
                <RefreshCw className="w-4 h-4" />
                Retry
              </button>
            </div>
          )}
          {loading && showSpinner && (
            <LoadingOverlay label="Loading tasks…" />
          )}

          {!loading && !loadError && tasks.length === 0 && shownUrgentCount === 0 && (
            <div className="flex flex-col items-center">
              <EmptyState
                icon={<ClipboardList className="w-12 h-12" />}
                title="No tasks yet"
                description={`Tasks help you track to-dos and recurring work across your ${w('list', { many: true })}.`}
                action={{ label: 'Add your first task', onClick: () => setShowAddDialog(true) }}
              />
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
                Tip: Press <kbd className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 text-sm font-mono">{modHelp('Ctrl+Shift+T')}</kbd> to quickly add a task
              </p>
            </div>
          )}

          {/* Urgent client checklist items */}
          {!loading && checklistsOn && urgentItems.length > 0 && (
            <UrgentChecklistSection
              items={urgentItems}
              onToggle={handleToggleUrgentItem}
              onNavigate={(gridId, rowId) => { void loadGrid(gridId); navigate(`/profile/${rowId}`) }}
            />
          )}

          {!loading && (tasks.length > 0 || shownUrgentCount > 0) && (
            <>
              {sortMode !== 'manual' ? (
                /* Sorted by due date or priority: one list, no dragging (audit S-20) */
                <DndContext sensors={sensors}>
                  <SortableContext items={sortedActiveItems.map(i => i.id)} strategy={verticalListSortingStrategy}>
                  {sortedActiveItems.map(task => (
                    <TaskItem
                      key={task.id}
                      task={task}
                      isDragDisabled={true}
                      onToggle={() => handleToggle(task.id)}
                      onUpdate={updates => updateTask(task.id, updates)}
                      onDelete={() => deleteTask(task.id)}
                      onEdit={() => setEditingTask(task)}
                      onSnooze={() => setSnoozeTaskId(task.id)}
                    />
                  ))}
                  </SortableContext>
                </DndContext>
              ) : (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  {!hasTaskGroups ? (
                    /* Flat mode (no groups) */
                    <SortableContext items={activeManualItems.map(i => i.id)} strategy={verticalListSortingStrategy}>
                      {activeManualItems.map(task => (
                        <TaskItem
                          key={task.id}
                          task={task}
                          isDragDisabled={false}
                          onToggle={() => handleToggle(task.id)}
                          onUpdate={updates => updateTask(task.id, updates)}
                          onDelete={() => deleteTask(task.id)}
                          onEdit={() => setEditingTask(task)}
                          onSnooze={() => setSnoozeTaskId(task.id)}
                        />
                      ))}
                    </SortableContext>
                  ) : (
                    /* Grouped mode */
                    <>
                      {/* Ungrouped tasks first */}
                      {(groupedActiveTasks.get(null) ?? []).length > 0 && (
                        <div className="mb-1">
                          <SortableContext items={(groupedActiveTasks.get(null) ?? []).map(i => i.id)} strategy={verticalListSortingStrategy}>
                            {(groupedActiveTasks.get(null) ?? []).map(task => (
                              <TaskItem
                                key={task.id}
                                task={task}
                                isDragDisabled={false}
                                onToggle={() => handleToggle(task.id)}
                                onUpdate={updates => updateTask(task.id, updates)}
                                onDelete={() => deleteTask(task.id)}
                                onEdit={() => setEditingTask(task)}
                                onSnooze={() => setSnoozeTaskId(task.id)}
                              />
                            ))}
                          </SortableContext>
                        </div>
                      )}

                      {/* Ungrouped add input — placed above groups */}
                      <div className="mx-2 mb-2">
                        <input
                          ref={addInputRef}
                          type="text"
                          value={newTitle}
                          onChange={e => setNewTitle(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter' && newTitle.trim()) {
                              void handleInlineAdd(newTitle.trim())
                              setNewTitle('')
                            }
                          }}
                          placeholder="+ Add task... (press Enter)"
                          style={{ fontSize: 15 }}
                          className="w-full px-3 py-2 text-slate-600 dark:text-slate-400
                                     placeholder-slate-500 dark:placeholder-slate-400
                                     bg-transparent focus:outline-hidden focus:ring-3 focus:ring-blue-500 rounded-sm border-0
                                     border-b border-dashed border-slate-200 dark:border-slate-700
                                     focus:border-blue-400 dark:focus:border-blue-500"
                        />
                      </div>

                      {/* Groups sorted by position */}
                      <SortableContext
                        items={[...taskGroups].sort((a, b) => a.position - b.position).map(g => `group-${g.id}`)}
                        strategy={verticalListSortingStrategy}
                      >
                      {[...taskGroups].sort((a, b) => a.position - b.position).map(group => {
                        const groupItems = groupedActiveTasks.get(group.id) ?? []
                        const allGroupTasks = tasks.filter(t => t.group_id === group.id)
                        const groupCompleted = allGroupTasks.filter(t => t.is_completed === 1).length
                        const groupTotal = allGroupTasks.length
                        const isCollapsed = collapsedGroups.has(group.id)

                        return (
                          <div key={group.id}>
                            <ChecklistGroupHeader
                              group={group}
                              totalItems={groupTotal}
                              completedItems={groupCompleted}
                              isCollapsed={isCollapsed}
                              onToggleCollapse={() => handleToggleGroupCollapse(group.id)}
                              onRename={(name) => void handleRenameGroup(group.id, name)}
                              onDelete={() => setConfirmDeleteGroup({ id: group.id, name: group.name })}
                              isDragDisabled={false}
                            />

                            {!isCollapsed && (
                              <div className="ml-3 border-l-2 border-slate-200 dark:border-slate-600 pl-1">
                                <SortableContext items={groupItems.map(i => i.id)} strategy={verticalListSortingStrategy}>
                                  {groupItems.map(task => (
                                    <TaskItem
                                      key={task.id}
                                      task={task}
                                      isDragDisabled={false}
                                      onToggle={() => handleToggle(task.id)}
                                      onUpdate={updates => updateTask(task.id, updates)}
                                      onDelete={() => deleteTask(task.id)}
                                      onEdit={() => setEditingTask(task)}
                                      onSnooze={() => setSnoozeTaskId(task.id)}
                                    />
                                  ))}
                                </SortableContext>

                                {/* Per-group add input */}
                                <input
                                  type="text"
                                  value={groupAddTitles[group.id] ?? ''}
                                  onChange={e => setGroupAddTitles(prev => ({ ...prev, [group.id]: e.target.value }))}
                                  onKeyDown={e => {
                                    const val = (groupAddTitles[group.id] ?? '').trim()
                                    if (e.key === 'Enter' && val) {
                                      void createTask({
                                        title: val,
                                        group_id: group.id,
                                        grid_id: null,
                                        description: null,
                                        priority: 'normal',
                                        category: null,
                                        due_date: null,
                                        recurrence_rule: null,
                                        is_completed: 0,
                                        completed_at: null,
                                        snoozed_until: null,
                                        position: 0,
                                      })
                                      setGroupAddTitles(prev => ({ ...prev, [group.id]: '' }))
                                    }
                                  }}
                                  placeholder="+ Add task… (press Enter)"
                                  style={{ fontSize: 15 }}
                                  spellCheck={false}
                                  className="w-full px-3 py-1.5 text-base text-slate-500 dark:text-slate-400
                                             placeholder-slate-500 dark:placeholder-slate-400
                                             bg-transparent focus:outline-hidden focus:ring-3 focus:ring-blue-500 rounded-sm border-0"
                                />
                              </div>
                            )}
                          </div>
                        )
                      })}
                      </SortableContext>
                    </>
                  )}
                </DndContext>
              )}

              {/* Snoozed section (all sort modes) */}
              {snoozedTasks.length > 0 && (
                <TaskGroup title="Snoozed" tasks={snoozedTasks} defaultOpen={false} {...sharedHandlers} />
              )}

              {/* Inline add input (flat/no-groups mode only — grouped mode has its own above the groups) */}
              {(!hasTaskGroups || sortMode !== 'manual') && (
                <div className="mx-2 mt-2">
                  <input
                    ref={addInputRef}
                    type="text"
                    value={newTitle}
                    onChange={e => setNewTitle(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && newTitle.trim()) {
                        void handleInlineAdd(newTitle.trim())
                        setNewTitle('')
                      }
                    }}
                    placeholder="+ Add task... (press Enter)"
                    style={{ fontSize: 15 }}
                    className="w-full px-3 py-2 text-slate-600 dark:text-slate-400
                               placeholder-slate-500 dark:placeholder-slate-400
                               bg-transparent focus:outline-hidden focus:ring-3 focus:ring-blue-500 rounded-sm border-0
                               border-b border-dashed border-slate-200 dark:border-slate-700
                               focus:border-blue-400 dark:focus:border-blue-500"
                  />
                </div>
              )}

              {/* Completed section */}
              {completedTasks.length > 0 && (
                <div className="border-t border-slate-100 dark:border-slate-700 mt-4 pt-2">
                  <div className="flex items-center">
                    <button
                      onClick={() => setShowCompleted(p => !p)}
                      className="hit-44 flex items-center gap-2 flex-1 text-left px-1 py-2
                                 text-base font-medium text-slate-500 dark:text-slate-400
                                 hover:text-slate-600 dark:hover:text-slate-300
                                 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 rounded-sm"
                    >
                      {showCompleted ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      Completed
                      <span className="ml-1 px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-sm">
                        {completedTasks.length}
                      </span>
                    </button>
                    <button
                      onClick={() => setShowClearConfirm(true)}
                      className="hit-44 px-2.5 py-1 rounded-sm text-base text-slate-500 dark:text-slate-400
                                 hover:text-red-500 dark:hover:text-red-400
                                 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors
                                 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-red-400"
                    >
                      Delete completed
                    </button>
                  </div>
                  {showCompleted && (
                    <div className="space-y-0.5 mt-1">
                      {completedTasks.map(task => (
                        <CompletedTaskItem
                          key={task.id}
                          task={task}
                          onUncheck={() => handleToggle(task.id)}
                          onDelete={() => deleteTask(task.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Scrap Notes — right column */}
        <div className="w-[480px] min-w-[400px] flex-shrink-0 border-l border-slate-200 dark:border-slate-700 overflow-y-auto bg-slate-50 dark:bg-slate-800/50 p-4">
          <ScratchPad globalScope="tasks" />
        </div>
      </div>

      {/* Add/Edit dialog */}
      {(showAddDialog || editingTask) && (
        <TaskFormDialog
          onClose={() => { setShowAddDialog(false); setEditingTask(null) }}
          onSave={handleSaveTask}
          initial={editingTask ?? undefined}
          groups={taskGroups}
        />
      )}

      {/* Snooze dialog */}
      {snoozeTaskId !== null && (
        <SnoozeDialog
          onClose={() => setSnoozeTaskId(null)}
          onSnooze={until => { snoozeTask(snoozeTaskId, until); setSnoozeTaskId(null) }}
        />
      )}

      {/* Delete group confirmation */}
      <ConfirmDialog
        open={confirmDeleteGroup !== null}
        title="Delete group"
        message={`Delete group "${confirmDeleteGroup?.name}"? Items will become ungrouped.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => confirmDeleteGroup && void handleDeleteGroup(confirmDeleteGroup.id)}
        onCancel={() => setConfirmDeleteGroup(null)}
      />

      {/* Clear completed confirmation */}
      <ConfirmDialog
        open={showClearConfirm}
        title="Delete completed tasks"
        message={`Delete ${completedTasks.length} completed task${completedTasks.length === 1 ? '' : 's'}? You can undo this.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => { setShowClearConfirm(false); await deleteTasks(completedTasks.map(t => t.id)); setShowCompleted(false) }}
        onCancel={() => setShowClearConfirm(false)}
      />

      {/* Checklist template manager */}
      {showTemplates && (
        <TemplateManager
          onApply={(templateId) => {
            setPendingTemplateId(templateId)
            setShowTemplates(false)
          }}
          onClose={() => setShowTemplates(false)}
        />
      )}

      {/* GroupPicker for template apply */}
      {pendingTemplateId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <GroupPicker
            groups={taskGroups}
            onSelect={(groupId) => {
              const tid = pendingTemplateId
              setPendingTemplateId(null)
              void applyTaskTemplate(tid, groupId)
            }}
            onCreateAndSelect={async (name) => {
              const res = await safeInvoke<TaskGroupType>(IPC.TASK_GROUP_CREATE, name)
              if (res.ok) {
                setTaskGroups(prev => [...prev, res.data])
                const tid = pendingTemplateId
                setPendingTemplateId(null)
                void applyTaskTemplate(tid, res.data.id, res.data.name)
              }
            }}
            onCancel={() => setPendingTemplateId(null)}
          />
        </div>
      )}
    </div>
  )
}
