// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, within } from '@testing-library/react'

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)

import { FindReplaceBar, replacementFor } from '../../../../src/renderer/components/grid/FindReplaceBar'
import type { GridRow, Column } from '../../../../src/shared/types'
import { setWords } from '../../vocabFixture'

function makeColumn(id: number, name: string, type = 'text'): Column {
  return {
    id, grid_id: 1, name, column_type: type, position: id - 1, width: 150,
    is_visible: 1, is_required: 0, is_identifier: 0, is_name_column: 0,
    default_value: null, description: null, config: '{}', conditional_format: '[]',
    created_at: '',
  } as Column
}

function makeRow(id: number, name: string): GridRow {
  return {
    row_id: id, position: id - 1, is_active: 1, is_starred: 0,
    acuity_level_id: null, deleted_at: null,
    created_at: '', updated_at: '', col_1: name,
  } as unknown as GridRow
}

function makeProps(overrides: Partial<Parameters<typeof FindReplaceBar>[0]> = {}) {
  return {
    open: true,
    onClose: vi.fn(),
    rows: [makeRow(1, 'Alice'), makeRow(2, 'Bob')],
    columns: [makeColumn(1, 'Name')],
    onReplace: vi.fn().mockResolvedValue(undefined),
    onReplaceAll: vi.fn().mockResolvedValue(undefined),
    onHighlightChange: vi.fn(),
    onActiveMatchChange: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => { setWords() })

describe('replacementFor (G-27)', () => {
  it('replaces whole numbers and money, never digits inside them', () => {
    const money = makeColumn(2, 'Fee', 'currency')
    expect(replacementFor(money, '1150', '1', '2')).toBeNull()
    expect(replacementFor(money, '1', '1', '2')).toBe('2')
    expect(replacementFor(money, '1', '1', 'two')).toBeNull()
  })

  it('only turns a choice into another choice', () => {
    const status = { ...makeColumn(3, 'Status', 'status'), config: JSON.stringify({ options: [{ label: 'Scheduled', color: '#000' }, { label: 'Booked', color: '#111' }] }) }
    expect(replacementFor(status, 'Scheduled', 'scheduled', 'booked')).toBe('Booked')
    expect(replacementFor(status, 'Scheduled', 'Scheduled', 'Done')).toBeNull()
  })

  it('replaces inside text', () => {
    expect(replacementFor(makeColumn(1, 'Name'), 'Dr. Dre', 'dr.', 'Doctor')).toBe('Doctor Dre')
  })
})

describe('FindReplaceBar', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('asks before Replace All, with the counts, and replaces in the order given', async () => {
    const onReplaceAll = vi.fn().mockResolvedValue(undefined)
    render(<FindReplaceBar {...makeProps({ onReplaceAll, rows: [makeRow(2, 'Bobby Bob'), makeRow(1, 'Bob')] })} />)
    fireEvent.change(screen.getByLabelText('Find text'), { target: { value: 'Bob' } })
    fireEvent.change(screen.getByLabelText('Replace text'), { target: { value: 'Rob' } })
    await new Promise(r => setTimeout(r, 250))
    fireEvent.click(screen.getByText('Replace All'))
    expect(onReplaceAll).not.toHaveBeenCalled()
    expect(screen.getByText('Replace in 2 cells across 2 clients?')).toBeTruthy()
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Replace' }))
    expect(onReplaceAll).toHaveBeenCalledWith([
      { rowId: 2, colId: 1, oldVal: 'Bobby Bob', newVal: 'Robby Rob' },
      { rowId: 1, colId: 1, oldVal: 'Bob', newVal: 'Rob' },
    ])
  })

  it('renders when open', () => {
    render(<FindReplaceBar {...makeProps()} />)
    expect(screen.getByRole('search')).toBeTruthy()
    expect(screen.getByLabelText('Find text')).toBeTruthy()
  })

  it('returns null when closed', () => {
    const { container } = render(<FindReplaceBar {...makeProps({ open: false })} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders find and replace inputs', () => {
    render(<FindReplaceBar {...makeProps()} />)
    expect(screen.getByLabelText('Find text')).toBeTruthy()
    expect(screen.getByLabelText('Replace text')).toBeTruthy()
  })

  it('renders Replace and Replace All buttons', () => {
    render(<FindReplaceBar {...makeProps()} />)
    expect(screen.getByText('Replace')).toBeTruthy()
    expect(screen.getByText('Replace All')).toBeTruthy()
  })

  it('close button calls onClose', () => {
    const onClose = vi.fn()
    render(<FindReplaceBar {...makeProps({ onClose })} />)
    fireEvent.click(screen.getByLabelText('Close find and replace'))
    expect(onClose).toHaveBeenCalled()
  })
})
