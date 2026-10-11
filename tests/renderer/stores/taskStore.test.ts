/**
 * taskStore.test.ts — Zustand task store unit tests.
 * Mocks window.api.invoke for all IPC calls.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock window.api before importing the store
const mockInvoke = vi.fn()
;(globalThis as Record<string, unknown>).window = { api: { invoke: mockInvoke } }

// Mock react-hot-toast
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn() } }))

// Mock crypto.randomUUID
vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2) })

import { useTaskStore } from '../../../src/renderer/stores/taskStore'
import { useUndoStore } from '../../../src/renderer/stores/undoStore'
import type { CaseloadTask } from '../../../src/shared/types'

function makeTask(id: number, overrides: Partial<CaseloadTask> = {}): CaseloadTask {
  return {
    id,
    grid_id: 1,
    title: `Task ${id}`,
    description: null,
    priority: 'medium',
    category: null,
    due_date: null,
    recurrence_rule: null,
    is_completed: 0,
    completed_at: null,
    snoozed_until: null,
    position: id - 1,
    created_at: '2026-01-01T00:00:00',
    updated_at: '2026-01-01T00:00:00',
    ...overrides,
  }
}

describe('taskStore', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    useTaskStore.setState({ tasks: [], loading: false, sortMode: 'manual' })
    useUndoStore.setState({ undoStack: [], redoStack: [], toast: null, isUndoing: false })
  })

  describe('loadTasks', () => {
    it('populates tasks from IPC response', async () => {
      const tasks = [makeTask(1), makeTask(2)]
      mockInvoke.mockResolvedValue({ ok: true, data: tasks })

      await useTaskStore.getState().loadTasks(1)
      expect(useTaskStore.getState().tasks).toEqual(tasks)
      expect(useTaskStore.getState().loading).toBe(false)
    })

    it('sets loading true during fetch', async () => {
      mockInvoke.mockImplementation(() => {
        // Verify loading is true while awaiting
        expect(useTaskStore.getState().loading).toBe(true)
        return Promise.resolve({ ok: true, data: [] })
      })

      await useTaskStore.getState().loadTasks()
      expect(useTaskStore.getState().loading).toBe(false)
    })

    it('sets loading false even on IPC failure', async () => {
      mockInvoke.mockResolvedValue({ ok: false, error: 'DB error' })

      await useTaskStore.getState().loadTasks()
      expect(useTaskStore.getState().loading).toBe(false)
      expect(useTaskStore.getState().tasks).toEqual([])
    })
  })

  describe('createTask', () => {
    it('adds task to list and returns created task', async () => {
      const created = makeTask(10, { title: 'New task' })
      mockInvoke.mockResolvedValue({ ok: true, data: created })

      const result = await useTaskStore.getState().createTask({
        grid_id: 1,
        title: 'New task',
        description: null,
        priority: 'medium',
        category: null,
        due_date: null,
        recurrence_rule: null,
        is_completed: 0,
        completed_at: null,
        snoozed_until: null,
        position: 0,
        updated_at: '2026-01-01T00:00:00',
      })

      expect(result).toEqual(created)
      expect(useTaskStore.getState().tasks).toHaveLength(1)
      expect(useTaskStore.getState().tasks[0]!.title).toBe('New task')
    })

    it('returns null on IPC failure', async () => {
      mockInvoke.mockResolvedValue({ ok: false, error: 'fail' })

      const result = await useTaskStore.getState().createTask({
        grid_id: 1,
        title: 'Fail task',
        description: null,
        priority: 'low',
        category: null,
        due_date: null,
        recurrence_rule: null,
        is_completed: 0,
        completed_at: null,
        snoozed_until: null,
        position: 0,
        updated_at: '2026-01-01T00:00:00',
      })

      expect(result).toBeNull()
      expect(useTaskStore.getState().tasks).toHaveLength(0)
    })

    it('pushes undo entry on successful create', async () => {
      const created = makeTask(5)
      mockInvoke.mockResolvedValue({ ok: true, data: created })

      await useTaskStore.getState().createTask({
        grid_id: 1, title: 'Test', description: null, priority: 'medium',
        category: null, due_date: null, recurrence_rule: null, is_completed: 0,
        completed_at: null, snoozed_until: null, position: 0, updated_at: '',
      })

      expect(useUndoStore.getState().undoStack).toHaveLength(1)
      expect(useUndoStore.getState().undoStack[0]!.description).toContain('Created task')
    })
  })

  describe('updateTask', () => {
    it('modifies existing task in state', async () => {
      useTaskStore.setState({ tasks: [makeTask(1, { title: 'Old title' })] })
      mockInvoke.mockResolvedValue({ ok: true, data: true })

      await useTaskStore.getState().updateTask(1, { title: 'New title' })
      expect(useTaskStore.getState().tasks[0]!.title).toBe('New title')
    })

    it('does not modify state on IPC failure', async () => {
      useTaskStore.setState({ tasks: [makeTask(1, { title: 'Original' })] })
      mockInvoke.mockResolvedValue({ ok: false, error: 'fail' })

      await useTaskStore.getState().updateTask(1, { title: 'Changed' })
      expect(useTaskStore.getState().tasks[0]!.title).toBe('Original')
    })

    it('pushes undo entry with previous values', async () => {
      useTaskStore.setState({ tasks: [makeTask(1, { title: 'Before' })] })
      mockInvoke.mockResolvedValue({ ok: true, data: true })

      await useTaskStore.getState().updateTask(1, { title: 'After' })
      expect(useUndoStore.getState().undoStack).toHaveLength(1)
      expect(useUndoStore.getState().undoStack[0]!.description).toContain('Updated task')
    })
  })

  describe('deleteTask', () => {
    it('removes task from list', async () => {
      useTaskStore.setState({ tasks: [makeTask(1), makeTask(2)] })
      mockInvoke.mockResolvedValue({ ok: true, data: true })

      await useTaskStore.getState().deleteTask(1)
      expect(useTaskStore.getState().tasks).toHaveLength(1)
      expect(useTaskStore.getState().tasks[0]!.id).toBe(2)
    })

    it('does not remove on IPC failure', async () => {
      useTaskStore.setState({ tasks: [makeTask(1)] })
      mockInvoke.mockResolvedValue({ ok: false, error: 'fail' })

      await useTaskStore.getState().deleteTask(1)
      expect(useTaskStore.getState().tasks).toHaveLength(1)
    })

    it('pushes undo entry on successful delete', async () => {
      useTaskStore.setState({ tasks: [makeTask(3, { title: 'Remove me' })] })
      mockInvoke.mockResolvedValue({ ok: true, data: true })

      await useTaskStore.getState().deleteTask(3)
      expect(useUndoStore.getState().undoStack).toHaveLength(1)
      expect(useUndoStore.getState().undoStack[0]!.description).toContain('Deleted task')
    })
  })

  describe('deleteTasks', () => {
    it('deletes several finished tasks as one undo step that brings them all back (audit S-22)', async () => {
      useTaskStore.setState({ tasks: [makeTask(1, { is_completed: 1 }), makeTask(2, { is_completed: 1 }), makeTask(3)] })
      mockInvoke.mockResolvedValue({ ok: true, data: true })
      await useTaskStore.getState().deleteTasks([1, 2])
      expect(useTaskStore.getState().tasks.map(t => t.id)).toEqual([3])
      expect(useUndoStore.getState().undoStack).toHaveLength(1)
      expect(useUndoStore.getState().undoStack[0]!.description).toBe('Deleted 2 completed tasks')
      mockInvoke.mockClear()
      await useUndoStore.getState().undo()
      expect(mockInvoke.mock.calls.filter(c => c[0] === 'task:restore')).toHaveLength(2)
    })
  })

  describe('setSortMode', () => {
    it('updates sort mode in state', () => {
      useTaskStore.getState().setSortMode('due_date')
      expect(useTaskStore.getState().sortMode).toBe('due_date')
    })

    it('supports all sort modes', () => {
      for (const mode of ['manual', 'due_date', 'priority', 'category'] as const) {
        useTaskStore.getState().setSortMode(mode)
        expect(useTaskStore.getState().sortMode).toBe(mode)
      }
    })
  })
})
