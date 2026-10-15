// @vitest-environment jsdom
/** UX pass Q0 (a): Edit and Delete show their words by the checklist column's width, not the window's */
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { render, screen } from '@testing-library/react'
import type { ChecklistItem as Item } from '../../../../src/shared/types'

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)
vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({ attributes: {}, listeners: {}, setNodeRef: vi.fn(), transform: null, transition: null, isDragging: false }),
}))
vi.mock('@dnd-kit/utilities', () => ({ CSS: { Transform: { toString: () => '' } } }))

import { ChecklistItem, CompletedChecklistItem } from '../../../../src/renderer/components/profile/ChecklistItem'

const item: Item = {
  id: 1, row_id: 10, title: 'Home visit', description: null, is_completed: 0, due_date: '2027-06-15',
  completed_at: null, completed_by: null, position: 0, category: null, priority: 'normal', is_archived: 0,
  created_at: '2026-03-01T00:00:00', template_source_id: null, recurrence_rule: null, group_id: null,
}
const props = { isDragDisabled: false, onToggle: vi.fn(), onUpdate: vi.fn(), onDelete: vi.fn() }

describe('checklist item Edit and Delete words', () => {
  it('the words use a container query, and the content box is the container', () => {
    render(<ChecklistItem item={item} {...props} />)
    for (const [label, word] of [['Edit item', 'Edit'], ['Delete item', 'Delete']] as const) {
      const button = screen.getByRole('button', { name: label })
      const span = Array.from(button.querySelectorAll('span')).find(s => s.textContent === word)
      expect(span?.className).toMatch(/(^|\s)@min-\[[\d.]+rem\]:inline(\s|$)/)
      expect(span?.className).not.toMatch(/min-\[700px\]/)
      expect(button.className).toContain('hit-44')
      expect(button.closest('.\\@container')).not.toBeNull()
    }
  })

  it('an unset priority leaves the row in a narrow column; a set one always shows', () => {
    const { unmount } = render(<ChecklistItem item={item} {...props} />)
    const unset = screen.getByTitle('Set priority').parentElement as HTMLElement
    expect(unset.className).toMatch(/(^|\s)hidden(\s|$)/)
    expect(unset.className).toMatch(/@min-\[[\d.]+rem\]:block/)
    unmount()
    render(<ChecklistItem item={{ ...item, priority: 'high' }} {...props} />)
    expect((screen.getByTitle('Set priority').parentElement as HTMLElement).className).not.toMatch(/(^|\s)hidden(\s|$)/)
  })

  it('a done item\'s Delete button has a 44 px click area', () => {
    render(<CompletedChecklistItem item={{ ...item, is_completed: 1 }} onUncheck={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Delete item' }).className).toContain('hit-44')
  })
})
