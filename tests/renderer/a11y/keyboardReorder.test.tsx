// @vitest-environment jsdom
/**
 * AUDIT-049: tasks and checklist items can be reordered from the keyboard
 * (Tab to the handle, Space, Down arrow, Space), the move saves the same way a
 * mouse drag does, and a screen reader hears the item's name, not its id.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { CaseloadTask, ChecklistItem } from '../../../src/shared/types'

function makeTask(id: number, title: string, position: number): CaseloadTask {
  return {
    id, grid_id: null, group_id: null, title, description: null, priority: 'normal', category: null,
    due_date: null, recurrence_rule: null, is_completed: 0, completed_at: null, snoozed_until: null,
    position, created_at: '', updated_at: '',
  }
}
function makeItem(id: number, title: string, position: number): ChecklistItem {
  return {
    id, row_id: 10, title, description: null, is_completed: 0, due_date: null, completed_at: null,
    completed_by: null, position, category: null, priority: 'normal', is_archived: 0, created_at: '',
    template_source_id: null, recurrence_rule: null, group_id: null,
  }
}

let failing = ''
const invoke = vi.fn(async (channel: string) => {
  if (channel === failing) return { ok: false, error: 'Invalid reorder payload' }
  if (channel === 'task:get-all') return { ok: true, data: [makeTask(5, 'Test task A', 0), makeTask(6, 'Test task B', 1), makeTask(7, 'Test task C', 2)] }
  if (channel === 'checklist:get') return { ok: true, data: [makeItem(1, 'Test item A', 0), makeItem(2, 'Test item B', 1), makeItem(3, 'Test item C', 2)] }
  return { ok: true, data: [] }
})
Object.defineProperty(window, 'api', { value: { invoke, on: vi.fn().mockReturnValue(vi.fn()), copyToClipboard: vi.fn() }, writable: true })

const toastError = vi.hoisted(() => vi.fn())
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: toastError, success: vi.fn() }) }))
vi.mock('lucide-react', async () => (await import('../lucideMock')).lucideMock)
vi.mock('../../../src/renderer/views/tasks/TaskFormDialog', () => ({ TaskFormDialog: () => null }))
vi.mock('../../../src/renderer/components/profile/ScratchPad', () => ({ ScratchPad: () => null }))

import TasksView from '../../../src/renderer/views/TasksView'
import { Checklist } from '../../../src/renderer/components/profile/Checklist'
import { useTaskStore } from '../../../src/renderer/stores/taskStore'
import { useUndoStore } from '../../../src/renderer/stores/undoStore'
import { setWords } from '../vocabFixture'

// jsdom has no layout: give every element its own box, top to bottom in page
// order, so the arrow keys have somewhere to move to
const realRect = HTMLElement.prototype.getBoundingClientRect
beforeEach(() => {
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const i = Array.prototype.indexOf.call(document.querySelectorAll('*'), this) as number
    const top = i * 50
    return { x: 0, y: top, top, left: 0, right: 300, bottom: top + 40, width: 300, height: 40, toJSON: () => ({}) } as DOMRect
  }
  setWords()
  failing = ''
  invoke.mockClear()
  toastError.mockClear()
  useTaskStore.setState({ tasks: [], sortMode: 'manual' })
  useUndoStore.setState({ undoStack: [], redoStack: [], toast: null, isUndoing: false })
})
afterEach(() => { HTMLElement.prototype.getBoundingClientRect = realRect })

const tick = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })

async function key(target: Element | Document, code: string) {
  await act(async () => { fireEvent.keyDown(target, { code, key: code === 'Space' ? ' ' : code }) })
  await tick()
}

/** Space on the handle, Down, Space: the keyboard version of dragging it one place down */
async function moveDownOne(handle: HTMLElement) {
  handle.focus()
  await key(handle, 'Space')
  await key(document, 'ArrowDown')
  await key(document, 'Space')
}

function liveText(): string {
  return Array.from(document.querySelectorAll('[aria-live]')).map(el => el.textContent ?? '').join(' ')
}

describe('keyboard reorder', () => {
  it('moves a task down one place and saves the new order', async () => {
    render(<MemoryRouter><TasksView /></MemoryRouter>)
    await screen.findByText('Test task A')
    const handle = screen.getByRole('button', { name: 'Reorder Test task A' })
    expect(handle.tabIndex).toBe(0)

    handle.focus()
    await key(handle, 'Space')
    expect(liveText()).toContain('Picked up "Test task A"')
    expect(liveText()).not.toMatch(/draggable item/)
    await key(document, 'ArrowDown')
    await key(document, 'Space')

    expect(invoke).toHaveBeenCalledWith('task:reorder', [6, 5, 7])
    expect(liveText()).toMatch(/Dropped "Test task A" at position 2 of 3/)
  })

  it('Escape cancels the move and saves nothing', async () => {
    render(<MemoryRouter><TasksView /></MemoryRouter>)
    await screen.findByText('Test task A')
    const handle = screen.getByRole('button', { name: 'Reorder Test task A' })
    handle.focus()
    await key(handle, 'Space')
    await key(document, 'ArrowDown')
    await key(document, 'Escape')
    expect(invoke).not.toHaveBeenCalledWith('task:reorder', expect.anything())
    expect(liveText()).toContain('Stopped moving "Test task A"')
  })

  it('a keyboard move that fails to save is put back, like a mouse drag', async () => {
    failing = 'task:reorder'
    render(<MemoryRouter><TasksView /></MemoryRouter>)
    await screen.findByText('Test task A')
    await moveDownOne(screen.getByRole('button', { name: 'Reorder Test task A' }))
    expect(invoke).toHaveBeenCalledWith('task:reorder', [6, 5, 7])
    expect(useTaskStore.getState().tasks.map(t => t.id)).toEqual([5, 6, 7])
  })

  it('moves a checklist item down one place and saves the new order', async () => {
    render(<Checklist rowId={10} clientName="Test Person" />)
    await screen.findByText('Test item A')
    const handle = screen.getByRole('button', { name: 'Reorder Test item A' })
    expect(handle.tabIndex).toBe(0)
    await moveDownOne(handle)
    expect(invoke).toHaveBeenCalledWith('checklist:reorder', 10, [2, 1, 3])
  })
})
