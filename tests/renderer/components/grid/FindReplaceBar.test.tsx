// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)

import { FindReplaceBar } from '../../../../src/renderer/components/grid/FindReplaceBar'
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

describe('FindReplaceBar', () => {
  beforeEach(() => { vi.clearAllMocks() })

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
