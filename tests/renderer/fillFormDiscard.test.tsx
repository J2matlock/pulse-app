// @vitest-environment jsdom
/** 1.37: a filled-in form isn't thrown away by a stray click or Escape, and "Print filled" saves first. */
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

describe('not losing a filled-in form', () => {
  it('closes straight away when nothing was filled in', () => {
    const onClose = vi.fn()
    render(<FillFormDialog form={form} columns={columns} onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('asks before Escape or a click outside throws away answers', async () => {
    const onClose = vi.fn()
    render(<FillFormDialog form={form} columns={columns} onClose={onClose} />)
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: 'Ada' } })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText('Discard your changes?')).toBeTruthy()
    // Keep filling in
    // The question's own Cancel is the last one on the page
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' }).at(-1)!) })
    expect(screen.queryByText('Discard your changes?')).toBeNull()
    expect((screen.getByLabelText(/Name/) as HTMLInputElement).value).toBe('Ada')
    // A click on the dark area outside asks too; Discard closes
    fireEvent.click(document.querySelector('.bg-black\\/50')!)
    expect(screen.getByText('Discard your changes?')).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Discard changes' })) })
    expect(onClose).toHaveBeenCalled()
  })

  it('saves changed answers before printing a filled form', async () => {
    const onClose = vi.fn()
    const row = { row_id: 50, col_1: 'Ada', col_2: null, col_3: 'New', col_4: 'true' } as unknown as GridRow
    render(<FillFormDialog form={form} columns={columns} row={row} onClose={onClose} />)
    expect(screen.getByRole('button', { name: /Print filled/ })).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: 'Ada Lovelace' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Save and print/ })) })
    const calls = invoke.mock.calls.map(c => c[0])
    expect(calls.indexOf('forms:submit')).toBeGreaterThanOrEqual(0)
    expect(calls.indexOf('forms:print')).toBeGreaterThan(calls.indexOf('forms:submit'))
  })
})
