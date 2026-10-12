// @vitest-environment jsdom
/**
 * Escape closes these dialogs from any control inside them (Q-100, A29-06), and
 * they announce themselves as modal dialogs named by their title (Q-101, A29-07).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ChecklistItem as Item } from '../../../src/shared/types'

vi.mock('lucide-react', async () => (await import('../lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({ attributes: {}, listeners: {}, setNodeRef: vi.fn(), transform: null, transition: null, isDragging: false }),
}))
vi.mock('@dnd-kit/utilities', () => ({ CSS: { Transform: { toString: () => '' } } }))
const invoke = vi.fn(async () => ({ ok: true, data: [] }))
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })

import SnippetsView from '../../../src/renderer/views/SnippetsView'
import { ChecklistItem } from '../../../src/renderer/components/profile/ChecklistItem'
import { ApplyTemplateDialog } from '../../../src/renderer/views/template-manager/ApplyTemplateDialog'
import { setWords } from '../vocabFixture'

const item: Item = {
  id: 1, row_id: 10, title: 'Home visit', description: null, is_completed: 0, due_date: null,
  completed_at: null, completed_by: null, position: 0, category: null, priority: 'normal', is_archived: 0,
  created_at: '2026-03-01T00:00:00', template_source_id: null, recurrence_rule: null, group_id: null,
}

beforeEach(() => { setWords(); invoke.mockClear() })

describe('Escape closes the dialog from any control', () => {
  it('snippet editor', async () => {
    render(<SnippetsView />)
    fireEvent.click(await screen.findByRole('button', { name: 'Create a new snippet' }))
    const dialog = await screen.findByRole('dialog', { name: 'New Snippet' })
    const button = dialog.querySelector<HTMLElement>('button')!
    button.focus()
    fireEvent.keyDown(button, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('edit checklist item: from the Priority select, not only from a text box', () => {
    const { unmount } = render(<ChecklistItem item={item} isDragDisabled={false} onToggle={vi.fn()} onUpdate={vi.fn()} onDelete={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Edit item'))
    const dialog = screen.getByRole('dialog', { name: 'Edit checklist item' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    const priority = screen.getByLabelText('Priority')
    priority.focus()
    fireEvent.keyDown(priority, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    unmount()
  })
})

describe('named modal dialogs', () => {
  it('apply a list template', () => {
    render(<ApplyTemplateDialog template={{ id: 1, name: 'Intake', description: '', columns: [] } as never} grids={[]} onClose={vi.fn()} onApplied={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: 'Apply "Intake"' }).getAttribute('aria-modal')).toBe('true')
  })
})
