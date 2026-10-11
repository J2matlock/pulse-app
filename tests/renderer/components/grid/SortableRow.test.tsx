// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'

const mockInvoke = vi.fn().mockResolvedValue({ ok: true, data: null })
Object.defineProperty(window, 'api', {
  value: { invoke: mockInvoke },
  writable: true,
})

if (!globalThis.crypto?.randomUUID) {
  vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2) })
}

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)

vi.mock('../../../../src/renderer/utils/deadlineCalc', () => ({
  computeDaysUntil: () => 10,
  getMatchingThreshold: () => null,
  formatDeadlineTooltip: () => '',
}))

vi.mock('../../../../src/renderer/utils/alertColors', () => ({
  resolveAlertColor: () => ({ className: '', style: {} }),
}))

vi.mock('../../../../src/renderer/components/grid/CellConditionalFormatPanel', () => ({
  evalCellFormat: () => null,
}))

vi.mock('../../../../src/renderer/components/grid/CellEditor', () => ({
  CellEditor: () => <div data-testid="cell-editor" />,
}))

vi.mock('../../../../src/renderer/components/grid/CellDisplay', () => ({
  CellDisplay: ({ value }: { value: string | null }) => <span data-testid="cell-display">{value ?? '—'}</span>,
}))

vi.mock('../../../../src/renderer/components/grid/AcuityBadge', () => ({
  AcuityBadge: () => <div data-testid="acuity-badge" />,
  BADGE_WIDTH: 40,
}))

vi.mock('../../../../src/renderer/components/grid/gridConstants', () => ({
  alertShapeForThreshold: () => null,
  alertShapeForBand: () => null,
  HANDLE_STYLE: { width: 32 },
  HANDLE_WIDTH: 32,
  PROFILE_BTN_WIDTH: 32,
}))

import { SortableRow, type SortableRowProps } from '../../../../src/renderer/components/grid/SortableRow'
import type { GridRow, Column } from '../../../../src/shared/types'
import { setWords } from '../../vocabFixture'

function makeColumn(id: number, name: string, type = 'text'): Column {
  return {
    id, grid_id: 1, name, column_type: type, position: id - 1, width: 150,
    is_visible: 1, is_required: 0, is_identifier: 0, is_name_column: id === 1 ? 1 : 0,
    default_value: null, description: null, config: '{}', conditional_format: '[]',
    created_at: '',
  } as Column
}

function makeRow(id: number): GridRow {
  return {
    row_id: id, position: id - 1, is_active: 1, is_starred: 0,
    acuity_level_id: null, deleted_at: null,
    created_at: '', updated_at: '', col_1: `Client ${id}`,
  } as unknown as GridRow
}

function makeTanstackRow(original: GridRow) {
  return {
    original,
    getVisibleCells: () => [{
      id: 'col_1',
      column: { id: 'col_1' },
    }],
  } as unknown as import('@tanstack/react-table').Row<GridRow>
}

function makeProps(overrides: Partial<SortableRowProps> = {}): SortableRowProps {
  const row = makeRow(1)
  const cols = [makeColumn(1, 'Name')]
  return {
    row: makeTanstackRow(row),
    rowIndex: 0,
    rowHeight: 44,
    editingRowId: null,
    editingColId: null,
    focusedRowId: null,
    focusedColId: null,
    columns: cols,
    columnMap: new Map(cols.map(c => [c.id, c])),
    alertRuleMap: new Map(),
    cellFormats: new Map(),
    parsedColumnConfigs: new Map(),
    hasAnyHighlightRules: false,
    highlightColumnIds: new Set(),
    rowMap: new Map(),
    containerRef: { current: null } as React.RefObject<HTMLDivElement>,
    isSelected: false,
    selectedCount: 0,
    onBulkSetAcuityLevel: vi.fn(),
    acuityEnabled: false,
    acuityLevels: [],
    onSetAcuityLevel: vi.fn(),
    editingCellRef: { current: null } as React.RefObject<{ rowId: number; columnId: number } | null>,
    setEditingCell: vi.fn(),
    setFocusedCell: vi.fn(),
    updateCell: vi.fn().mockResolvedValue(undefined),
    onCellKeyDown: vi.fn(),
    onCellContextMenu: vi.fn(),
    onNavigateToProfile: vi.fn(),
    onToggleSelect: vi.fn(),
    onNavigateAfterEdit: vi.fn(),
    rowId: 1,
    searchQuery: undefined,
    findReplaceActiveRowId: null,
    findReplaceActiveColId: null,
    frozenLeftOffsets: new Map(),
    frozenColumnCount: 0,
    ...overrides,
  }
}

beforeEach(() => { setWords() })

describe('SortableRow', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('renders without crashing', () => {
    const { container } = render(<SortableRow {...makeProps()} />)
    expect(container.querySelector('[role="row"]')).toBeTruthy()
  })

  it('renders select row button', () => {
    render(<SortableRow {...makeProps()} />)
    expect(screen.getByTitle('Select client')).toBeTruthy()
  })

  it('clicking profile button calls onNavigateToProfile', () => {
    const onNavigateToProfile = vi.fn()
    render(<SortableRow {...makeProps({ onNavigateToProfile })} />)
    fireEvent.click(screen.getByTitle('Open client profile'))
    expect(onNavigateToProfile).toHaveBeenCalledWith(1)
  })

  it('clicking select button calls onToggleSelect', () => {
    const onToggleSelect = vi.fn()
    render(<SortableRow {...makeProps({ onToggleSelect })} />)
    fireEvent.click(screen.getByTitle('Select client'))
    expect(onToggleSelect).toHaveBeenCalled()
  })

  it('redraws when meter, quota, step or extension data arrives (G-13)', () => {
    const compare = (SortableRow as unknown as { compare: (a: SortableRowProps, b: SortableRowProps) => boolean }).compare
    const props = makeProps({ deadlineContext: { meter: {} } })
    expect(compare(props, { ...props })).toBe(true)
    expect(compare(props, { ...props, deadlineContext: { meter: { '1:2': [] } } })).toBe(false)
  })

  it('applies selected styling when isSelected is true', () => {
    const { container } = render(<SortableRow {...makeProps({ isSelected: true })} />)
    const row = container.querySelector('[role="row"]')!
    expect(row.className).toContain('bg-blue-50')
  })
})
