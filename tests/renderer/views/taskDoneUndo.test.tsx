// @vitest-environment jsdom
/**
 * Ticking a task off from the Dashboard puts one undo step on the stack, and
 * that undo reopens the task (TASK_UNCOMPLETE with its old due date) instead
 * of failing on TASK_RESTORE.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'

const invoke = vi.fn(async (channel: string, ..._args: unknown[]) => {
  if (channel === 'task:complete') return { ok: true, data: true }
  if (channel === 'task:get-all') return { ok: true, data: [] }
  if (channel === 'task:uncomplete') return { ok: true, data: true }
  return { ok: false, error: 'unexpected' }
})
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))

import { TaskRow } from '../../../src/renderer/views/dashboard/TaskRow'
import { useTaskStore } from '../../../src/renderer/stores/taskStore'
import { useUndoStore } from '../../../src/renderer/stores/undoStore'
import type { CaseloadTask } from '../../../src/shared/types'

const task = {
  id: 4, grid_id: null, group_id: null, title: 'Call the landlord', description: null, priority: 'normal', category: null,
  due_date: '2026-10-10', recurrence_rule: 'weekly', is_completed: 0, completed_at: null, snoozed_until: null,
  position: 0, created_at: '', updated_at: '',
} as unknown as CaseloadTask

beforeEach(() => {
  invoke.mockClear()
  useTaskStore.setState({ tasks: [] })
  useUndoStore.setState({ undoStack: [], redoStack: [], toast: null, isUndoing: false })
})

describe('Done on a Dashboard task', () => {
  it('pushes one undo step that reopens the task with its old due date', async () => {
    const onComplete = vi.fn()
    const onRestore = vi.fn()
    render(<TaskRow task={task} daysUntil={-1} onComplete={onComplete} onRestore={onRestore} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Mark complete' })) })
    expect(onComplete).toHaveBeenCalledWith(4)
    expect(invoke).toHaveBeenCalledWith('task:complete', 4, '2026-10-10')
    expect(useUndoStore.getState().undoStack).toHaveLength(1)
    expect(useUndoStore.getState().toast?.description).toBe('Completed task "Call the landlord"')

    await act(async () => { await useUndoStore.getState().undo() })
    expect(invoke).toHaveBeenCalledWith('task:uncomplete', 4, { is_completed: 0, completed_at: null, due_date: '2026-10-10', snoozed_until: null })
    expect(invoke.mock.calls.some(c => c[0] === 'task:restore')).toBe(false)
    expect(onRestore).toHaveBeenCalledWith(task)
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
    expect(useUndoStore.getState().redoStack).toHaveLength(1)
  })

  it('an urgent task gets the red dot, not the white one (bug sweep S2)', () => {
    const { container, rerender } = render(<TaskRow task={{ ...task, priority: 'urgent' } as CaseloadTask} daysUntil={3} onComplete={vi.fn()} />)
    expect(container.textContent).toContain('🔴')
    rerender(<TaskRow task={{ ...task, priority: 'low' } as CaseloadTask} daysUntil={3} onComplete={vi.fn()} />)
    expect(container.textContent).toContain('⚪')
  })
})
