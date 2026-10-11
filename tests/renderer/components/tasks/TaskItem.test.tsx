// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import type { CaseloadTask } from '../../../../src/shared/types'

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)

vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({
    attributes: {}, listeners: {}, setNodeRef: vi.fn(),
    transform: null, transition: null, isDragging: false,
  }),
}))

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => '' } },
}))

vi.mock('../../../../src/renderer/utils/relativeTime', () => ({
  relativeTime: () => '2 hours ago',
}))

vi.mock('../../../../src/shared/constants', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('../../../../src/shared/constants')),
  MS_PER_DAY: 86_400_000,
}))

import { TaskItem } from '../../../../src/renderer/components/tasks/TaskItem'
import { localDateString } from '../../../../src/shared/dates'

function makeTask(overrides: Partial<CaseloadTask> = {}): CaseloadTask {
  return {
    id: 1,
    grid_id: 1,
    title: 'Follow up with John',
    description: null,
    priority: 'normal',
    category: null,
    due_date: null,
    recurrence_rule: null,
    is_completed: 0,
    completed_at: null,
    snoozed_until: null,
    position: 0,
    created_at: '2026-03-01T00:00:00',
    updated_at: '2026-03-01T00:00:00',
    ...overrides,
  }
}

const baseProps = {
  isDragDisabled: false,
  onToggle: vi.fn(),
  onUpdate: vi.fn(),
  onDelete: vi.fn(),
  onEdit: vi.fn(),
  onSnooze: vi.fn(),
}

describe('TaskItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders task title', () => {
    render(<TaskItem task={makeTask()} {...baseProps} />)
    expect(screen.getByText('Follow up with John')).toBeDefined()
  })

  it('renders due date when set', () => {
    // Use a date far in the future to get the default styling
    const task = makeTask({ due_date: '2027-06-15' })
    render(<TaskItem task={task} {...baseProps} />)
    expect(screen.getByText(/Jun/)).toBeDefined()
  })

  it('calls onToggle when checkbox is clicked', () => {
    render(<TaskItem task={makeTask()} {...baseProps} />)
    const checkbox = screen.getByLabelText('Mark complete')
    fireEvent.click(checkbox)
    expect(baseProps.onToggle).toHaveBeenCalledTimes(1)
  })

  it('shows urgent priority badge', () => {
    const task = makeTask({ priority: 'urgent' })
    render(<TaskItem task={task} {...baseProps} />)
    expect(screen.getByText('Urgent')).toBeDefined()
  })

  it('shows high priority badge', () => {
    const task = makeTask({ priority: 'high' })
    render(<TaskItem task={task} {...baseProps} />)
    expect(screen.getByText('High')).toBeDefined()
  })

  it('applies overdue border styling', () => {
    // Set a date in the past
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const task = makeTask({ due_date: localDateString(yesterday) })
    const { container } = render(<TaskItem task={task} {...baseProps} />)
    const wrapper = container.firstElementChild as HTMLElement
    expect(wrapper.className).toContain('border-l-red-400')
  })

  it('shows description when present', () => {
    const task = makeTask({ description: 'Call about housing referral' })
    render(<TaskItem task={task} {...baseProps} />)
    expect(screen.getByText('Call about housing referral')).toBeDefined()
  })

  it('shows the snooze date in words, not the stored date', () => {
    render(<TaskItem task={makeTask({ snoozed_until: '2099-10-14' })} {...baseProps} />)
    expect(screen.getByText(/Snoozed until Wed, Oct 14 ×/)).toBeDefined()
  })

  it('shows its row actions when tabbed to, not only on hover', () => {
    render(<TaskItem task={makeTask()} {...baseProps} />)
    const edit = screen.getByTitle('Edit (full dialog)')
    expect(edit.closest('div')!.className).toContain('group-focus-within:opacity-100')
  })

  it('the Clear date button stays put when the date box loses focus to it (bug sweep S2)', () => {
    render(<TaskItem task={makeTask({ due_date: '2027-06-15' })} {...baseProps} />)
    fireEvent.click(screen.getByText(/Jun/))
    const input = document.querySelector('input[type="date"]') as HTMLInputElement
    const clear = screen.getByLabelText('Clear date')
    // A mouse press on it doesn't take focus from the date box
    expect(fireEvent.mouseDown(clear)).toBe(false)
    // Tabbing to it doesn't close the editor
    fireEvent.blur(input, { relatedTarget: clear })
    expect(screen.getByLabelText('Clear date')).toBeDefined()
    fireEvent.click(screen.getByLabelText('Clear date'))
    expect(baseProps.onUpdate).toHaveBeenCalledWith({ due_date: null })
  })

  it('opening the date box and leaving without a change saves nothing (bug sweep S2)', () => {
    render(<TaskItem task={makeTask({ due_date: '2027-06-15' })} {...baseProps} />)
    fireEvent.click(screen.getByText(/Jun/))
    fireEvent.blur(document.querySelector('input[type="date"]') as HTMLInputElement)
    expect(baseProps.onUpdate).not.toHaveBeenCalled()
    expect(document.querySelector('input[type="date"]')).toBeNull()
  })

  it('a monthly task that remembers its day still shows Monthly as chosen', () => {
    render(<TaskItem task={makeTask({ due_date: '2027-02-28', recurrence_rule: '{"type":"monthly","interval":1,"day":31}' })} {...baseProps} />)
    fireEvent.click(screen.getByTitle('Change recurrence'))
    expect(screen.getByText('Monthly').className).toContain('font-semibold')
  })
})
