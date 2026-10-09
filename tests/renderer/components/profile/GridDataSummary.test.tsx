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
vi.mock('../../../../src/renderer/utils/deadlineCalc', () => ({
  computeDaysUntil: () => 10,
  getAlertThreshold: () => null,
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

  it('renders values as read-only text', async () => {
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
      expect(screen.getByText('Active')).toBeTruthy()
    })

    // Component is display-only — no edit mode, no input elements
    expect(screen.queryByDisplayValue('Active')).toBeNull()
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
