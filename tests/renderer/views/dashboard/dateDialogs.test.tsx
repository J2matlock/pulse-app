// @vitest-environment jsdom
/**
 * The dashboard's date dialogs and the checklist's on DateField (persona study
 * D1): a half-typed date keeps the main button off or is refused, and never
 * saves "no date" in place of the one being typed.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)
vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({ attributes: {}, listeners: {}, setNodeRef: vi.fn(), transform: null, transition: null, isDragging: false }),
}))
vi.mock('@dnd-kit/utilities', () => ({ CSS: { Transform: { toString: () => '' } } }))
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))

import toast from 'react-hot-toast'
import { DoneOnDayDialog } from '../../../../src/renderer/views/dashboard/DoneOnDayDialog'
import { ExtendDeadlineDialog } from '../../../../src/renderer/views/dashboard/ExtendDeadlineDialog'
import { OneOffDoneDialog } from '../../../../src/renderer/views/dashboard/OneOffDoneDialog'
import { MeterReadingDialog } from '../../../../src/renderer/views/dashboard/MeterReadingDialog'
import { ChecklistAddDialog } from '../../../../src/renderer/components/profile/ChecklistAddDialog'
import { ChecklistItem } from '../../../../src/renderer/components/profile/ChecklistItem'
import { DATE_FIELD_TEXT } from '../../../../src/renderer/components/ui/DateField'
import { localDateFromToday } from '../../../../src/shared/dates'
import type { ChecklistItem as Item } from '../../../../src/shared/types'
import { setWords } from '../../vocabFixture'

afterEach(() => { cleanup(); vi.clearAllMocks() })

/** Chromium: a half-typed or impossible date reads '' with validity.badInput set */
function typePartial(input: HTMLElement) {
  Object.defineProperty(input, 'validity', { configurable: true, get: () => ({ badInput: true }) })
  fireEvent.change(input, { target: { value: '' } })
}

function button(name: string): HTMLButtonElement {
  return within(screen.getByRole('dialog')).getByRole('button', { name }) as HTMLButtonElement
}

describe('Done on a day', () => {
  it('a partial date keeps Mark done off, and Enter on it saves nothing', () => {
    const onSave = vi.fn()
    render(<DoneOnDayDialog title="Mark Annual review done for Pat" onSave={onSave} onClose={vi.fn()} />)
    const box = screen.getByLabelText('Day it was done')
    expect(button('Mark done').disabled).toBe(false)
    typePartial(box)
    expect(button('Mark done').disabled).toBe(true)
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toBe(DATE_FIELD_TEXT.partial)
    // Only the whole-date message, not "Choose today or an earlier day" as well
    expect(screen.queryByText('Choose today or an earlier day.')).toBeNull()
  })

  it('a whole past date and Enter saves it', () => {
    const onSave = vi.fn()
    render(<DoneOnDayDialog title="Done" onSave={onSave} onClose={vi.fn()} />)
    const box = screen.getByLabelText('Day it was done')
    const day = localDateFromToday(-3)
    fireEvent.change(box, { target: { value: day } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onSave).toHaveBeenCalledWith(day)
  })
})

describe('Extend', () => {
  it('a partial date keeps Extend off even with a reason', () => {
    render(<ExtendDeadlineDialog title="Annual review" currentDue="2026-10-01" onSave={vi.fn()} onClose={vi.fn()} />)
    const box = screen.getByLabelText('New due date')
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Waiting on report' } })
    fireEvent.change(box, { target: { value: '2026-10-20' } })
    expect(button('Extend').disabled).toBe(false)
    typePartial(box)
    expect(button('Extend').disabled).toBe(true)
  })
})

describe('Done on a one-off date', () => {
  it('a partial new date keeps Mark done off', () => {
    const onSave = vi.fn()
    render(<OneOffDoneDialog title="Licence" currentDue="2026-10-01" onSave={onSave} onClose={vi.fn()} />)
    const box = screen.getByLabelText('New date')
    fireEvent.change(box, { target: { value: '0027-10-01' } })
    expect(button('Mark done').disabled).toBe(false)
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onSave).toHaveBeenCalledWith({ kind: 'renewed', newDate: '2027-10-01' })
    typePartial(box)
    expect(button('Mark done').disabled).toBe(true)
  })
})

describe('Meter reading', () => {
  it('a partial "day it was done" keeps Mark done off', () => {
    render(<MeterReadingDialog title="Oil change" info={null} onSave={vi.fn()} onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(/Current reading/), { target: { value: '1200' } })
    fireEvent.click(screen.getByText('Done on another day…'))
    expect(button('Mark done').disabled).toBe(false)
    typePartial(screen.getByLabelText('Day it was done'))
    expect(button('Mark done').disabled).toBe(true)
  })
})

describe('Add a checklist item (Bobby: the due date he typed was saved as no date)', () => {
  it('Add item with a partial due date saves nothing and says why', () => {
    const onSave = vi.fn()
    const onClose = vi.fn()
    render(<ChecklistAddDialog groups={[]} onSave={onSave} onClose={onClose} />)
    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Request records' } })
    const due = screen.getByLabelText('Due date')
    typePartial(due)
    // Clicking Add item takes focus from the box first
    fireEvent.blur(due)
    fireEvent.click(button('Add item'))
    expect(onSave).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toBe(DATE_FIELD_TEXT.partial)
  })

  it('a whole due date is saved with the item; no date at all is fine too', () => {
    const onSave = vi.fn()
    render(<ChecklistAddDialog groups={[]} onSave={onSave} onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Request records' } })
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '0026-11-02' } })
    fireEvent.click(button('Add item'))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ title: 'Request records', due_date: '2026-11-02' }))
    cleanup()
    render(<ChecklistAddDialog groups={[]} onSave={onSave} onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Call school' } })
    fireEvent.click(button('Add item'))
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Call school', due_date: null }))
  })
})

describe('a checklist item\'s own date', () => {
  const item: Item = {
    id: 1, row_id: 10, title: 'Home visit', description: null, is_completed: 0, due_date: '2027-06-15',
    completed_at: null, completed_by: null, position: 0, category: null, priority: 'normal', is_archived: 0,
    created_at: '2026-03-01T00:00:00', template_source_id: null, recurrence_rule: null, group_id: null,
  }

  it('clicking away from a partial date keeps the old one and says so', () => {
    setWords()
    const onUpdate = vi.fn()
    render(<ChecklistItem item={item} isDragDisabled={false} onToggle={vi.fn()} onUpdate={onUpdate} onDelete={vi.fn()} />)
    fireEvent.click(screen.getByText(/Jun/))
    const box = document.querySelector('input[type="date"]') as HTMLInputElement
    typePartial(box)
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onUpdate).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toBe(DATE_FIELD_TEXT.partial)
    fireEvent.blur(box)
    expect(onUpdate).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith(DATE_FIELD_TEXT.notSaved)
  })

  it('a new whole date is saved on Enter', () => {
    const onUpdate = vi.fn()
    render(<ChecklistItem item={item} isDragDisabled={false} onToggle={vi.fn()} onUpdate={onUpdate} onDelete={vi.fn()} />)
    fireEvent.click(screen.getByText(/Jun/))
    const box = document.querySelector('input[type="date"]') as HTMLInputElement
    fireEvent.change(box, { target: { value: '2027-07-01' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onUpdate).toHaveBeenCalledWith({ due_date: '2027-07-01' })
  })
})
