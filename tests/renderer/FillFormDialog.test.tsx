// @vitest-environment jsdom
/** Filling in a form (W08 §4): right inputs, required answers checked, submit, undo. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'

vi.mock('lucide-react', async () => (await import('./lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
const change = { rowId: 50, created: true, previous: {}, previousLinks: {}, noteId: 8 }
const invoke = vi.fn(async (channel: string, ..._args: unknown[]) => {
  if (channel === 'forms:submit') return { ok: true, data: change }
  return { ok: true, data: null }
})
Object.defineProperty(window, 'api', { value: { invoke, on: () => () => {} }, writable: true, configurable: true })

import { FillFormDialog } from '../../src/renderer/components/forms/FillFormDialog'
import { useUndoStore } from '../../src/renderer/stores/undoStore'
import type { Column, GridRow } from '../../src/shared/types'
import type { Form } from '../../src/shared/forms'
import { setWords } from './vocabFixture'

const columns = [
  { id: 1, grid_id: 3, name: 'Name', column_type: 'text', config: '{}' },
  { id: 2, grid_id: 3, name: 'Birth date', column_type: 'date', config: '{}' },
  { id: 3, grid_id: 3, name: 'Status', column_type: 'status', config: JSON.stringify({ options: [{ label: 'New' }, { label: 'Active' }] }) },
  { id: 4, grid_id: 3, name: 'Agrees', column_type: 'checkbox', config: '{"required":true}' },
] as Column[]
const form: Form = {
  id: 7, grid_id: 3, name: 'Intake', intro: 'Thanks for coming in.', log_activity_type: 'note', position: 0, created_at: '', updated_at: '',
  fields: [
    { kind: 'section', title: 'About you' },
    { kind: 'column', columnId: 1, required: true },
    { kind: 'column', columnId: 2, width: 'half' },
    { kind: 'column', columnId: 3, width: 'half' },
    { kind: 'column', columnId: 4 },
    { kind: 'note', label: 'What brings you in?' },
  ],
}

beforeEach(() => { setWords(); invoke.mockClear(); useUndoStore.getState().clear() })

describe('filling in a form', () => {
  it('checks required answers, submits only what was given, and undo removes the record', async () => {
    const onClose = vi.fn()
    render(<FillFormDialog form={form} columns={columns} onClose={onClose} />)
    expect(screen.getByText('Thanks for coming in.')).toBeTruthy()
    expect((screen.getByLabelText(/Birth date/) as HTMLInputElement).type).toBe('date')
    expect([...(screen.getByLabelText(/Status/) as HTMLSelectElement).options].map(o => o.text)).toEqual(['—', 'New', 'Active'])
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Add / })) })
    expect(screen.getByRole('alert').textContent).toBe('Please fill in: Name, Agrees.')
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    expect(document.activeElement).toBe(screen.getByRole('alert'))
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: 'Ada' } })
    fireEvent.click(screen.getByLabelText(/Agrees/))
    fireEvent.change(screen.getByLabelText('What brings you in?'), { target: { value: 'Housing' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Add / })) })
    expect(invoke).toHaveBeenCalledWith('forms:submit', 7, null, { 1: 'Ada', 4: 'true' }, { 5: 'Housing' })
    expect(onClose).toHaveBeenCalled()
    await act(async () => { await useUndoStore.getState().undo() })
    expect(invoke).toHaveBeenCalledWith('forms:undo', change)
  })

  it('prefills from the record when updating', () => {
    const row = { row_id: 9, col_1: 'Bo', col_2: '1990-01-02', col_3: 'Active', col_4: 'true' } as unknown as GridRow
    render(<FillFormDialog form={form} columns={columns} row={row} onClose={vi.fn()} />)
    expect((screen.getByLabelText(/Name/) as HTMLInputElement).value).toBe('Bo')
    expect((screen.getByLabelText(/Status/) as HTMLSelectElement).value).toBe('Active')
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy()
  })
})
