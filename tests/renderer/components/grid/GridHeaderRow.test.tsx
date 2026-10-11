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
  PROFILE_BTN_WIDTH: 32,
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
import type { GridRow, Column } from '../../../../src/shared/types'
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
  } as unknown as import('@tanstack/react-table').Header<GridRow, unknown>
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
    filteredRows: [],
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

  it('select all toggles all filtered rows', () => {
    const rows = [
      { row_id: 1, position: 0 } as GridRow,
      { row_id: 2, position: 1 } as GridRow,
    ]
    const setSelectedRowIds = vi.fn()
    render(<GridHeaderRow {...makeProps({ filteredRows: rows, setSelectedRowIds })} />)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(setSelectedRowIds).toHaveBeenCalled()
  })

  it('does not render acuity header when disabled', () => {
    const { container } = render(<GridHeaderRow {...makeProps()} />)
    expect(container.textContent).not.toContain('Ac')
  })
})
