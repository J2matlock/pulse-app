// @vitest-environment jsdom
/**
 * Task group undo and redo follow the group's current id: redo makes a new
 * group, so the next undo must delete that one, not the first.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

let nextGroupId = 10
const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
  if (channel === 'task:group-create') return { ok: true, data: { id: nextGroupId++, name: args[0], position: 0, is_collapsed: 0, created_at: '' } }
  if (channel === 'task:group-delete') return { ok: true, data: true }
  return { ok: true, data: [] }
})
Object.defineProperty(window, 'api', { value: { invoke, on: vi.fn().mockReturnValue(vi.fn()), copyToClipboard: vi.fn() }, writable: true })

vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
vi.mock('lucide-react', async () => (await import('../lucideMock')).lucideMock)
vi.mock('../../../src/renderer/views/tasks/TaskFormDialog', () => ({ TaskFormDialog: () => null }))
vi.mock('../../../src/renderer/components/profile/Checklist', () => ({ TemplateManager: () => null, Checklist: () => null }))
vi.mock('../../../src/renderer/components/profile/ScratchPad', () => ({ ScratchPad: () => null }))

import TasksView from '../../../src/renderer/views/TasksView'
import { useUndoStore } from '../../../src/renderer/stores/undoStore'
import { useTaskStore } from '../../../src/renderer/stores/taskStore'

beforeEach(() => {
  nextGroupId = 10
  invoke.mockClear()
  useTaskStore.setState({ tasks: [] })
  useUndoStore.setState({ undoStack: [], redoStack: [], toast: null, isUndoing: false })
})

const deletes = () => invoke.mock.calls.filter(c => c[0] === 'task:group-delete').map(c => c[1])

describe('Task group undo and redo', () => {
  it('undo after redo deletes the group redo made', async () => {
    render(<MemoryRouter><TasksView /></MemoryRouter>)
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    await act(async () => { fireEvent.click(screen.getByTitle('Add a group to organize tasks')) })
    expect(useUndoStore.getState().undoStack.at(-1)?.description).toBe('Added task group')

    await act(async () => { await useUndoStore.getState().undo() })
    await act(async () => { await useUndoStore.getState().redo() })
    await act(async () => { await useUndoStore.getState().undo() })
    expect(deletes()).toEqual([10, 11])
  })

  it('deleting a group acts at once, with the Undo toast, no question (Q4)', async () => {
    render(<MemoryRouter><TasksView /></MemoryRouter>)
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    await act(async () => { fireEvent.click(screen.getByTitle('Add a group to organize tasks')) })
    const del = await screen.findByLabelText(/^Delete group/)
    await act(async () => { fireEvent.click(del) })
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(deletes()).toEqual([10])
    expect(useUndoStore.getState().toast?.description).toMatch(/^Deleted group "/)
  })
})
