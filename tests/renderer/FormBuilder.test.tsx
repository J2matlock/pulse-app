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
})
