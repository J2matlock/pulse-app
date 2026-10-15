// @vitest-environment jsdom
/**
 * Bug sweep S2: the record page's checklist group undo/redo kept stale ids.
 * Redo makes a group (or template items) again under new ids, so the next
 * undo has to remove those, not the ones from the first time.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import React from 'react'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke: mockInvoke }, writable: true })

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))

interface Entry { undo: () => Promise<void>; redo: () => Promise<void> }
const pushed: Entry[] = []
vi.mock('../../../../src/renderer/stores/undoStore', () => ({
  useUndoStore: Object.assign(() => ({}), {
    getState: () => ({ push: (e: Entry) => pushed.push(e), pushWithToast: (e: Entry) => pushed.push(e) }),
  }),
}))

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
  closestCenter: vi.fn(), PointerSensor: vi.fn(), KeyboardSensor: vi.fn(), useSensor: () => ({}), useSensors: () => [],
}))
vi.mock('@dnd-kit/sortable', () => ({
  sortableKeyboardCoordinates: vi.fn(),
  SortableContext: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
  verticalListSortingStrategy: {},
  arrayMove: (arr: unknown[]) => arr,
  useSortable: () => ({ attributes: {}, listeners: {}, setNodeRef: () => {}, transform: null, transition: null, isDragging: false }),
}))
vi.mock('@dnd-kit/utilities', () => ({ CSS: { Transform: { toString: () => '' } } }))
vi.mock('../../../../src/renderer/components/shared/ConfirmDialog', () => ({
  ConfirmDialog: ({ open, onConfirm }: { open: boolean; onConfirm: () => void }) =>
    open ? React.createElement('button', { onClick: onConfirm }, 'Confirm') : null,
}))
vi.mock('../../../../src/renderer/components/shared/GroupPicker', () => ({
  GroupPicker: ({ onCreateAndSelect }: { onCreateAndSelect: (name: string) => void }) =>
    React.createElement('button', { onClick: () => onCreateAndSelect('Intake') }, 'Make group'),
}))
vi.mock('../../../../src/renderer/hooks/useFocusTrap', () => ({ useFocusTrap: () => ({ current: null }) }))

import { Checklist } from '../../../../src/renderer/components/profile/Checklist'
import { setWords } from '../../vocabFixture'

let nextGroupId = 100
let nextItemId = 500
let groups: Array<{ id: number; row_id: number; name: string; position: number; is_collapsed: number }> = []

function calls(channel: string): unknown[][] {
  return mockInvoke.mock.calls.filter(c => c[0] === channel).map(c => c.slice(1))
}

beforeEach(() => {
  setWords()
  vi.clearAllMocks()
  pushed.length = 0
  nextGroupId = 100
  nextItemId = 500
  groups = []
  mockInvoke.mockImplementation((channel: string, ...args: unknown[]) => {
    if (channel === 'checklist:get') return Promise.resolve({ ok: true, data: [] })
    if (channel === 'checklist:group-get-all') return Promise.resolve({ ok: true, data: groups })
    if (channel === 'cl-template:get-all') return Promise.resolve({ ok: true, data: [{ id: 7, name: 'Intake steps', description: null, items: '[{"title":"Call"}]', is_recurring: 0, recurrence_days: null, is_system: 0, created_at: '' }] })
    if (channel === 'checklist:group-create') return Promise.resolve({ ok: true, data: { id: nextGroupId++, row_id: 10, name: args[1], position: 0, is_collapsed: 0 } })
    if (channel === 'checklist:apply-template') return Promise.resolve({ ok: true, data: { createdIds: [nextItemId++, nextItemId++] } })
    return Promise.resolve({ ok: true, data: null })
  })
})

describe('checklist group undo and redo track the current ids', () => {
  it('add group → undo → redo → undo deletes the group redo made', async () => {
    render(<Checklist rowId={10} clientName="Test Client" />)
    await waitFor(() => expect(screen.getByLabelText('More checklist actions')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('More checklist actions'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add a heading' }))
    await waitFor(() => expect(pushed).toHaveLength(1))
    await act(async () => { await pushed[0]?.undo() })
    await act(async () => { await pushed[0]?.redo() })
    await act(async () => { await pushed[0]?.undo() })
    expect(calls('checklist:group-delete')).toEqual([[100], [101]])
  })

  it('delete group → undo → redo deletes the group undo brought back', async () => {
    groups = [{ id: 5, row_id: 10, name: 'Housing', position: 0, is_collapsed: 0 }]
    render(<Checklist rowId={10} clientName="Test Client" />)
    await waitFor(() => expect(screen.getByLabelText('Delete heading Housing')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('Delete heading Housing'))
    fireEvent.click(screen.getByText('Confirm'))
    await waitFor(() => expect(pushed).toHaveLength(1))
    await act(async () => { await pushed[0]?.undo() })
    await act(async () => { await pushed[0]?.redo() })
    expect(calls('checklist:group-delete')).toEqual([[5], [100]])
  })

  it('a new heading asks for its name: empty box with a placeholder; leaving it blank keeps "New heading" (C-19)', async () => {
    render(<Checklist rowId={10} clientName="Test Client" />)
    await waitFor(() => expect(screen.getByLabelText('More checklist actions')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('More checklist actions'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add a heading' }))
    const box = await screen.findByRole('textbox', { name: 'Heading name' }) as HTMLInputElement
    expect(box.value).toBe('')
    expect(box.placeholder).toBe('Name, e.g. Paperwork')
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(await screen.findByText('New heading')).toBeTruthy()
    expect(calls('checklist:group-update')).toEqual([])
    expect(screen.getByLabelText('Rename heading')).toBeTruthy()
    expect(screen.getByLabelText('Delete heading New heading')).toBeTruthy()
  })

  it('typing a new heading\'s name saves it (C-19)', async () => {
    render(<Checklist rowId={10} clientName="Test Client" />)
    await waitFor(() => expect(screen.getByLabelText('More checklist actions')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('More checklist actions'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add a heading' }))
    const box = await screen.findByRole('textbox', { name: 'Heading name' })
    fireEvent.change(box, { target: { value: 'Paperwork' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(calls('checklist:group-update')).toEqual([[100, { name: 'Paperwork' }]]))
  })

  it('apply a template into a new group → undo → redo → undo removes what redo made', async () => {
    render(<Checklist rowId={10} clientName="Test Client" />)
    await waitFor(() => expect(screen.getByLabelText('More checklist actions')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('More checklist actions'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Templates…' }))
    await waitFor(() => expect(screen.getByText('Apply')).toBeTruthy())
    fireEvent.click(screen.getByText('Apply'))
    fireEvent.click(await screen.findByText('Make group'))
    await waitFor(() => expect(pushed).toHaveLength(1))
    await act(async () => { await pushed[0]?.undo() })
    await act(async () => { await pushed[0]?.redo() })
    // Redo makes the group again and applies into it, not into the deleted one
    expect(calls('checklist:apply-template')).toEqual([[10, 7, 100], [10, 7, 101]])
    await act(async () => { await pushed[0]?.undo() })
    expect(calls('checklist:delete-item').map(c => c[0])).toEqual([500, 501, 502, 503])
    expect(calls('checklist:group-delete')).toEqual([[100], [101]])
  })
})
