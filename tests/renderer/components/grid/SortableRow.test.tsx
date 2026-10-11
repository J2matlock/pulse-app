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
  alertShapeForBand: () => null,
  HANDLE_STYLE: { width: 32 },
  HANDLE_WIDTH: 32,
  PROFILE_BTN_WIDTH: 32,
}))

import { SortableRow, type SortableRowProps } from '../../../../src/renderer/components/grid/SortableRow'
import type { GridRow, Column } from '../../../../src/shared/types'
import { setWords } from '../../vocabFixture'
import { pulseEvents } from '../../../../src/renderer/events'

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

  it('redraws when another record changes and a rule reads another record\'s cell (AUDIT-038)', () => {
    const compare = (SortableRow as unknown as { compare: (a: SortableRowProps, b: SortableRowProps) => boolean }).compare
    const props = makeProps({ hasCrossRowRules: true })
    expect(compare(props, { ...props })).toBe(true)
    expect(compare(props, { ...props, rowMap: new Map([[2, makeRow(2)]]) })).toBe(false)
    // No such rule: another record's edit leaves this row alone
    const plain = makeProps()
    expect(compare(plain, { ...plain, rowMap: new Map([[2, makeRow(2)]]) })).toBe(true)
  })

  it('redraws when the row height or a handler changes (AUDIT-133)', () => {
    const compare = (SortableRow as unknown as { compare: (a: SortableRowProps, b: SortableRowProps) => boolean }).compare
    const props = makeProps()
    expect(compare(props, { ...props, rowHeight: 52 })).toBe(false)
    expect(compare(props, { ...props, onCellKeyDown: vi.fn() })).toBe(false)
  })

  it('copies, selects all, clears and opens the record from a worked-out cell, but never types into it (R1)', () => {
    const onCellKeyDown = vi.fn()
    const cols = [makeColumn(1, 'Case number', 'auto_number')]
    render(<SortableRow {...makeProps({ onCellKeyDown, columns: cols, columnMap: new Map(cols.map(c => [c.id, c])) })} />)
    const cell = document.querySelector('[data-col-id="1"]')!
    fireEvent.keyDown(cell, { key: 'c', ctrlKey: true })
    fireEvent.keyDown(cell, { key: 'a', metaKey: true })
    fireEvent.keyDown(cell, { key: 'Escape' })
    fireEvent.keyDown(cell, { key: 'Enter', shiftKey: true })
    fireEvent.keyDown(cell, { key: 'ArrowDown' })
    expect(onCellKeyDown.mock.calls.map(c => (c[0] as KeyboardEvent).key)).toEqual(['c', 'a', 'Escape', 'Enter', 'ArrowDown'])
    onCellKeyDown.mockClear()
    fireEvent.keyDown(cell, { key: 'x' })
    fireEvent.keyDown(cell, { key: 'Enter' })
    fireEvent.keyDown(cell, { key: 'Delete' })
    fireEvent.keyDown(cell, { key: 'v', ctrlKey: true })
    expect(onCellKeyDown).not.toHaveBeenCalled()
  })

  it('Enter on a deadline column with no rule opens the rule picker (R1)', () => {
    const opened = vi.fn()
    const off = pulseEvents.on('column:choose-rule', opened)
    const cols = [makeColumn(1, 'Review', 'deadline')]
    render(<SortableRow {...makeProps({ columns: cols, columnMap: new Map(cols.map(c => [c.id, c])) })} />)
    fireEvent.keyDown(document.querySelector('[data-col-id="1"]')!, { key: 'Enter' })
    expect(opened).toHaveBeenCalledWith({ columnId: 1 })
    off()
  })

  it('the name cell\'s "Open" takes no room until the row is hovered (R1)', () => {
    const onNavigateToProfile = vi.fn()
    render(<SortableRow {...makeProps({ onNavigateToProfile })} />)
    const open = screen.getByRole('button', { name: 'Open client', hidden: true })
    // opacity-0 kept its width and cut short names; hidden doesn't
    expect(open.className).toContain('hidden')
    expect(open.className).toContain('group-hover:inline-flex')
    expect(open.className).not.toContain('opacity-0')
    fireEvent.click(open)
    expect(onNavigateToProfile).toHaveBeenCalledWith(1)
  })

  it('an open editor fills its cell, with one border, not two (V1)', () => {
    render(<SortableRow {...makeProps({ editingRowId: 1, editingColId: 1, focusedRowId: 1, focusedColId: 1 })} />)
    const cell = document.querySelector('[data-col-id="1"]') as HTMLElement
    expect(screen.getByTestId('cell-editor')).toBeTruthy()
    expect(cell.style.paddingLeft).toBe('0px')
    expect(cell.style.paddingRight).toBe('0px')
    expect(cell.className).not.toContain('ring-3')
  })

  it('applies selected styling when isSelected is true', () => {
    const { container } = render(<SortableRow {...makeProps({ isSelected: true })} />)
    const row = container.querySelector('[role="row"]')!
    expect(row.className).toContain('bg-blue-50')
  })

  describe('a date Pulse can\'t read in a column with a deadline rule (AUDIT-026)', () => {
    const rule = { id: 5, name: 'Every year', thresholds: [] } as unknown as import('../../../../src/shared/types').ParsedAlertRule
    function propsWith(value: string | null, withRule = true): SortableRowProps {
      const name = makeColumn(1, 'Name')
      const review = { ...makeColumn(2, 'Annual review', 'date'), config: JSON.stringify(withRule ? { alert_rule_id: 5 } : {}) }
      const row = { ...makeRow(1), col_2: value } as unknown as GridRow
      const tanRow = { original: row, getVisibleCells: () => [{ id: 'col_1', column: { id: 'col_1' } }, { id: 'col_2', column: { id: 'col_2' } }] } as unknown as import('@tanstack/react-table').Row<GridRow>
      return makeProps({
        row: tanRow,
        columns: [name, review],
        columnMap: new Map([[1, name], [2, review]]),
        alertRuleMap: new Map(withRule ? [[5, rule]] : []),
        parsedColumnConfigs: new Map([[2, { config: withRule ? { alert_rule_id: 5 } : {}, conditionalFormat: [] }]]) as unknown as SortableRowProps['parsedColumnConfigs'],
      })
    }

    it.each(['TBD', '2/30/2026', '2026-02-30', '20260-01-01'])('marks "%s" Not a date, in words, with a plain-language tooltip', value => {
      const { container } = render(<SortableRow {...propsWith(value)} />)
      const marker = screen.getByTestId('not-a-date')
      expect(marker.textContent).toBe('Not a date')
      const cell = container.querySelector('[data-col-id="2"]')!
      expect(cell.getAttribute('title')).toBe("Pulse can't read this as a date, so no deadline is shown for this client. Pick a date to fix it.")
      // The raw value is still shown, so the worker can see what to fix
      expect(cell.textContent).toContain(value)
    })

    it('says nothing in a date column without a rule', () => {
      render(<SortableRow {...propsWith('TBD', false)} />)
      expect(screen.queryByTestId('not-a-date')).toBeNull()
    })

    it('uses the workspace words in the tooltip', () => {
      setWords({ record: { one: 'vehicle', many: 'vehicles', article: 'a' } })
      const { container } = render(<SortableRow {...propsWith('TBD')} />)
      expect(container.querySelector('[data-col-id="2"]')!.getAttribute('title')).toContain('for this vehicle.')
    })
  })
})
