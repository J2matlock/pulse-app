// @vitest-environment jsdom
/** The form builder (W08 §3): add columns (required from the column), headings and questions, reorder, save. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act, within } from '@testing-library/react'

vi.mock('lucide-react', async () => (await import('./lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
const columns = [
  { id: 1, grid_id: 3, name: 'Name', column_type: 'text', config: '{"required":true}', position: 0 },
  { id: 2, grid_id: 3, name: 'Phone', column_type: 'phone', config: '{}', position: 1 },
  { id: 3, grid_id: 3, name: 'Number', column_type: 'auto_number', config: '{}', position: 2 },
]
let forms: unknown[] = [{ id: 9, grid_id: 3, name: 'Old form', intro: null, fields: [{ kind: 'note', label: 'Q' }], log_activity_type: null, position: 0, created_at: '', updated_at: '', dropped: 2 }]
const invoke = vi.fn(async (channel: string, ..._args: unknown[]) => {
  if (channel === 'grid:get') return { ok: true, data: { columns, hiddenColumns: [] } }
  if (channel === 'forms:list') return { ok: true, data: forms }
  if (channel === 'forms:save') return { ok: true, data: { id: 10 } }
  return { ok: true, data: [] }
})
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })

import { FormsDialog } from '../../src/renderer/components/forms/FormsDialog'
import { setWords } from './vocabFixture'

beforeEach(() => { setWords(); invoke.mockClear() })

describe('the form builder', () => {
  it('lists forms, noting fields lost to deleted columns', async () => {
    render(<FormsDialog gridId={3} gridName="Clients" onClose={vi.fn()} />)
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    expect(screen.getByText(/1 questions · 2 removed because their column was deleted/)).toBeTruthy()
  })

  it('a question the column marks required shows ticked, and unticking it saves "not required"', async () => {
    forms = [{ id: 11, grid_id: 3, name: 'Short', intro: null, fields: [{ kind: 'column', columnId: 1 }], log_activity_type: null, position: 0, created_at: '', updated_at: '' }]
    render(<FormsDialog gridId={3} gridName="Clients" onClose={vi.fn()} />)
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }))
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    const box = screen.getByRole('checkbox', { name: 'Required' }) as HTMLInputElement
    expect(box.checked).toBe(true)
    fireEvent.click(box)
    expect(box.checked).toBe(false)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save form' })) })
    const saved = invoke.mock.calls.find(c => c[0] === 'forms:save')![1] as { fields: unknown[] }
    expect(saved.fields).toEqual([{ kind: 'column', columnId: 1, required: false }])
  })

  it('Delete → Cancel in the confirm closes only the confirm, not the forms dialog (Q-051)', async () => {
    forms = [{ id: 11, grid_id: 3, name: 'Short', intro: null, fields: [{ kind: 'column', columnId: 1 }], log_activity_type: null, position: 0, created_at: '', updated_at: '' }]
    const onClose = vi.fn()
    render(<FormsDialog gridId={3} gridName="Clients" onClose={onClose} />)
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    fireEvent.click(screen.getByRole('button', { name: 'Delete Short' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByRole('dialog', { name: /Forms for Clients/ })).toBeTruthy()
  })

  it('a click outside does not throw away a form being built', async () => {
    forms = []
    const onClose = vi.fn()
    const { container } = render(<FormsDialog gridId={3} gridName="Clients" onClose={onClose} />)
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    fireEvent.click(screen.getByRole('button', { name: /New form/ }))
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    fireEvent.click(container.firstChild as HTMLElement)
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Form name')).toBeTruthy()
  })

  it('builds a form and saves it', async () => {
    forms = []
    render(<FormsDialog gridId={3} gridName="Clients" onClose={vi.fn()} />)
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    fireEvent.click(screen.getByRole('button', { name: /New form/ }))
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    const add = screen.getByRole('group', { name: 'Add to the form' })
    // Columns Pulse fills in aren't offered
    expect(within(add).queryByRole('button', { name: /Number/ })).toBeNull()
    fireEvent.click(within(add).getByRole('button', { name: /Phone/ }))
    fireEvent.click(within(add).getByRole('button', { name: /Name/ }))
    fireEvent.click(within(add).getByRole('button', { name: /Question for the/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Move Name up' }))
    fireEvent.change(screen.getByLabelText(/^Label for Question/), { target: { value: 'Why now?' } })
    fireEvent.change(screen.getByLabelText('Form name'), { target: { value: 'Intake' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save form' })) })
    expect(invoke).toHaveBeenCalledWith('forms:save', {
      grid_id: 3, name: 'Intake', intro: null, log_activity_type: null,
      fields: [{ kind: 'column', columnId: 1, required: true }, { kind: 'column', columnId: 2 }, { kind: 'note', label: 'Why now?' }],
    })
  })

  it('after "Move up", focus stays with the field that moved, so pressing again moves it again (AUDIT-138)', async () => {
    forms = []
    render(<FormsDialog gridId={3} gridName="Clients" onClose={vi.fn()} />)
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    fireEvent.click(screen.getByRole('button', { name: /New form/ }))
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    const add = screen.getByRole('group', { name: 'Add to the form' })
    fireEvent.click(within(add).getByRole('button', { name: /Phone/ }))
    fireEvent.click(within(add).getByRole('button', { name: /Section heading/ }))
    fireEvent.click(within(add).getByRole('button', { name: /Question for the/ }))
    const label = screen.getByLabelText(/^Label for Question/) as HTMLInputElement
    fireEvent.change(label, { target: { value: 'Why now?' } })
    const up = screen.getByRole('button', { name: /^Move Question for the .* up$/ })
    up.focus()
    await act(async () => { fireEvent.click(up) })
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(/^Move Question for the .* up$/)
    // The same input went with it
    expect(screen.getByLabelText(/^Label for Question/)).toBe(label)
    await act(async () => { fireEvent.click(document.activeElement as HTMLElement) })
    const list = screen.getByRole('list', { name: 'Fields on the form' })
    expect(within(list).getAllByRole('listitem').map(li => li.querySelector('span')?.textContent)).toEqual([expect.stringMatching(/^Question for the/), 'Phone', 'Section heading'])
    // At the top now: focus moves to the arrow that still works
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(/^Move Question for the .* down$/)
  })

  it('an empty heading is flagged on its own box, in plain words, and not saved (audit A06-14)', async () => {
    forms = []
    render(<FormsDialog gridId={3} gridName="Clients" onClose={vi.fn()} />)
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    fireEvent.click(screen.getByRole('button', { name: /New form/ }))
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    fireEvent.change(screen.getByLabelText('Form name'), { target: { value: 'Test form' } })
    fireEvent.click(screen.getByRole('button', { name: /Section heading/ }))
    const heading = screen.getByLabelText('Heading')
    fireEvent.change(heading, { target: { value: '' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save form' })) })
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe('Give this heading a title, or remove it.')
    expect(heading.getAttribute('aria-invalid')).toBe('true')
    expect(heading.getAttribute('aria-describedby')).toBe(alert.id)
    expect(document.activeElement).toBe(heading)
    expect(invoke.mock.calls.some(c => c[0] === 'forms:save')).toBe(false)
    fireEvent.change(heading, { target: { value: 'About you' } })
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

