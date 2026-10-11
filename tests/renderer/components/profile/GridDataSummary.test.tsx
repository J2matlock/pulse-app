// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

const mockInvoke = vi.fn()

Object.defineProperty(window, 'api', {
  value: { invoke: mockInvoke },
  writable: true,
})

// Mock lucide-react
vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)

// Mock @dnd-kit
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
  closestCenter: vi.fn(),
  PointerSensor: vi.fn(),
  useSensor: () => ({}),
  useSensors: () => [],
}))

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
  verticalListSortingStrategy: {},
  rectSortingStrategy: {},
  arrayMove: (arr: unknown[], from: number, to: number) => {
    const result = [...arr]
    const [removed] = result.splice(from, 1)
    result.splice(to, 0, removed)
    return result
  },
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    transform: null,
    transition: null,
    isDragging: false,
  }),
}))

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => '' } },
}))

// Mock deadlineCalc
vi.mock('../../../../src/renderer/utils/deadlineCalc', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('../../../../src/renderer/utils/deadlineCalc')),
}))

import { GridDataSummary } from '../../../../src/renderer/components/profile/GridDataSummary'
import type { Column, GridRow, ParsedAlertRule } from '../../../../src/shared/types'
import { setWords } from '../../vocabFixture'

function makeColumn(overrides: Partial<Column> = {}): Column {
  return {
    id: 1,
    grid_id: 1,
    name: 'Status',
    column_type: 'text',
    width: 150,
    position: 0,
    is_visible: 1,
    is_required: 0,
    is_identifier: 0,
    is_name_column: 0,
    default_value: null,
    description: null,
    config: '{}',
    conditional_format: '[]',
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeRow(colValues: Record<string, string | null> = {}): GridRow {
  return {
    row_id: 1,
    position: 0,
    is_active: 1,
    is_starred: 0,
    acuity_level_id: null,
    deleted_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...colValues,
  } as GridRow
}

beforeEach(() => { setWords() })

describe('GridDataSummary', () => {
  const onCellSave = vi.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    vi.clearAllMocks()
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'settings:get-all') return Promise.resolve({ ok: true, data: {} })
      return Promise.resolve({ ok: true, data: null })
    })
  })

  it('renders nothing when no columns', () => {
    const { container } = render(
      <GridDataSummary
        row={makeRow()}
        columns={[]}
        alertRules={[]}
        gridId={1}
        onCellSave={onCellSave}
      />
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders Client Details header', async () => {
    const col = makeColumn({ id: 2, name: 'Status' })
    render(
      <GridDataSummary
        row={makeRow({ col_2: 'Active' })}
        columns={[col]}
        alertRules={[]}
        gridId={1}
        onCellSave={onCellSave}
      />
    )
    expect(screen.getByText('Client details')).toBeTruthy()
  })

  it('renders column names as labels and values', async () => {
    const cols = [
      makeColumn({ id: 2, name: 'Status' }),
      makeColumn({ id: 3, name: 'Phone' }),
    ]
    render(
      <GridDataSummary
        row={makeRow({ col_2: 'Active', col_3: '555-1234' })}
        columns={cols}
        alertRules={[]}
        gridId={1}
        onCellSave={onCellSave}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('Status')).toBeTruthy()
      expect(screen.getByText('Active')).toBeTruthy()
      expect(screen.getByText('Phone')).toBeTruthy()
      expect(screen.getByText('555-1234')).toBeTruthy()
    })
  })

  it('shows dash for empty values', async () => {
    const col = makeColumn({ id: 2, name: 'Notes' })
    render(
      <GridDataSummary
        row={makeRow({ col_2: null })}
        columns={[col]}
        alertRules={[]}
        gridId={1}
        onCellSave={onCellSave}
      />
    )

    await waitFor(() => {
      // The em dash is rendered for empty values
      expect(screen.getByText('—')).toBeTruthy()
    })
  })

  it('edits a value in place with the list\'s editor and saves it like a list edit', async () => {
    const col = makeColumn({ id: 2, name: 'Status', column_type: 'text' })
    render(
      <GridDataSummary
        row={makeRow({ col_2: 'Active' })}
        columns={[col]}
        alertRules={[]}
        gridId={1}
        onCellSave={onCellSave}
      />
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Status' }))
    const box = screen.getByDisplayValue('Active')
    fireEvent.change(box, { target: { value: 'Closed' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onCellSave).toHaveBeenCalledWith(1, 2, 'Closed')
  })

  it('leaves worked-out columns read-only and shows them as the list does', async () => {
    const cols = [
      makeColumn({ id: 2, name: 'Fee', column_type: 'currency' }),
      makeColumn({ id: 3, name: 'Age', column_type: 'age_from_dob', config: JSON.stringify({ source_column_id: 4 }) }),
      makeColumn({ id: 4, name: 'Born', column_type: 'date' }),
    ]
    render(<GridDataSummary row={makeRow({ col_2: '1500', col_4: '1990-01-01' })} columns={cols} alertRules={[]} gridId={1} onCellSave={onCellSave} />)
    expect(await screen.findByText('$1,500.00')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Edit Age' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Edit Fee' })).toBeTruthy()
  })

  it('shows columns added after the picker was used, and plain type names', async () => {
    mockInvoke.mockImplementation((channel: string) => {
      // An older install saved the columns to show: 2 only (3 didn't exist yet)
      if (channel === 'settings:get-all') return Promise.resolve({ ok: true, data: { client_details_columns_1: '[2]' } })
      return Promise.resolve({ ok: true, data: null })
    })
    const cols = [makeColumn({ id: 2, name: 'Phone' }), makeColumn({ id: 3, name: 'Status', column_type: 'status' }), makeColumn({ id: 5, name: 'Notes' })]
    render(<GridDataSummary row={makeRow({ col_2: '555', col_3: 'Open', col_5: 'hi' })} columns={cols} alertRules={[]} gridId={1} onCellSave={onCellSave} />)
    // Hidden by the old choice: the ones not shown then
    await waitFor(() => expect(screen.queryByText('hi')).toBeNull())
    fireEvent.click(screen.getByTitle('Choose visible columns'))
    expect(screen.getAllByText('Status').length).toBeGreaterThan(0)
    expect(screen.queryByText('status')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Notes/ }))
    expect(mockInvoke).toHaveBeenCalledWith('settings:update', 'client_details_hidden_1', '[3]')
  })

  it('renders drag handle on each card', async () => {
    const col = makeColumn({ id: 2, name: 'Status', column_type: 'text' })
    render(
      <GridDataSummary
        row={makeRow({ col_2: 'Active' })}
        columns={[col]}
        alertRules={[]}
        gridId={1}
        onCellSave={onCellSave}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('Status')).toBeTruthy()
    })

    expect(screen.getByLabelText('Drag to reorder')).toBeTruthy()
  })
})
