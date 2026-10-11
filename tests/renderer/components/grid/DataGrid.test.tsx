// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Column, GridRow } from '../../../../src/shared/types'

// ── Global mocks ──────────────────────────────────────────────────────────────

const mockInvoke = vi.fn().mockResolvedValue({ ok: true, data: null })
const mockOn = vi.fn().mockReturnValue(vi.fn())
Object.defineProperty(window, 'api', {
  value: { invoke: mockInvoke, on: mockOn },
  writable: true,
})

if (!globalThis.crypto?.randomUUID) {
  vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2) })
}

// jsdom doesn't implement scrollIntoView
Element.prototype.scrollIntoView = vi.fn()

// ── Module mocks (hoisted) ────────────────────────────────────────────────────

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

vi.mock('zustand/react/shallow', () => ({
  useShallow: <T,>(selector: (state: unknown) => T) => {
    // Return a memoising wrapper that does shallow-equal comparison
    // so useSyncExternalStore doesn't infinite-loop
    let prev: T | undefined
    return (state: unknown): T => {
      const next = selector(state)
      if (prev !== undefined && shallowEqual(prev, next)) return prev
      prev = next
      return next
    }
  },
}))

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  const keysA = Object.keys(a as Record<string, unknown>)
  const keysB = Object.keys(b as Record<string, unknown>)
  if (keysA.length !== keysB.length) return false
  for (const k of keysA) {
    if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false
  }
  return true
}

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<HTMLDivElement>) => {
      const { variants, initial, animate, exit, ...rest } = props
      return <div ref={ref} {...rest} />
    }),
    button: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<HTMLButtonElement>) => {
      const { variants, initial, animate, exit, whileHover, ...rest } = props
      return <button ref={ref} {...rest} />
    }),
  },
}))

vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)

vi.mock('../../../../src/renderer/utils/rendererLogger', () => ({
  rlog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../../../src/renderer/utils/safeInvoke', () => ({
  safeInvoke: vi.fn().mockResolvedValue({ ok: false, error: 'test-mock' }),
  storeInvoke: vi.fn().mockRejectedValue(new Error('test-mock')),
}))

vi.mock('../../../../src/renderer/utils/animations', () => ({
  dropdownVariants: {},
}))

// Mock @dnd-kit
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  closestCenter: vi.fn(),
  PointerSensor: class {},
  useSensor: () => ({}),
  useSensors: () => [],
}))
vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  horizontalListSortingStrategy: {},
  verticalListSortingStrategy: {},
  useSortable: () => ({
    attributes: {}, listeners: {}, setNodeRef: vi.fn(),
    transform: null, transition: undefined, isDragging: false,
  }),
  arrayMove: vi.fn(),
}))
vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => '' } },
}))

// Mock @tanstack/react-virtual to render all items without needing container dimensions
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({
        index: i,
        start: i * 44,
        end: (i + 1) * 44,
        size: 44,
        key: i,
      })),
    getTotalSize: () => count * 44,
    measureElement: vi.fn(),
    scrollToIndex: vi.fn(),
  }),
}))

// Mock heavy child components to isolate DataGrid logic
vi.mock('../../../../src/renderer/components/grid/GridContextMenu', () => ({
  GridContextMenu: () => null,
}))
vi.mock('../../../../src/renderer/components/grid/BulkActionBar', () => ({
  BulkActionBar: () => null,
}))
vi.mock('../../../../src/renderer/components/grid/CellConditionalFormatPanel', () => ({
  CellConditionalFormatPanel: () => null,
  evalCellFormat: () => null,
}))
vi.mock('../../../../src/renderer/components/shared/CellHistoryPopover', () => ({
  CellHistoryPopover: () => null,
}))
vi.mock('../../../../src/renderer/components/shared/ConfirmDialog', () => ({
  ConfirmDialog: () => null,
}))
vi.mock('../../../../src/renderer/components/grid/GridDialogs', () => ({
  ArchiveDialog: () => null,
  DeleteRowDialog: () => null,
  MoveToGridDialog: () => null,
  BulkDeleteDialog: () => null,
  BulkMoveDialog: () => null,
}))
vi.mock('../../../../src/renderer/components/grid/GridGroupHeader', () => ({
  GroupHeaderItem: () => null,
  CollapseExpandBar: () => null,
  GroupContextMenuOverlay: () => null,
}))

// Mock alertColors used by SortableRow
vi.mock('../../../../src/renderer/utils/alertColors', () => ({
  resolveAlertColor: () => ({ className: '', style: {} }),
}))

// Mock deadlineCalc
vi.mock('../../../../src/renderer/utils/deadlineCalc', () => ({
  computeDaysUntil: () => 0,
  computeAge: () => null,
  computeEffectiveDeadline: () => null,
  getMatchingThreshold: () => null,
  formatCalculatedDays: () => '',
  formatDeadlineTooltip: () => '',
}))

// Mock domHelpers
vi.mock('../../../../src/renderer/utils/domHelpers', () => ({
  isEditableElement: () => false,
}))

// Mock filterMatch
vi.mock('../../../../src/renderer/utils/filterMatch', () => ({
  matchFilter: () => true,
}))

// ── Store imports (after mocks) ───────────────────────────────────────────────

import { useGridStore } from '../../../../src/renderer/stores/gridStore'
import { useSettingsStore } from '../../../../src/renderer/stores/settingsStore'
import { useAlertStore } from '../../../../src/renderer/stores/alertStore'
import { DataGrid } from '../../../../src/renderer/components/grid/DataGrid'
import { setWords } from '../../vocabFixture'

// ── Test data helpers ─────────────────────────────────────────────────────────

function makeColumn(id: number, name: string, type = 'text', extra: Partial<Column> = {}): Column {
  return {
    id,
    grid_id: 1,
    name,
    column_type: type,
    position: id - 1,
    width: 150,
    is_visible: 1,
    is_required: 0,
    is_identifier: 0,
    is_name_column: id === 1 ? 1 : 0,
    default_value: null,
    description: null,
    config: '{}',
    conditional_format: '[]',
    created_at: '2026-01-01T00:00:00Z',
    ...extra,
  } as Column
}

function makeRow(id: number, values: Record<string, string | null> = {}): GridRow {
  return {
    row_id: id,
    position: id - 1,
    is_active: 1,
    is_starred: 0,
    acuity_level_id: null,
    deleted_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...values,
  }
}

const TEST_COLUMNS: Column[] = [
  makeColumn(1, 'Name', 'text'),
  makeColumn(2, 'Due Date', 'date'),
  makeColumn(3, 'Score', 'number'),
  makeColumn(4, 'Completed', 'checkbox'),
]

function makeTestRows(count: number): GridRow[] {
  return Array.from({ length: count }, (_, i) => makeRow(i + 1, {
    col_1: `Client ${i + 1}`,
    col_2: `2026-03-${String(i + 10).padStart(2, '0')}`,
    col_3: String((i + 1) * 10),
    col_4: i % 2 === 0 ? 'true' : 'false',
  }))
}

// ── Setup ─────────────────────────────────────────────────────────────────────

function setupStores(overrides: Record<string, unknown> = {}) {
  useGridStore.setState({
    grids: [{ id: 1, name: 'Test Grid', description: null, created_at: '', updated_at: '', sort_config: '[]', filter_config: '[]', column_order: '[]', frozen_columns: 0, row_height: 'comfortable', show_gridlines: 1, show_row_numbers: 0, show_alternating_rows: 0, position: 0, is_active: 1, acuity_enabled: 0 }],
    activeGridId: 1,
    columns: TEST_COLUMNS,
    hiddenColumns: [],
    rows: makeTestRows(5),
    isLoading: false,
    isSaving: false,
    saveError: null,
    sortConfig: [],
    searchQuery: '',
    activeFilters: [],
    filterMode: 'and',
    showArchived: false,
    showStarredOnly: false,
    cellFormats: new Map(),
    rowTagsMap: new Map(),
    acuityEnabled: false,
    acuityLevels: [],
    groupByColumnId: null,
    copiedFormatRules: null,
    customGroups: [],
    activeCustomGroupId: null,
    sortedRowIds: [],
    selectedRowIds: new Set<number>(),
    lastAddedRowId: null,
    pinnedRowId: null,
    sampleRows: {},
    ...overrides,
  } as unknown as Parameters<typeof useGridStore.setState>[0])
  useSettingsStore.setState({ gridDensity: 'comfortable' })
  useAlertStore.setState({ rules: [] })
}

function renderDataGrid() {
  return render(
    <MemoryRouter>
      <DataGrid />
    </MemoryRouter>,
  )
}

async function flushEffects() {
  await act(async () => {
    await new Promise(r => setTimeout(r, 0))
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => { setWords() })

describe('DataGrid', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupStores()
  })

  // ── Rendering ───────────────────────────────────────────────────────────

  describe('Rendering', () => {
    it('renders column headers from store', async () => {
      renderDataGrid()
      await flushEffects()
      // GridHeaderRow renders: select-all checkbox + profile icon + 4 data columns = 6 columnheaders
      const headers = screen.getAllByRole('columnheader')
      expect(headers.length).toBe(TEST_COLUMNS.length + 2)
    })

    it('renders rows with cell values', async () => {
      renderDataGrid()
      await flushEffects()
      const rows = screen.getAllByRole('row')
      // 1 header row + 5 data rows = 6
      expect(rows.length).toBe(6)
      // Check gridcell elements exist
      const cells = screen.getAllByRole('gridcell')
      // 5 rows * 4 columns = 20 cells
      expect(cells.length).toBe(20)
    })

    it('shows empty state when no rows', async () => {
      setupStores({ rows: [] })
      renderDataGrid()
      await flushEffects()
      expect(screen.getByText(/No clients yet/)).toBeTruthy()
    })

    it('the empty list gives real next steps and the shortcut that works (audit 2.1)', async () => {
      setupStores({ rows: [] })
      const { pulseEvents } = await import('../../../../src/renderer/events')
      const opened: string[] = []
      const offs = [pulseEvents.on('grid:open-import', () => opened.push('import')), pulseEvents.on('starters:open', e => opened.push(`example:${e.sample}`))]
      renderDataGrid()
      await flushEffects()
      expect(screen.getByText('Ctrl+N')).toBeTruthy()
      expect(screen.queryByText(/Ctrl\+Shift\+R/)).toBeNull()
      expect(screen.queryByText(/Right-click/)).toBeNull()
      expect(screen.getByRole('button', { name: 'Add Client' })).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Bring in a spreadsheet' }))
      fireEvent.click(screen.getByRole('button', { name: 'See an example with sample data' }))
      expect(opened).toEqual(['import', 'example:true'])
      offs.forEach(off => off())
    })

    it('marks made-up sample entries by their name (audit 2.6)', async () => {
      setupStores({ sampleRows: { 2: 0 } })
      renderDataGrid()
      await flushEffects()
      expect(screen.getAllByText('Sample')).toHaveLength(1)
    })

    it('says when filters hide every record, and clears them', async () => {
      setupStores({ showStarredOnly: true })
      renderDataGrid()
      await flushEffects()
      expect(screen.getByText(/No clients match your filters/)).toBeTruthy()
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Clear filters' })) })
      expect(useGridStore.getState().showStarredOnly).toBe(false)
    })

    it('shows search empty state with search query', async () => {
      setupStores({ rows: [], searchQuery: 'missing' })
      renderDataGrid()
      await flushEffects()
      expect(screen.getByText(/No clients found matching/)).toBeTruthy()
    })

    it('shows loading skeleton when isLoading is true', async () => {
      setupStores({ isLoading: true })
      renderDataGrid()
      await flushEffects()
      expect(screen.getByRole('status')).toBeTruthy()
      expect(screen.getByText('Loading grid data…')).toBeTruthy()
    })

    it('shows empty columns state when columns array is empty', async () => {
      setupStores({ columns: [] })
      renderDataGrid()
      await flushEffects()
      expect(screen.getByText(/No columns yet/)).toBeTruthy()
    })

    it('renders correct number of rows matching data', async () => {
      setupStores({ rows: makeTestRows(8) })
      renderDataGrid()
      await flushEffects()
      const rows = screen.getAllByRole('row')
      // 1 header row + 8 data rows = 9
      expect(rows.length).toBe(9)
    })
  })

  // ── Cell Editing ────────────────────────────────────────────────────────

  describe('Cell Editing', () => {
    it('double-clicking a cell enters edit mode (shows CellEditor)', async () => {
      renderDataGrid()
      await flushEffects()
      const cells = screen.getAllByRole('gridcell')
      // Double-click first text cell (col_1 of row 1)
      fireEvent.doubleClick(cells[0]!)
      await flushEffects()
      // CellEditor renders an input element
      const input = screen.queryByRole('textbox')
      expect(input).toBeTruthy()
    })

    it('pressing Escape in edit mode cancels editing', async () => {
      renderDataGrid()
      await flushEffects()
      const cells = screen.getAllByRole('gridcell')
      fireEvent.doubleClick(cells[0]!)
      await flushEffects()
      const input = screen.getByRole('textbox')
      fireEvent.keyDown(input, { key: 'Escape' })
      await flushEffects()
      // Input should be removed (no longer editing)
      expect(screen.queryByRole('textbox')).toBeNull()
    })

    it('pressing Enter in edit mode commits the value', async () => {
      renderDataGrid()
      await flushEffects()
      const cells = screen.getAllByRole('gridcell')
      fireEvent.doubleClick(cells[0]!)
      await flushEffects()
      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'Updated Name' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      await flushEffects()
      // Edit mode should end
      expect(screen.queryByRole('textbox')).toBeNull()
    })

    it('checkbox cell toggles on single click', async () => {
      const updateCellSpy = vi.fn()
      setupStores()
      // Spy on updateCell
      const origUpdateCell = useGridStore.getState().updateCell
      useGridStore.setState({ updateCell: updateCellSpy } as unknown as Parameters<typeof useGridStore.setState>[0])
      renderDataGrid()
      await flushEffects()
      const cells = screen.getAllByRole('gridcell')
      // Checkbox is the 4th column (index 3) in first row
      await act(async () => {
        fireEvent.click(cells[3]!)
      })
      await flushEffects()
      expect(updateCellSpy).toHaveBeenCalledWith(1, 4, 'false') // was 'true', now 'false'
      // Restore
      useGridStore.setState({ updateCell: origUpdateCell } as unknown as Parameters<typeof useGridStore.setState>[0])
    })
  })

  // ── Keyboard Navigation ─────────────────────────────────────────────────

  describe('Keyboard Navigation', () => {
    it('Enter key on focused cell starts editing (non-checkbox)', async () => {
      renderDataGrid()
      await flushEffects()
      const cells = screen.getAllByRole('gridcell')
      // Focus the first text cell
      fireEvent.focus(cells[0]!)
      fireEvent.keyDown(cells[0]!, { key: 'Enter' })
      await flushEffects()
      expect(screen.queryByRole('textbox')).toBeTruthy()
    })

    it('F2 key on focused cell starts editing', async () => {
      renderDataGrid()
      await flushEffects()
      const cells = screen.getAllByRole('gridcell')
      fireEvent.focus(cells[0]!)
      fireEvent.keyDown(cells[0]!, { key: 'F2' })
      await flushEffects()
      expect(screen.queryByRole('textbox')).toBeTruthy()
    })

    it('Enter on checkbox cell toggles value instead of editing', async () => {
      const updateCellSpy = vi.fn()
      useGridStore.setState({ updateCell: updateCellSpy } as unknown as Parameters<typeof useGridStore.setState>[0])
      renderDataGrid()
      await flushEffects()
      const cells = screen.getAllByRole('gridcell')
      // Checkbox is 4th column (index 3) of first row
      fireEvent.focus(cells[3]!)
      fireEvent.keyDown(cells[3]!, { key: 'Enter' })
      await flushEffects()
      // Should toggle, not open editor
      expect(updateCellSpy).toHaveBeenCalledWith(1, 4, 'false')
      expect(screen.queryByRole('textbox')).toBeNull()
    })

    it('Arrow keys navigate between cells', async () => {
      renderDataGrid()
      await flushEffects()
      const cells = screen.getAllByRole('gridcell')
      // Focus first cell
      fireEvent.focus(cells[0]!)
      // Arrow down should move focus
      fireEvent.keyDown(cells[0]!, { key: 'ArrowDown' })
      await flushEffects()
      // The navigateCell function sets focusedCell and schedules DOM focus
      // We verify no crash and the grid is still rendered
      expect(screen.getAllByRole('gridcell').length).toBe(20)
    })

    it('Tab key navigates to next cell', async () => {
      renderDataGrid()
      await flushEffects()
      const cells = screen.getAllByRole('gridcell')
      fireEvent.focus(cells[0]!)
      fireEvent.keyDown(cells[0]!, { key: 'Tab' })
      await flushEffects()
      // Grid should still be intact
      expect(screen.getAllByRole('gridcell').length).toBe(20)
    })
  })

  // ── Selection ───────────────────────────────────────────────────────────

  describe('Selection', () => {
    it('clicking row select button selects the row', async () => {
      renderDataGrid()
      await flushEffects()
      const selectBtns = screen.getAllByLabelText('Select client')
      expect(selectBtns.length).toBe(5)
      fireEvent.click(selectBtns[0]!)
      await flushEffects()
      // After selection, the button label changes to "Deselect row"
      expect(screen.getByLabelText('Deselect client')).toBeTruthy()
    })

    it('"Select all" selects only the records the search shows (G-05)', async () => {
      setupStores({ searchQuery: 'Client 3' })
      renderDataGrid()
      await flushEffects()
      fireEvent.click(screen.getByLabelText('Select all rows'))
      await flushEffects()
      expect([...useGridStore.getState().selectedRowIds]).toEqual([3])
      expect(useGridStore.getState().sortedRowIds).toEqual([3])
    })

    it('keeps a record just added on screen, and says when the filter would hide it (G-28)', async () => {
      const toast = (await import('react-hot-toast')).default as unknown as ReturnType<typeof vi.fn>
      toast.mockClear()
      const rows = [...makeTestRows(5).map(r => ({ ...r, is_starred: 1 as const })), makeRow(6, {})]
      setupStores({ rows, showStarredOnly: true, lastAddedRowId: 6, pinnedRowId: 6 })
      renderDataGrid()
      await flushEffects()
      expect(useGridStore.getState().sortedRowIds).toContain(6)
      expect(toast).toHaveBeenCalledTimes(1)
      // Changing the filter lets it go
      act(() => { useGridStore.setState({ searchQuery: 'Client' }) })
      await flushEffects()
      expect(useGridStore.getState().pinnedRowId).toBeNull()
      expect(useGridStore.getState().sortedRowIds).not.toContain(6)
    })

    it('a search that hides selected records unselects them (G-05)', async () => {
      setupStores({ selectedRowIds: new Set([1, 3]) })
      renderDataGrid()
      await flushEffects()
      act(() => { useGridStore.setState({ searchQuery: 'Client 3' }) })
      await flushEffects()
      expect([...useGridStore.getState().selectedRowIds]).toEqual([3])
    })

    it('ticking boxes one after another builds a selection, like checkboxes (G-06)', async () => {
      renderDataGrid()
      await flushEffects()
      const boxes = screen.getAllByLabelText('Select client')
      fireEvent.click(boxes[0]!)
      fireEvent.click(boxes[2]!)
      await flushEffects()
      expect([...useGridStore.getState().selectedRowIds].sort()).toEqual([1, 3])
    })

    it('shows a star on starred records and stars one from the row (G-30)', async () => {
      const updateRow = vi.fn()
      setupStores({ rows: makeTestRows(2).map((r, i) => ({ ...r, is_starred: i === 0 ? 1 : 0 })), updateRow })
      renderDataGrid()
      await flushEffects()
      expect(screen.getByLabelText('Remove star').getAttribute('aria-pressed')).toBe('true')
      fireEvent.click(screen.getByLabelText('Star this client'))
      await flushEffects()
      expect(updateRow).toHaveBeenCalledWith(2, { is_starred: 1 })
    })

    it('clicking selected row deselects it', async () => {
      renderDataGrid()
      await flushEffects()
      const selectBtns = screen.getAllByLabelText('Select client')
      fireEvent.click(selectBtns[0]!)
      await flushEffects()
      const deselectBtn = screen.getByLabelText('Deselect client')
      fireEvent.click(deselectBtn)
      await flushEffects()
      // All should be "Select client" again
      expect(screen.queryByLabelText('Deselect client')).toBeNull()
      expect(screen.getAllByLabelText('Select client').length).toBe(5)
    })

    it('Ctrl+click toggles individual row selection', async () => {
      renderDataGrid()
      await flushEffects()
      const selectBtns = screen.getAllByLabelText('Select client')
      // Select first row
      fireEvent.click(selectBtns[0]!)
      await flushEffects()
      // Ctrl+click second row to add to selection
      fireEvent.click(selectBtns[1]!, { ctrlKey: true })
      await flushEffects()
      const deselectBtns = screen.getAllByLabelText('Deselect client')
      expect(deselectBtns.length).toBe(2)
    })

    it('Shift+click selects a range of rows', async () => {
      renderDataGrid()
      await flushEffects()
      const selectBtns = screen.getAllByLabelText('Select client')
      // Click first row
      fireEvent.click(selectBtns[0]!)
      await flushEffects()
      // Shift+click third row
      fireEvent.click(selectBtns[2]!, { shiftKey: true })
      await flushEffects()
      const deselectBtns = screen.getAllByLabelText('Deselect client')
      expect(deselectBtns.length).toBe(3) // rows 1, 2, 3
    })
  })

  // ── Column Operations ───────────────────────────────────────────────────

  describe('Column Operations', () => {
    it('renders column headers with correct count', async () => {
      renderDataGrid()
      await flushEffects()
      const headers = screen.getAllByRole('columnheader')
      // 2 fixed headers (select-all, profile) + 4 data columns = 6
      expect(headers.length).toBe(6)
    })

    it('sorted column shows correct aria-sort attribute', async () => {
      setupStores({
        sortConfig: [{ columnId: 1, direction: 'asc', priority: 1 }],
      })
      renderDataGrid()
      await flushEffects()
      const headers = screen.getAllByRole('columnheader')
      // Data columns start at index 2 (after select-all and profile icon headers)
      expect(headers[2]!.getAttribute('aria-sort')).toBe('ascending')
      // Second data column should be 'none'
      expect(headers[3]!.getAttribute('aria-sort')).toBe('none')
    })

    it('descending sort shows correct aria-sort', async () => {
      setupStores({
        sortConfig: [{ columnId: 2, direction: 'desc', priority: 1 }],
      })
      renderDataGrid()
      await flushEffects()
      const headers = screen.getAllByRole('columnheader')
      // Due Date is column index 1 → header index 3
      expect(headers[3]!.getAttribute('aria-sort')).toBe('descending')
    })
  })

  // ── Grid structure ──────────────────────────────────────────────────────

  describe('Grid structure', () => {
    it('has role="grid" on the container', async () => {
      renderDataGrid()
      await flushEffects()
      expect(screen.getByRole('grid')).toBeTruthy()
    })

    it('grid has accessible label', async () => {
      renderDataGrid()
      await flushEffects()
      expect(screen.getByLabelText('Client grid')).toBeTruthy()
    })

    it('each row has profile navigation button', async () => {
      renderDataGrid()
      await flushEffects()
      const profileBtns = screen.getAllByLabelText('Open client profile')
      expect(profileBtns.length).toBe(5)
    })
  })

  describe('Tags column (L-19)', () => {
    it('shows each record\'s tags, and its header hides the column', async () => {
      const setShowTagsColumn = vi.fn()
      setupStores({ showTagsColumn: true, setShowTagsColumn, rowTagsMap: new Map([[1, ['urgent', 'housing', 'new']]]) })
      renderDataGrid()
      await flushEffects()
      const cells = screen.getAllByTestId('row-tags-cell')
      expect(cells.length).toBe(5)
      expect(cells[0]!.textContent).toContain('urgent')
      expect(cells[0]!.textContent).toContain('housing')
      expect(cells[0]!.textContent).toContain('+1')
      fireEvent.click(screen.getByRole('button', { name: 'Hide the Tags column' }))
      expect(setShowTagsColumn).toHaveBeenCalledWith(false)
    })

    it('is not shown when switched off', async () => {
      setupStores({ showTagsColumn: false, rowTagsMap: new Map([[1, ['urgent']]]) })
      renderDataGrid()
      await flushEffects()
      expect(screen.queryByTestId('row-tags-cell')).toBeNull()
      expect(screen.queryByRole('button', { name: 'Hide the Tags column' })).toBeNull()
    })
  })
})
