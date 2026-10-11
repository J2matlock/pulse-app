import { create } from 'zustand'
import { IPC } from '../../shared/ipc-channels'
import type { CaseloadTask } from '../../shared/types'
import { useUndoStore } from './undoStore'
import { storeInvoke } from '../utils/safeInvoke'

export type TaskSortMode = 'manual' | 'due_date' | 'priority'

export interface CompleteTaskOptions {
  task?: Pick<CaseloadTask, 'title' | 'due_date'> & Partial<Pick<CaseloadTask, 'is_completed' | 'completed_at'>>
  toast?: boolean
  onUndo?: () => void
  onRedo?: () => void
}

interface TaskStore {
  tasks: CaseloadTask[]
  loading: boolean
  sortMode: TaskSortMode
  _loadVersion: number
  /** Resolves false when the tasks couldn't be loaded, so a page can say so instead of showing "no tasks" */
  loadTasks: (gridId?: number) => Promise<boolean>
  createTask: (task: Omit<CaseloadTask, 'id' | 'created_at' | 'updated_at'>) => Promise<CaseloadTask | null>
  updateTask: (id: number, updates: Partial<CaseloadTask>) => Promise<void>
  deleteTask: (id: number) => Promise<void>
  /** Several at once, as one undo step ("Delete completed") */
  deleteTasks: (ids: number[]) => Promise<void>
  /**
   * Tick a task off, with one undo step. Pages that don't load the task list
   * (Dashboard, Focus mode) pass the task they show, ask for the toast, and get
   * told when undo or redo puts it back or takes it away again.
   */
  completeTask: (id: number, opts?: CompleteTaskOptions) => Promise<boolean>
  snoozeTask: (id: number, until: string) => Promise<void>
  setSortMode: (mode: TaskSortMode) => void
  reorderTasks: (orderedIds: number[]) => Promise<void>
}

/** Tasks being ticked off right now: a quick second click is ignored (audit L-27) */
const completing = new Set<number>()

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: [],
  loading: false,
  sortMode: 'manual',
  _loadVersion: 0,

  loadTasks: async (gridId?: number) => {
    const version = get()._loadVersion + 1
    set({ loading: true, _loadVersion: version })
    try {
      const data = await storeInvoke<CaseloadTask[]>(IPC.TASK_GET_ALL, gridId)
      if (get()._loadVersion !== version) return true // stale response
      set({ tasks: data })
      return true
    } catch {
      // Leave tasks unchanged on error
      return false
    } finally {
      if (get()._loadVersion === version) set({ loading: false })
    }
  },

  createTask: async (task) => {
    try {
      const created = await storeInvoke<CaseloadTask>(IPC.TASK_CREATE, task)
      set(state => ({ tasks: [...state.tasks, created] }))
      useUndoStore.getState().push({
        id: crypto.randomUUID(),
        description: `Created task "${created.title}"`,
        timestamp: Date.now(),
        category: 'logged',
        icon: 'plus',
        undo: async () => {
          await storeInvoke(IPC.TASK_DELETE, created.id)
          await useTaskStore.getState().loadTasks()
        },
        redo: async () => {
          await storeInvoke(IPC.TASK_RESTORE, created)
          await useTaskStore.getState().loadTasks()
        },
      })
      return created
    } catch {
      return null
    }
  },

  updateTask: async (id, updates) => {
    const prev = get().tasks.find(t => t.id === id)
    try {
      await storeInvoke(IPC.TASK_UPDATE, id, updates)
    } catch { return }
    set(state => ({
      tasks: state.tasks.map(t => t.id === id ? { ...t, ...updates } : t)
    }))
    if (prev) {
      const prevValues = Object.fromEntries(
        (Object.keys(updates) as Array<keyof CaseloadTask>).map(k => [k, prev[k]])
      ) as Partial<CaseloadTask>
      useUndoStore.getState().push({
        id: crypto.randomUUID(),
        description: `Updated task "${prev.title}"`,
        timestamp: Date.now(),
        category: 'logged',
        icon: 'edit',
        undo: async () => {
          await storeInvoke(IPC.TASK_UPDATE, id, prevValues)
          await useTaskStore.getState().loadTasks()
        },
        redo: async () => {
          await storeInvoke(IPC.TASK_UPDATE, id, updates)
          await useTaskStore.getState().loadTasks()
        },
      })
    }
  },

  deleteTask: async (id) => {
    const task = get().tasks.find(t => t.id === id)
    try {
      await storeInvoke(IPC.TASK_DELETE, id)
    } catch { return }
    set(state => ({ tasks: state.tasks.filter(t => t.id !== id) }))
    if (task) {
      useUndoStore.getState().push({
        id: crypto.randomUUID(),
        description: `Deleted task "${task.title}"`,
        timestamp: Date.now(),
        category: 'logged',
        icon: 'trash',
        undo: async () => {
          await storeInvoke(IPC.TASK_RESTORE, task)
          await useTaskStore.getState().loadTasks()
        },
        redo: async () => {
          await storeInvoke(IPC.TASK_DELETE, id)
          await useTaskStore.getState().loadTasks()
        },
      })
    }
  },

  deleteTasks: async (ids) => {
    const gone = get().tasks.filter(t => ids.includes(t.id))
    const deleted: CaseloadTask[] = []
    for (const task of gone) {
      try { await storeInvoke(IPC.TASK_DELETE, task.id); deleted.push(task) } catch { /* keep going; undo covers what went */ }
    }
    if (deleted.length === 0) return
    const ids2 = new Set(deleted.map(t => t.id))
    set(state => ({ tasks: state.tasks.filter(t => !ids2.has(t.id)) }))
    useUndoStore.getState().pushWithToast({
      id: crypto.randomUUID(),
      description: `Deleted ${deleted.length} completed task${deleted.length === 1 ? '' : 's'}`,
      timestamp: Date.now(),
      category: 'logged',
      icon: 'trash',
      undo: async () => {
        for (const task of deleted) await storeInvoke(IPC.TASK_RESTORE, task)
        await useTaskStore.getState().loadTasks()
      },
      redo: async () => {
        for (const task of deleted) await storeInvoke(IPC.TASK_DELETE, task.id)
        await useTaskStore.getState().loadTasks()
      },
    })
  },

  completeTask: async (id, opts) => {
    const task = get().tasks.find(t => t.id === id) ?? opts?.task
    if (completing.has(id)) return false
    completing.add(id)
    try {
      // The due date it was ticked at: main ignores it if the task has already moved on
      const done = await storeInvoke<boolean>(IPC.TASK_COMPLETE, id, task ? task.due_date ?? null : undefined)
      if (done === false) return false
    } catch { return false } finally { completing.delete(id) }
    try {
      const allData = await storeInvoke<CaseloadTask[]>(IPC.TASK_GET_ALL)
      set({ tasks: allData })
    } catch { /* leave tasks as-is */ }
    if (task) {
      const item = {
        id: crypto.randomUUID(),
        description: `Completed task "${task.title}"`,
        timestamp: Date.now(),
        category: 'logged' as const,
        icon: 'check',
        undo: async () => {
          await storeInvoke(IPC.TASK_UNCOMPLETE, id, {
            is_completed: task.is_completed ?? 0,
            completed_at: task.completed_at ?? null,
            due_date: task.due_date ?? null,
          })
          await useTaskStore.getState().loadTasks()
          opts?.onUndo?.()
        },
        redo: async () => {
          await storeInvoke(IPC.TASK_COMPLETE, id, task.due_date ?? null)
          await useTaskStore.getState().loadTasks()
          opts?.onRedo?.()
        },
      }
      if (opts?.toast) useUndoStore.getState().pushWithToast(item)
      else useUndoStore.getState().push(item)
    }
    return true
  },

  snoozeTask: async (id, until) => {
    const task = get().tasks.find(t => t.id === id)
    const prevSnooze = task?.snoozed_until ?? null
    try {
      await storeInvoke(IPC.TASK_SNOOZE, id, until)
    } catch { return }
    set(state => ({
      tasks: state.tasks.map(t => t.id === id ? { ...t, snoozed_until: until } : t)
    }))
    useUndoStore.getState().push({
      id: crypto.randomUUID(),
      description: `Snoozed task "${task?.title ?? ''}"`,
      timestamp: Date.now(),
      category: 'logged',
      icon: 'snooze',
      undo: async () => {
        await storeInvoke(IPC.TASK_UPDATE, id, { snoozed_until: prevSnooze })
        await useTaskStore.getState().loadTasks()
      },
      redo: async () => {
        await storeInvoke(IPC.TASK_SNOOZE, id, until)
        await useTaskStore.getState().loadTasks()
      },
    })
  },

  setSortMode: (mode) => set({ sortMode: mode }),

  reorderTasks: async (orderedIds) => {
    const oldOrder = get().tasks.map(t => t.id)
    set(state => {
      const taskMap = new Map(state.tasks.map(t => [t.id, t]))
      const reordered = orderedIds
        .map((id, i) => {
          const task = taskMap.get(id)
          return task ? { ...task, position: i } : null
        })
        .filter((t): t is CaseloadTask => t !== null)
      const orderedSet = new Set(orderedIds)
      const rest = state.tasks.filter(t => !orderedSet.has(t.id))
      return { tasks: [...reordered, ...rest] }
    })
    try {
      await storeInvoke(IPC.TASK_REORDER, orderedIds)
    } catch {
      // Revert optimistic update on failure
      await useTaskStore.getState().loadTasks()
      return
    }
    useUndoStore.getState().push({
      id: crypto.randomUUID(),
      description: 'Reordered tasks',
      timestamp: Date.now(),
      category: 'logged',
      icon: 'reorder',
      undo: async () => {
        await storeInvoke(IPC.TASK_REORDER, oldOrder)
        await useTaskStore.getState().loadTasks()
      },
      redo: async () => {
        await storeInvoke(IPC.TASK_REORDER, orderedIds)
        await useTaskStore.getState().loadTasks()
      },
    })
  },
}))
