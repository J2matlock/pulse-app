// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

const mockInvoke = vi.fn()

Object.defineProperty(window, 'api', {
  value: { invoke: mockInvoke },
  writable: true,
})

// Mock lucide-react
vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)

// Mock react-hot-toast
vi.mock('react-hot-toast', () => {
  const fn = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() })
  return { default: fn }
})

// Mock undoStore
vi.mock('../../../../src/renderer/stores/undoStore', () => ({
  useUndoStore: Object.assign(() => ({}), {
    getState: () => ({ push: vi.fn(), pushWithToast: vi.fn() }),
  }),
}))

// Mock dnd-kit
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
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

beforeEach(() => { setWords() })

describe('Checklist', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'checklist:get') return Promise.resolve({ ok: true, data: [] })
      if (channel === 'checklist:group-get-all') return Promise.resolve({ ok: true, data: [] })
      if (channel === 'checklist:template:get-all') return Promise.resolve({ ok: true, data: [] })
      return Promise.resolve({ ok: true, data: null })
    })
  })

  it('renders the Checklist header', async () => {
    render(<Checklist rowId={10} clientName="Test Client" />)
    expect(screen.getByText('Checklist')).toBeTruthy()
  })

  it('shows empty state when no items', async () => {
    render(<Checklist rowId={10} clientName="Test Client" />)
    await waitFor(() => {
      expect(screen.getByText(/No checklist items yet/)).toBeTruthy()
    })
  })

  it('renders checklist items', async () => {
    const items = [
      makeItem({ id: 1, title: 'Task A', position: 0 }),
      makeItem({ id: 2, title: 'Task B', position: 1 }),
    ]
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'checklist:get') return Promise.resolve({ ok: true, data: items })
      if (channel === 'checklist:group-get-all') return Promise.resolve({ ok: true, data: [] })
      return Promise.resolve({ ok: true, data: [] })
    })

    render(<Checklist rowId={10} clientName="Test Client" />)
    await waitFor(() => {
      expect(screen.getByText('Task A')).toBeTruthy()
      expect(screen.getByText('Task B')).toBeTruthy()
    })
  })

  it('a repeating item ticked off stays on the list with its next date (audit 1.26)', async () => {
    const items = [makeItem({ id: 1, title: 'Monthly safety check', due_date: '2026-10-10', recurrence_rule: JSON.stringify({ type: 'monthly', interval: 1 }) })]
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'checklist:get') return Promise.resolve({ ok: true, data: items })
      if (channel === 'checklist:group-get-all') return Promise.resolve({ ok: true, data: [] })
      if (channel === 'checklist:update-item') return Promise.resolve({ ok: true, data: { sysLogId: 5, repeat: { previousDue: '2026-10-10', nextDue: '2026-11-10' } } })
      return Promise.resolve({ ok: true, data: [] })
    })
    render(<Checklist rowId={10} clientName="Test Client" />)
    await waitFor(() => expect(screen.getByText('Every month')).toBeTruthy())
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mark complete' }))
    await waitFor(() => expect(screen.getByText(/Nov 10/)).toBeTruthy())
    expect(screen.getByRole('checkbox', { name: 'Mark complete' })).toBeTruthy()
  })

  it('a tick that fails to save is put back (audit L-28)', async () => {
    const items = [makeItem({ id: 1, title: 'Call landlord' })]
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'checklist:get') return Promise.resolve({ ok: true, data: items })
      if (channel === 'checklist:group-get-all') return Promise.resolve({ ok: true, data: [] })
      if (channel === 'checklist:update-item') return Promise.resolve({ ok: false, error: 'Database is locked' })
      return Promise.resolve({ ok: true, data: [] })
    })
    render(<Checklist rowId={10} clientName="Test Client" />)
    await waitFor(() => expect(screen.getByText('Call landlord')).toBeTruthy())
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mark complete' }))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Mark complete' })).toBeTruthy())
    await new Promise(r => setTimeout(r, 500))
    expect(screen.getByRole('checkbox', { name: 'Mark complete' })).toBeTruthy()
  })

  it('shows progress indicator with count', async () => {
    const items = [
      makeItem({ id: 1, title: 'Done', is_completed: 1, completed_at: new Date().toISOString(), position: 0 }),
      makeItem({ id: 2, title: 'Not done', is_completed: 0, position: 1 }),
      makeItem({ id: 3, title: 'Also not done', is_completed: 0, position: 2 }),
    ]
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'checklist:get') return Promise.resolve({ ok: true, data: items })
      if (channel === 'checklist:group-get-all') return Promise.resolve({ ok: true, data: [] })
      return Promise.resolve({ ok: true, data: [] })
    })

    render(<Checklist rowId={10} clientName="Test Client" />)
    await waitFor(() => {
      // Shows "1/3" in header and "1 of 3 completed" in progress
      expect(screen.getByText('1/3')).toBeTruthy()
      expect(screen.getByText(/1 of 3 completed/)).toBeTruthy()
    })
  })

  it('add item input is rendered with placeholder', async () => {
    render(<Checklist rowId={10} clientName="Test Client" />)
    await waitFor(() => {
      expect(screen.getByPlaceholderText('+ Add a checklist item… (press Enter)')).toBeTruthy()
    })
  })

  it('handles Enter key to add new item', async () => {
    const newItem = makeItem({ id: 99, title: 'New task' })
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'checklist:get') return Promise.resolve({ ok: true, data: [] })
      if (channel === 'checklist:group-get-all') return Promise.resolve({ ok: true, data: [] })
      if (channel === 'checklist:create-item') return Promise.resolve({ ok: true, data: newItem })
      return Promise.resolve({ ok: true, data: [] })
    })

    render(<Checklist rowId={10} clientName="Test Client" />)
    await waitFor(() => {
      expect(screen.getByPlaceholderText('+ Add a checklist item… (press Enter)')).toBeTruthy()
    })

    const input = screen.getByPlaceholderText('+ Add a checklist item… (press Enter)')
    fireEvent.change(input, { target: { value: 'New task' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('checklist:create-item', 10, 'New task', undefined)
    })
  })

  it('shows completed section with expand toggle', async () => {
    const items = [
      makeItem({ id: 1, title: 'Active task', is_completed: 0, position: 0 }),
      makeItem({ id: 2, title: 'Done task', is_completed: 1, completed_at: '2026-01-01T00:00:00Z', position: 1 }),
    ]
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'checklist:get') return Promise.resolve({ ok: true, data: items })
      if (channel === 'checklist:group-get-all') return Promise.resolve({ ok: true, data: [] })
      return Promise.resolve({ ok: true, data: [] })
    })

    render(<Checklist rowId={10} clientName="Test Client" />)
    await waitFor(() => {
      expect(screen.getByText('Completed (1)')).toBeTruthy()
    })
  })
})
