// @vitest-environment jsdom
/** Bug sweep S2: the checklist item's date editor (Clear button, no-op saves) */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import type { ChecklistItem as Item } from '../../../../src/shared/types'

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)
vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({ attributes: {}, listeners: {}, setNodeRef: vi.fn(), transform: null, transition: null, isDragging: false }),
}))
vi.mock('@dnd-kit/utilities', () => ({ CSS: { Transform: { toString: () => '' } } }))

import { ChecklistItem } from '../../../../src/renderer/components/profile/ChecklistItem'

const item: Item = {
  id: 1, row_id: 10, title: 'Home visit', description: null, is_completed: 0, due_date: '2027-06-15',
  completed_at: null, completed_by: null, position: 0, category: null, priority: 'normal', is_archived: 0,
  created_at: '2026-03-01T00:00:00', template_source_id: null, recurrence_rule: null, group_id: null,
}
const props = { isDragDisabled: false, onToggle: vi.fn(), onUpdate: vi.fn(), onDelete: vi.fn() }

describe('checklist item date editor', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('the Clear date button can be clicked: the date box losing focus to it keeps the editor open', () => {
    render(<ChecklistItem item={item} {...props} />)
    fireEvent.click(screen.getByText(/Jun/))
    const input = document.querySelector('input[type="date"]') as HTMLInputElement
    const clear = screen.getByLabelText('Clear date')
    expect(fireEvent.mouseDown(clear)).toBe(false)
    fireEvent.blur(input, { relatedTarget: clear })
    fireEvent.click(screen.getByLabelText('Clear date'))
    expect(props.onUpdate).toHaveBeenCalledWith({ due_date: null })
  })

  it('opening the date box and leaving without a change saves nothing', () => {
    render(<ChecklistItem item={item} {...props} />)
    fireEvent.click(screen.getByText(/Jun/))
    fireEvent.blur(document.querySelector('input[type="date"]') as HTMLInputElement)
    expect(props.onUpdate).not.toHaveBeenCalled()
  })
})
