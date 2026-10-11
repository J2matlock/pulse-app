// @vitest-environment jsdom
/**
 * A08-5: a task or group drag that didn't save is put back (or reloaded),
 * the user is told, and no undo is offered for it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { CaseloadTask, TaskGroup } from '../../../src/shared/types'

const groups: TaskGroup[] = [
  { id: 1, name: 'Group One', position: 0, is_collapsed: 0, created_at: '' },
  { id: 2, name: 'Group Two', position: 1, is_collapsed: 0, created_at: '' },
]
function makeTask(id: number, title: string, groupId: number | null, position: number): CaseloadTask {
  return {
    id, grid_id: null, group_id: groupId, title, description: null, priority: 'normal', category: null,
    due_date: null, recurrence_rule: null, is_completed: 0, completed_at: null, snoozed_until: null,
    position, created_at: '', updated_at: '',
  }
}
let failing = ''
const invoke = vi.fn(async (channel: string) => {
  if (channel === failing) return { ok: false, error: 'Invalid reorder payload' }
  if (channel === 'task:group-get-all') return { ok: true, data: groups }
  if (channel === 'task:get-all') return { ok: true, data: [makeTask(5, 'Test task A', 1, 0), makeTask(6, 'Test task B', 2, 1)] }
  return { ok: true, data: [] }
})
Object.defineProperty(window, 'api', { value: { invoke, on: vi.fn().mockReturnValue(vi.fn()), copyToClipboard: vi.fn() }, writable: true })

const toastError = vi.hoisted(() => vi.fn())
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: toastError, success: vi.fn() }) }))
vi.mock('lucide-react', async () => (await import('../lucideMock')).lucideMock)
vi.mock('../../../src/renderer/views/tasks/TaskFormDialog', () => ({ TaskFormDialog: () => null }))
vi.mock('../../../src/renderer/components/profile/Checklist', () => ({ TemplateManager: () => null, Checklist: () => null }))
vi.mock('../../../src/renderer/components/profile/ScratchPad', () => ({ ScratchPad: () => null }))

// The page's drop handler, so a test can drop without a pointer
const dnd = vi.hoisted(() => ({ onDragEnd: null as null | ((e: unknown) => Promise<void> | void) }))
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>()
  return {
    ...actual,
    DndContext: (props: React.ComponentProps<typeof actual.DndContext>) => {
      if (props.onDragEnd) dnd.onDragEnd = props.onDragEnd as (e: unknown) => void
      return React.createElement(actual.DndContext, props)
    },
  }
})

import TasksView from '../../../src/renderer/views/TasksView'
import { useUndoStore } from '../../../src/renderer/stores/undoStore'
import { useTaskStore } from '../../../src/renderer/stores/taskStore'

beforeEach(() => {
  failing = ''
  invoke.mockClear()
  toastError.mockClear()
  dnd.onDragEnd = null
  useTaskStore.setState({ tasks: [], sortMode: 'manual' })
  useUndoStore.setState({ undoStack: [], redoStack: [], toast: null, isUndoing: false })
})

async function renderPage() {
  render(<MemoryRouter><TasksView /></MemoryRouter>)
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  await screen.findByText('Test task A')
}

const groupOrder = () => screen.getAllByText(/^Group (One|Two)$/).map(el => el.textContent)

describe('Task drags that did not save', () => {
  it('puts the groups back in their old order when a group reorder failed', async () => {
    failing = 'task:group-reorder'
    await renderPage()
    expect(groupOrder()).toEqual(['Group One', 'Group Two'])
    await act(async () => { await dnd.onDragEnd?.({ active: { id: 'group-2' }, over: { id: 'group-1' } }) })
    expect(groupOrder()).toEqual(['Group One', 'Group Two'])
    expect(toastError).toHaveBeenCalledWith("We couldn't move that group — try again")
  })

  it('offers no undo when a task moved to another group but its new place failed to save', async () => {
    failing = 'task:reorder'
    await renderPage()
    await act(async () => { await dnd.onDragEnd?.({ active: { id: 5 }, over: { id: 6 } }) })
    expect(toastError).toHaveBeenCalledWith("We couldn't save the new order — try again")
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
  })

  it('offers undo when the move saved', async () => {
    await renderPage()
    await act(async () => { await dnd.onDragEnd?.({ active: { id: 5 }, over: { id: 6 } }) })
    expect(toastError).not.toHaveBeenCalled()
    expect(useUndoStore.getState().undoStack.at(-1)?.description).toMatch(/Moved task "Test task A"/)
  })
})
