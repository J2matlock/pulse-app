// @vitest-environment jsdom
/** UX pass Q0 (d): the shared group header still says "group" on the Tasks page and keeps a new group's name */
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { render, screen } from '@testing-library/react'

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)
vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({ attributes: {}, listeners: {}, setNodeRef: vi.fn(), transform: null, transition: null, isDragging: false }),
}))
vi.mock('@dnd-kit/utilities', () => ({ CSS: { Transform: { toString: () => '' } } }))

import { ChecklistGroupHeader as GroupHeader } from '../../../../src/renderer/components/shared/GroupHeader'

const base = {
  group: { id: 1, name: 'Paperwork', position: 0 }, totalItems: 2, completedItems: 1, isCollapsed: false,
  onToggleCollapse: vi.fn(), onRename: vi.fn(), onDelete: vi.fn(), isDragDisabled: false,
}

describe('GroupHeader words', () => {
  it('says "group" when no noun is given (the Tasks page)', () => {
    render(<GroupHeader {...base} />)
    expect(screen.getByLabelText('Rename group')).toBeTruthy()
    expect(screen.getByLabelText('Delete group Paperwork')).toBeTruthy()
    expect(screen.getByLabelText('Reorder group Paperwork')).toBeTruthy()
  })

  it('a just-made group without a placeholder opens with its name in the box, as before', () => {
    render(<GroupHeader {...base} autoEdit />)
    expect((screen.getByRole('textbox', { name: 'Group name' }) as HTMLInputElement).value).toBe('Paperwork')
  })

  it('the progress count is 15 px (text-sm), not 14', () => {
    render(<GroupHeader {...base} />)
    expect(screen.getByText('1/2').className).toContain('text-sm')
  })
})
