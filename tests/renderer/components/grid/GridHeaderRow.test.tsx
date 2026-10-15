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

// Mock DnD kit
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  closestCenter: vi.fn(),
}))

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  horizontalListSortingStrategy: {},
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
}))

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => '' } },
}))

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)

vi.mock('../../../../src/renderer/components/grid/ColumnHeader', () => ({
  ColumnHeader: ({ column }: { column: { name: string } }) => <div data-testid={`col-header-${column.name}`}>{column.name}</div>,
}))

vi.mock('../../../../src/renderer/components/grid/gridConstants', () => ({
  HANDLE_WIDTH: 32,
  PROFILE_BTN_WIDTH: 132,
  OPEN_COL_WIDTH: 44,
  STAR_COL_WIDTH: 44,
  MENU_COL_WIDTH: 44,
  ADD_COL_WIDTH: 44,
}))

vi.mock('../../../../src/renderer/components/grid/AcuityBadge', () => ({
  BADGE_WIDTH: 40,
}))

vi.mock('../../../../src/renderer/utils/safeInvoke', () => ({
  safeInvoke: vi.fn().mockResolvedValue({ ok: true, data: null }),
}))

vi.mock('../../../../src/renderer/utils/rendererLogger', () => ({
  rlog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

vi.mock('zustand/react/shallow', () => ({
  useShallow: <T,>(selector: (state: unknown) => T) => selector,
}))

vi.mock('../../../../src/renderer/utils/animations', () => ({
  dropdownVariants: {},
  contextMenuVariants: {},
}))

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<HTMLDivElement>) => {
      const { variants, initial, animate, exit, ...rest } = props
      return <div ref={ref} {...rest} />
    }),
  },
}))

vi.mock('../../../../src/renderer/components/alerts/AlertRuleEditor', () => ({
  AlertRuleEditor: () => null,
}))

vi.mock('../../../../src/renderer/components/grid/CellConditionalFormatPanel', () => ({
  CellConditionalFormatPanel: () => null,
}))

vi.mock('../../../../src/renderer/components/shared/ConfirmDialog', () => ({
  ConfirmDialog: () => null,
}))

import { GridHeaderRow, type GridHeaderRowProps } from '../../../../src/renderer/components/grid/GridHeaderRow'
import type { Column } from '../../../../src/shared/types'
import { setWords } from '../../vocabFixture'

function makeColumn(id: number, name: string): Column {
  return {
    id, grid_id: 1, name, column_type: 'text', position: id - 1, width: 150,
    is_visible: 1, is_required: 0, is_identifier: 0, is_name_column: 0,
    default_value: null, description: null, config: '{}', conditional_format: '[]',
    created_at: '',
  } as Column
}

function makeHeader(col: Column) {
  return {
    id: `col_${col.id}`,
    column: {
      id: `col_${col.id}`,
      getIsSorted: () => false,
      getCanResize: () => true,
      getIsResizing: () => false,
    },
    getResizeHandler: () => vi.fn(),
  } as unknown as import('../../../../src/renderer/components/grid/gridTable').GridTableHeader
}

function makeProps(overrides: Partial<GridHeaderRowProps> = {}): GridHeaderRowProps {
  const cols = [makeColumn(1, 'Name'), makeColumn(2, 'Status')]
  return {
    headers: cols.map(c => makeHeader(c)),
    columns: cols,
    columnIds: cols.map(c => `col_${c.id}`),
    rowHeight: 44,
    acuityEnabled: false,
    acuitySortDir: null,
    setAcuitySortDir: vi.fn(),
    selectedRowIds: new Set<number>(),
    selectableRowIds: [],
    setSelectedRowIds: vi.fn(),
    colSensors: [],
    onColumnDragEnd: vi.fn(),
    autoFitColumn: vi.fn(),
    frozenLeftOffsets: new Map(),
    frozenColumnCount: 0,
    setFrozenColumnCount: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => { setWords() })

describe('GridHeaderRow', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('renders without crashing', () => {
    const { container } = render(<GridHeaderRow {...makeProps()} />)
    expect(container.querySelector('[role="row"]')).toBeTruthy()
  })

  it('renders column headers', () => {
    render(<GridHeaderRow {...makeProps()} />)
    expect(screen.getByTestId('col-header-Name')).toBeTruthy()
    expect(screen.getByTestId('col-header-Status')).toBeTruthy()
  })

  it('renders select all checkbox', () => {
    render(<GridHeaderRow {...makeProps()} />)
    const checkbox = screen.getByRole('checkbox')
    expect(checkbox).toBeTruthy()
    expect(checkbox.getAttribute('aria-label')).toMatch(/^Select all (?!rows)/)
  })

  it('select all ticks only the records on screen (AUDIT-139)', () => {
    const setSelectedRowIds = vi.fn()
    render(<GridHeaderRow {...makeProps({ selectableRowIds: [1, 2], setSelectedRowIds })} />)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(setSelectedRowIds).toHaveBeenCalledWith(new Set([1, 2]))
  })

  it('shows all ticked when every record on screen is ticked, even with others ticked inside a collapsed group (AUDIT-139)', () => {
    const setSelectedRowIds = vi.fn()
    render(<GridHeaderRow {...makeProps({ selectableRowIds: [1, 2], selectedRowIds: new Set([1, 2, 3]), setSelectedRowIds })} />)
    const box = screen.getByRole('checkbox')
    expect(box.getAttribute('aria-checked')).toBe('true')
    expect(box.getAttribute('aria-label')).toMatch(/^Deselect all/)
    fireEvent.click(box)
    expect(setSelectedRowIds).toHaveBeenCalledWith(new Set())
  })

  it('shows part ticked when only some records on screen are ticked', () => {
    render(<GridHeaderRow {...makeProps({ selectableRowIds: [1, 2], selectedRowIds: new Set([1]) })} />)
    expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('mixed')
  })

  it('ends with a "+" header that adds a column, like the next empty column of a spreadsheet (UX-B-03)', () => {
    const onAddColumn = vi.fn()
    render(<GridHeaderRow {...makeProps({ onAddColumn })} />)
    const headers = screen.getAllByRole('columnheader')
    const last = headers[headers.length - 1]!
    expect(last.getAttribute('aria-label')).toBe('Add a column')
    expect(last.getAttribute('aria-colindex')).toBe(String(headers.length))
    fireEvent.click(screen.getByTestId('add-column-header'))
    expect(onAddColumn).toHaveBeenCalledOnce()
  })

  it('has an open column, a "Starred" column and an "Actions" column, each with its own gridline and a tooltip, before the data columns (UX-B-38)', () => {
    render(<GridHeaderRow {...makeProps()} />)
    const headers = screen.getAllByRole('columnheader')
    expect(headers[1]!.getAttribute('aria-label')).toBe("Client's page")
    expect(headers[1]!.getAttribute('title')).toContain("opens the client's page")
    expect(headers[2]!.getAttribute('aria-label')).toBe('Starred')
    expect(headers[2]!.getAttribute('title')).toContain('Star a client')
    expect(headers[3]!.getAttribute('aria-label')).toBe('Actions')
    expect(headers[3]!.getAttribute('title')).toContain('duplicate, archive, move')
    expect(headers.slice(0, 4).map(h => h.getAttribute('aria-colindex'))).toEqual(['1', '2', '3', '4'])
    for (const h of headers.slice(1, 4)) {
      expect(h.className).toMatch(/(^|\s)border-r(\s|$)/)
      expect(h.className).toContain('border-slate-300')
      expect((h as HTMLElement).style.width).toBe('44px')
    }
  })

  it('gives each column a 12 px resize handle on its right border; a double-click fits the column (Q3)', () => {
    const autoFitColumn = vi.fn()
    render(<GridHeaderRow {...makeProps({ autoFitColumn })} />)
    const handles = screen.getAllByTestId('column-resize-handle')
    expect(handles).toHaveLength(2)
    const h = handles[0]!
    // Straddles the border (-6 px) and is above the next header, so it's easy to grab
    expect(h.className).toMatch(/(^|\s)w-3(\s|$)/)
    expect(h.className).toMatch(/(^|\s)-right-1\.5(\s|$)/)
    expect(h.className).toMatch(/(^|\s)z-20(\s|$)/)
    expect(h.className).toContain('cursor-col-resize')
    expect(h.getAttribute('title')).toBe('Drag to resize · Double-click to fit')
    // The bar shows on the header's hover and turns blue on the handle's
    const bar = h.firstElementChild!
    expect(bar.className).toContain('group-hover/colhead:bg-slate-400')
    expect(bar.className).toContain('group-hover/resize:bg-blue-500')
    fireEvent.doubleClick(h)
    expect(autoFitColumn).toHaveBeenCalledWith(1)
  })

  it('does not render acuity header when disabled', () => {
    const { container } = render(<GridHeaderRow {...makeProps()} />)
    expect(container.textContent).not.toContain('Ac')
  })
})
