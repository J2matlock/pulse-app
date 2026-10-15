// @vitest-environment jsdom
/** The one task dialog (audit 1.27): edits send only what changed; Repeat needs a date; snooze dates agree. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'

vi.mock('../../src/renderer/hooks/useFocusTrap', () => ({ useFocusTrap: vi.fn() }))
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
const invoke = vi.fn(async (channel: string, ..._args: unknown[]) => {
  if (channel === 'task:complete') { await new Promise(r => setTimeout(r, 5)); return { ok: true, data: true } }
  return { ok: true, data: [] }
})
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })
if (!globalThis.crypto?.randomUUID) vi.stubGlobal('crypto', { randomUUID: () => 'id-' + Math.random() })

import { TaskFormDialog } from '../../src/renderer/views/tasks/TaskFormDialog'
import { isSnoozed } from '../../src/renderer/views/tasks/taskHelpers'
import { useTaskStore } from '../../src/renderer/stores/taskStore'
import { useGridStore } from '../../src/renderer/stores/gridStore'
import { IPC } from '../../src/shared/ipc-channels'
import { localDateString, localDateFromToday } from '../../src/shared/dates'
import type { CaseloadTask } from '../../src/shared/types'
import { setWords } from './vocabFixture'

const task = {
  id: 4, grid_id: 2, group_id: null, title: 'Call pharmacy', description: null, priority: 'normal', category: 'Admin',
  due_date: '2030-01-15', recurrence_rule: null, is_completed: 0, completed_at: null, snoozed_until: '2030-01-10', position: 0,
} as CaseloadTask

beforeEach(() => {
  setWords(); invoke.mockClear()
  useGridStore.setState({ grids: [{ id: 2, name: 'Clients' }] } as never)
})

describe('TaskFormDialog', () => {
  it('editing sends only the fields that changed, keeping the list, category and snooze', () => {
    const onSave = vi.fn()
    render(<TaskFormDialog initial={task} onSave={onSave} onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Call the pharmacy' } })
    fireEvent.click(screen.getByText('Save changes'))
    expect(onSave).toHaveBeenCalledWith({ title: 'Call the pharmacy' })
  })

  it('adding offers the list and category, and a repeat starts today', () => {
    const onSave = vi.fn()
    render(<TaskFormDialog onSave={onSave} onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Timesheet' } })
    fireEvent.change(screen.getByLabelText(/^Label/), { target: { value: 'Admin' } })
    fireEvent.change(document.getElementById('task-grid')!, { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('Repeat'), { target: { value: 'weekly' } })
    expect((screen.getByLabelText('Due date') as HTMLInputElement).value).toBe(localDateString())
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Timesheet', category: 'Admin', grid_id: 2, due_date: localDateString(), recurrence_rule: JSON.stringify({ type: 'weekly', interval: 1 }),
    }))
  })

  it("won't save a repeating task without a due date", () => {
    const onSave = vi.fn()
    render(<TaskFormDialog onSave={onSave} onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Timesheet' } })
    fireEvent.change(screen.getByLabelText('Repeat'), { target: { value: 'weekly' } })
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toMatch(/needs a due date/)
    // …and the due date box points at the message (audit A06-14)
    const due = screen.getByLabelText('Due date')
    expect(due.getAttribute('aria-invalid')).toBe('true')
    expect(due.getAttribute('aria-describedby')).toBe(screen.getByRole('alert').id)
  })
})

describe('tasks', () => {
  it('snoozed until tomorrow is hidden today and due again tomorrow', () => {
    expect(isSnoozed({ ...task, snoozed_until: localDateFromToday(1) })).toBe(true)
    expect(isSnoozed({ ...task, snoozed_until: localDateString() })).toBe(false)
  })

  it('a quick second click while ticking off is ignored, and the due date goes along', async () => {
    useTaskStore.setState({ tasks: [task] })
    await act(async () => { await Promise.all([useTaskStore.getState().completeTask(4), useTaskStore.getState().completeTask(4)]) })
    const calls = invoke.mock.calls.filter(c => c[0] === IPC.TASK_COMPLETE)
    expect(calls).toEqual([[IPC.TASK_COMPLETE, 4, '2030-01-15']])
  })
})
