// @vitest-environment jsdom
/** "Add a column" as a dialog (B-03), the duplicate-name guard (B-14) and the deadline question's words (B-31). */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'

Object.defineProperty(window, 'api', { value: { invoke: vi.fn().mockResolvedValue({ ok: true, data: null }), on: () => () => {} }, writable: true })

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))

import { useGridStore } from '../../../../src/renderer/stores/gridStore'
import { useAlertStore } from '../../../../src/renderer/stores/alertStore'
import { AddColumnForm, useAddColumnDraft, freeColumnName, sameNamedColumn } from '../../../../src/renderer/components/grid/AddColumnPanel'
import type { Column } from '../../../../src/shared/types'
import { setWords } from '../../vocabFixture'

function col(id: number, name: string, type = 'text', visible = 1): Column {
  return { id, grid_id: 1, name, column_type: type, position: id, width: 100, is_visible: visible, is_required: 0, is_identifier: 0, is_name_column: 0, default_value: null, description: null, config: '{}', conditional_format: '[]', created_at: '' } as Column
}

const columns = [col(1, 'Name'), col(2, 'Phone', 'phone'), col(3, 'Old notes', 'text', 0), col(4, 'Born', 'date')]

function Harness({ onCancel = vi.fn(), onMoreOptions = vi.fn() }: { onCancel?: () => void; onMoreOptions?: (id: number) => void }) {
  const draft = useAddColumnDraft({ open: true, rowCount: 3, onAdded: () => {}, onMoreOptions })
  return <AddColumnForm draft={draft} allColumns={columns} rowCount={3} gridCount={1} linksOn={false} filesOn={false} onLinkColumn={() => {}} onCancel={onCancel} />
}

let addColumn: ReturnType<typeof vi.fn>
beforeEach(() => {
  setWords()
  addColumn = vi.fn().mockResolvedValue(9)
  useGridStore.setState({ addColumn, activeGridId: 1 } as never)
  useAlertStore.setState({ rules: [], createRule: vi.fn().mockResolvedValue(21) } as never)
})

describe('freeColumnName / sameNamedColumn', () => {
  it('finds a taken name whatever the case or spaces, and the next free number', () => {
    expect(sameNamedColumn(' phone ', columns)?.id).toBe(2)
    expect(sameNamedColumn('old NOTES', columns)?.id).toBe(3)
    expect(sameNamedColumn('Fax', columns)).toBeUndefined()
    expect(sameNamedColumn('', columns)).toBeUndefined()
    expect(freeColumnName('Phone', columns)).toBe('Phone 2')
    expect(freeColumnName('Phone', [...columns, col(5, 'phone 2')])).toBe('Phone 3')
    expect(freeColumnName('Fax', columns)).toBe('Fax')
  })
})

describe('AddColumnForm', () => {
  it('is a centred dialog named "Add a column" that focuses the name and closes on Escape', () => {
    const onCancel = vi.fn()
    render(<Harness onCancel={onCancel} />)
    const dialog = screen.getByRole('dialog', { name: 'Add a column' })
    expect(dialog.className).toContain('fixed inset-0')
    expect(document.activeElement).toBe(screen.getByLabelText('Column name'))
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalled()
  })

  it('adds a column with a new name', async () => {
    render(<Harness />)
    fireEvent.change(screen.getByLabelText('Column name'), { target: { value: 'Fax' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add' })) })
    expect(addColumn).toHaveBeenCalledWith('Fax', 'text', undefined, { numberExisting: true })
  })

  it('catches a name a column already has (hidden ones too) and offers "Phone 2" or another name (B-14)', async () => {
    render(<Harness />)
    fireEvent.change(screen.getByLabelText('Column name'), { target: { value: 'phone' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add' })) })
    expect(addColumn).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('There\'s already a column called “Phone”')
    expect(screen.getByLabelText('Column name').getAttribute('aria-invalid')).toBe('true')
    // "Change the name" keeps the form, typing clears the notice
    fireEvent.click(screen.getByRole('button', { name: 'Change the name' }))
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.change(screen.getByLabelText('Column name'), { target: { value: 'Old notes' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add' })) })
    expect(screen.getByRole('alert').textContent).toContain('“Old notes” (hidden)')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add as “Old notes 2”' })) })
    expect(addColumn).toHaveBeenCalledWith('Old notes 2', 'text', undefined, { numberExisting: true })
  })

  it('words the date answers by what they do, with "More options…" as a link (B-31)', async () => {
    const onMoreOptions = vi.fn()
    render(<Harness onMoreOptions={onMoreOptions} />)
    fireEvent.change(screen.getByLabelText('Column name'), { target: { value: 'Care plan due' } })
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'date' } })
    expect(screen.getByText('Does this date come due again?')).toBeTruthy()
    expect(screen.getByLabelText("No, it's just a date")).toBeTruthy()
    expect(screen.getByLabelText('Yes, every')).toBeTruthy()
    expect(screen.getByLabelText("It's a one-off due date (color it as it gets close)")).toBeTruthy()
    expect(screen.getAllByRole('radio')).toHaveLength(3)
    const more = screen.getByRole('button', { name: 'More options… (set it up in detail after adding)' })
    fireEvent.click(more)
    expect(screen.getByText('The full rule editor opens after adding.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Never mind' }))
    expect(screen.getByRole('button', { name: /^More options…/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^More options…/ }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add' })) })
    expect(addColumn).toHaveBeenCalledWith('Care plan due', 'date', undefined, { numberExisting: true })
    expect(onMoreOptions).toHaveBeenCalledWith(9)
  })
})
