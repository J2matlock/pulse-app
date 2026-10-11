// @vitest-environment jsdom
/** A08-5: checklist edits, deletes and reorders that didn't save are put back, the user is told, and no undo is offered. */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import React from 'react'

const mockInvoke = vi.fn()

Object.defineProperty(window, 'api', {
  value: { invoke: mockInvoke },
  writable: true,
})

// Mock lucide-react
vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)

const toastError = vi.hoisted(() => vi.fn())
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: toastError, success: vi.fn() }) }))

// Mock undoStore
const undoPush = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/renderer/stores/undoStore', () => ({
  useUndoStore: Object.assign(() => ({}), {
    getState: () => ({ push: undoPush, pushWithToast: undoPush }),
  }),
}))

// Mock dnd-kit
// The checklist's drop handler, so a test can drop one item on another
const dnd = vi.hoisted(() => ({ onDragEnd: null as null | ((e: unknown) => Promise<void> | void) }))
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children, onDragEnd }: { children: React.ReactNode; onDragEnd: (e: unknown) => void }) => {
    dnd.onDragEnd = onDragEnd
    return React.createElement('div', null, children)
  },
  closestCenter: vi.fn(),
  PointerSensor: vi.fn(),
  useSensor: () => ({}),
  useSensors: () => [],
}))

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
  verticalListSortingStrategy: {},
  arrayMove: (arr: unknown[], from: number, to: number) => {
    const result = [...arr]
    const [removed] = result.splice(from, 1)
    result.splice(to, 0, removed)
    return result
  },
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    transform: null,
    transition: null,
    isDragging: false,
  }),
}))

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => '' } },
}))

// Mock ConfirmDialog
vi.mock('../../../../src/renderer/components/shared/ConfirmDialog', () => ({
  ConfirmDialog: ({ open, title, onConfirm, onCancel }: { open: boolean; title: string; onConfirm: () => void; onCancel: () => void }) =>
    open ? React.createElement('div', { 'data-testid': `confirm-${title}` },
      React.createElement('span', null, title),
      React.createElement('button', { onClick: onConfirm }, 'Confirm'),
      React.createElement('button', { onClick: onCancel }, 'Cancel'),
    ) : null,
}))

// Mock useFocusTrap
vi.mock('../../../../src/renderer/hooks/useFocusTrap', () => ({
  useFocusTrap: () => ({ current: null }),
}))

import { Checklist } from '../../../../src/renderer/components/profile/Checklist'
import type { ChecklistItem } from '../../../../src/shared/types'
import { setWords } from '../../vocabFixture'

function makeItem(overrides: Partial<ChecklistItem> = {}): ChecklistItem {
  return {
    id: 1,
    row_id: 10,
    title: 'Follow up with housing',
    description: null,
    is_completed: 0,
    due_date: null,
    completed_at: null,
    completed_by: null,
    position: 0,
    category: null,
    priority: 'normal',
    is_archived: 0,
    created_at: new Date().toISOString(),
    template_source_id: null,
    recurrence_rule: null,
    group_id: null,
    ...overrides,
  }
}

beforeEach(() => { setWords(); toastError.mockClear(); undoPush.mockClear(); mockInvoke.mockReset() })

function serve(items: ChecklistItem[], failing: string) {
  mockInvoke.mockImplementation((channel: string) => {
    if (channel === 'checklist:get') return Promise.resolve({ ok: true, data: items })
    if (channel === failing) return Promise.resolve({ ok: false, error: 'Invalid ID' })
    return Promise.resolve({ ok: true, data: [] })
  })
}

describe('Checklist write failures', () => {
  it('puts a deleted item back and says so when the delete failed', async () => {
    serve([makeItem({ id: 1, title: 'Call landlord' })], 'checklist:delete-item')
    render(<Checklist rowId={10} clientName="Test Client" />)
    const del = await screen.findByRole('button', { name: 'Delete item' })
    await act(async () => { fireEvent.click(del) })
    expect(screen.getByText('Call landlord')).toBeTruthy()
    expect(toastError).toHaveBeenCalledWith("We couldn't delete that item — try again")
    expect(undoPush).not.toHaveBeenCalled()
  })

  it('offers undo when the delete worked', async () => {
    serve([makeItem({ id: 1, title: 'Call landlord' })], 'none')
    render(<Checklist rowId={10} clientName="Test Client" />)
    const del = await screen.findByRole('button', { name: 'Delete item' })
    await act(async () => { fireEvent.click(del) })
    expect(screen.queryByText('Call landlord')).toBeNull()
    expect(undoPush).toHaveBeenCalledTimes(1)
  })

  it('puts the old title back when renaming an item failed', async () => {
    serve([makeItem({ id: 1, title: 'Call landlord' })], 'checklist:update-item')
    render(<Checklist rowId={10} clientName="Test Client" />)
    fireEvent.click(await screen.findByText('Call landlord'))
    const input = screen.getByDisplayValue('Call landlord')
    fireEvent.change(input, { target: { value: 'Call the office' } })
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
    expect(screen.getByText('Call landlord')).toBeTruthy()
    expect(screen.queryByText('Call the office')).toBeNull()
    expect(toastError).toHaveBeenCalledWith("We couldn't save your change to that item — try again")
    expect(undoPush).not.toHaveBeenCalled()
  })

  it('reloads the saved order and offers no undo when a reorder failed', async () => {
    serve([makeItem({ id: 1, title: 'First', position: 0 }), makeItem({ id: 2, title: 'Second', position: 1 })], 'checklist:reorder')
    render(<Checklist rowId={10} clientName="Test Client" />)
    await screen.findByText('First')
    const loadsBefore = mockInvoke.mock.calls.filter(c => c[0] === 'checklist:get').length
    await act(async () => { await dnd.onDragEnd?.({ active: { id: 2 }, over: { id: 1 } }) })
    expect(toastError).toHaveBeenCalledWith("We couldn't save the new order — try again")
    expect(undoPush).not.toHaveBeenCalled()
    expect(mockInvoke.mock.calls.filter(c => c[0] === 'checklist:get').length).toBeGreaterThan(loadsBefore)
  })
})
