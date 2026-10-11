// @vitest-environment jsdom
/** 1.30: a checklist tick that didn't save is put back, and the user is told. */
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

beforeEach(() => { setWords(); toastError.mockClear() })

describe('Checklist tick failures', () => {
  it('unticks the item again and says so when saving the tick failed', async () => {
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'checklist:get') return Promise.resolve({ ok: true, data: [makeItem({ id: 1, title: 'Call landlord' })] })
      if (channel === 'checklist:update-item') return Promise.resolve({ ok: false, error: 'READ_ONLY' })
      return Promise.resolve({ ok: true, data: [] })
    })
    render(<Checklist rowId={10} clientName="Test Client" />)
    const box = await screen.findByRole('checkbox', { name: 'Mark complete' })
    await act(async () => { fireEvent.click(box) })
    expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/couldn't tick off "Call landlord"/))
    expect(screen.getByRole('checkbox', { name: 'Mark complete' })).toBeTruthy()
  })
})
