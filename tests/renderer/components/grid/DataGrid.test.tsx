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
  useReducedMotionConfig: () => false,
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
  MoveToGridDialog: () => null,
  BulkMoveDialog: () => null,
  trashRows: vi.fn(),
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
  formatResultTooltip: () => '',
  deadlineChipText: () => null,
  // Days left come from the counts in the deadline context, like a quota
  evaluateRuleForRow: (_rule: unknown, _v: unknown, row: { row_id: number }, colId: number) => {
    const n = useGridStore.getState().deadlineContext?.quota?.[`${row.row_id}:${colId}`]
    return { state: 'upcoming', due: n == null ? null : '2026-01-01', daysUntil: n ?? null }
  },
}))

// Mock domHelpers
vi.mock('../../../../src/renderer/utils/domHelpers', () => ({
  isEditableElement: () => false,
}))

// Mock filterMatch
vi.mock('../../../../src/renderer/utils/filterMatch', () => ({
  matchFilter: vi.fn(() => true),
}))

// ── Store imports (after mocks) ───────────────────────────────────────────────

import { useGridStore } from '../../../../src/renderer/stores/gridStore'
import { useSettingsStore } from '../../../../src/renderer/stores/settingsStore'
import { useAlertStore } from '../../../../src/renderer/stores/alertStore'
import { useProfileStore } from '../../../../src/renderer/stores/profileStore'
import { DataGrid } from '../../../../src/renderer/components/grid/DataGrid'
import { pulseEvents } from '../../../../src/renderer/events'
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
    loadedGridId: null,
    loadError: null,
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

/** The list's own cells (each row also has select, open/star, priority and tags cells before them) */
function dataCells(): HTMLElement[] {
  return screen.getAllByRole('gridcell').filter(c => c.hasAttribute('data-col-id'))
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
      // GridHeaderRow renders: select-all checkbox + open + star + menu + 4 data columns + "Add a column" = 9 columnheaders
      const headers = screen.getAllByRole('columnheader')
      expect(headers.length).toBe(TEST_COLUMNS.length + 5)
    })

    it('renders rows with cell values', async () => {
      renderDataGrid()
      await flushEffects()
      const rows = screen.getAllByRole('row')
      // 1 header row + 5 data rows = 6
      expect(rows.length).toBe(6)
      // Check gridcell elements exist: 5 rows * 4 columns = 20 data cells
      expect(dataCells().length).toBe(20)
      // and each row has a cell for every header, select, open, star and menu included (AUDIT-012): 5 * 8
      expect(screen.getAllByRole('gridcell').length).toBe(40)
    })

    it('is a single Tab stop: only one cell can be tabbed to (G-32)', async () => {
      renderDataGrid()
      await flushEffects()
      const cells = dataCells()
      const stops = cells.filter(c => c.tabIndex === 0)
      expect(stops).toHaveLength(1)
      expect(stops[0]).toBe(cells[0])
      // Focusing another cell moves the stop there
      act(() => { fireEvent.focus(cells[5]!) })
      const after = dataCells()
      expect(after.filter(c => c.tabIndex === 0)).toEqual([after[5]])
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

    it('filters see the columns a saved view hides (bug sweep S3)', async () => {
      const { matchFilter } = await import('../../../../src/renderer/utils/filterMatch')
      const hidden = makeColumn(9, 'Consent', 'checkbox', { is_visible: 0 })
      setupStores({ hiddenColumns: [hidden], activeFilters: [{ columnId: 9, operator: 'equals', value: 'false' }] })
      vi.mocked(matchFilter).mockClear()
      renderDataGrid()
      await flushEffects()
      const cols = vi.mocked(matchFilter).mock.calls[0]![2]
      expect(cols.map(c => c.id)).toContain(9)
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
      expect(screen.getByText('Loading…')).toBeTruthy()
    })

    it('keeps the table on screen while the open list reloads (AUDIT-039)', async () => {
      setupStores({ loadedGridId: 1 })
      const { container } = renderDataGrid()
      await flushEffects()
      const scroller = container.querySelector('.overflow-auto') as HTMLDivElement
      scroller.scrollTop = 600
      const cell = dataCells()[5]!
      act(() => { cell.focus() })
      await act(async () => { useGridStore.setState({ isLoading: true }) })
      expect(screen.queryByText('Loading…')).toBeNull()
      expect(container.querySelector('.overflow-auto')).toBe(scroller)
      expect(scroller.scrollTop).toBe(600)
      await act(async () => { useGridStore.setState({ isLoading: false, rows: makeTestRows(5) }) })
      expect(container.querySelector('.overflow-auto')).toBe(scroller)
      expect(document.activeElement).toBe(dataCells()[5])
    })

    it('back from a record, scrolls to where this list was once its records arrive, then forgets it (AUDIT-129)', async () => {
      useProfileStore.setState({ savedScroll: { gridId: 1, top: 300 } })
      setupStores({ isLoading: true, loadedGridId: null })
      const { container } = renderDataGrid()
      await flushEffects()
      expect(useProfileStore.getState().savedScroll).not.toBeNull()
      await act(async () => { useGridStore.setState({ isLoading: false, loadedGridId: 1 }) })
      const scroller = container.querySelector('.overflow-auto') as HTMLDivElement
      expect(scroller.scrollTop).toBe(300)
      expect(useProfileStore.getState().savedScroll).toBeNull()
    })

    it('does not use another list\'s scroll position (AUDIT-129)', async () => {
      useProfileStore.setState({ savedScroll: { gridId: 2, top: 300 } })
      setupStores({ loadedGridId: 1 })
      const { container } = renderDataGrid()
      await flushEffects()
      expect((container.querySelector('.overflow-auto') as HTMLDivElement).scrollTop).toBe(0)
      expect(useProfileStore.getState().savedScroll).toBeNull()
    })

    it('says when a list could not be opened, and tries again (AUDIT-041)', async () => {
      const loadGrid = vi.fn().mockResolvedValue(undefined)
      setupStores({ columns: [], rows: [], loadError: "We couldn't open this caseload.", loadGrid })
      renderDataGrid()
      await flushEffects()
      expect(screen.getByRole('alert').textContent).toContain("We couldn't open this caseload.")
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
      expect(loadGrid).toHaveBeenCalledWith(1)
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
      const cells = dataCells()
      // Double-click first text cell (col_1 of row 1)
      fireEvent.doubleClick(cells[0]!)
      await flushEffects()
      // CellEditor renders an input element
      const input = screen.queryByRole('textbox')
      expect(input).toBeTruthy()
    })

    it('says when editing starts and stops, naming the column (AUDIT-043)', async () => {
      renderDataGrid()
      await flushEffects()
      fireEvent.doubleClick(dataCells()[0]!)
      await flushEffects()
      expect(screen.getByTestId('grid-announcer').textContent).toBe('Editing Name')
      expect(screen.getByRole('textbox', { name: 'Name' })).toBeTruthy()
      fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
      await flushEffects()
      expect(screen.getByTestId('grid-announcer').textContent).toBe('Done editing Name')
    })

    it('Shift+Space selects the record from the keyboard, and the count is announced (AUDIT-057)', async () => {
      renderDataGrid()
      await flushEffects()
      const cell = dataCells()[0]!
      fireEvent.focus(cell)
      fireEvent.keyDown(cell, { key: ' ', shiftKey: true })
      await flushEffects()
      expect([...useGridStore.getState().selectedRowIds]).toEqual([1])
      expect(screen.getAllByRole('row')[1]!.getAttribute('aria-selected')).toBe('true')
      expect(screen.getByTestId('grid-announcer').textContent).toBe('1 client selected')
      fireEvent.keyDown(dataCells()[0]!, { key: ' ', shiftKey: true })
      await flushEffects()
      expect(useGridStore.getState().selectedRowIds.size).toBe(0)
      expect(screen.getByTestId('grid-announcer').textContent).toBe('Nothing selected')
    })

    it('pressing Escape in edit mode cancels editing', async () => {
      renderDataGrid()
      await flushEffects()
      const cells = dataCells()
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
      const cells = dataCells()
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
      const cells = dataCells()
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
      const cells = dataCells()
      // Focus the first text cell
      fireEvent.focus(cells[0]!)
      fireEvent.keyDown(cells[0]!, { key: 'Enter' })
      await flushEffects()
      expect(screen.queryByRole('textbox')).toBeTruthy()
    })

    it('F2 key on focused cell starts editing', async () => {
      renderDataGrid()
      await flushEffects()
      const cells = dataCells()
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
      const cells = dataCells()
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
      const cells = dataCells()
      // Focus first cell
      fireEvent.focus(cells[0]!)
      // Arrow down should move focus
      fireEvent.keyDown(cells[0]!, { key: 'ArrowDown' })
      await flushEffects()
      // The navigateCell function sets focusedCell and schedules DOM focus
      // We verify no crash and the grid is still rendered
      expect(dataCells().length).toBe(20)
    })

    it('Left from the first column reaches the priority badge, and Right goes back (AUDIT-045)', async () => {
      setupStores({
        acuityEnabled: true,
        acuityLevels: [{ id: 1, grid_id: 1, name: 'High', abbreviation: 'H', points: 3, color: '#dc2626', position: 0, created_at: '' }],
      })
      renderDataGrid()
      await flushEffects()
      const first = dataCells()[0]!
      act(() => { first.focus() })
      fireEvent.keyDown(first, { key: 'ArrowLeft' })
      const badge = screen.getAllByRole('button', { name: /^Set acuity level$/ })[0]!
      expect(document.activeElement).toBe(badge)
      fireEvent.keyDown(badge, { key: 'ArrowDown' })
      expect(document.activeElement).toBe(screen.getAllByRole('button', { name: /^Set acuity level$/ })[1])
      fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' })
      expect(document.activeElement).toBe(dataCells()[TEST_COLUMNS.length])
    })

    it('Tab key navigates to next cell', async () => {
      renderDataGrid()
      await flushEffects()
      const cells = dataCells()
      fireEvent.focus(cells[0]!)
      fireEvent.keyDown(cells[0]!, { key: 'Tab' })
      await flushEffects()
      // Grid should still be intact
      expect(dataCells().length).toBe(20)
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

    it('lights the header of a column just added, and not on the first load (UX-B-30)', async () => {
      setupStores({ loadedGridId: 1 })
      renderDataGrid()
      await flushEffects()
      expect(document.querySelector('[data-flash]')).toBeNull()
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ')
      const added = { ...makeColumn(5, 'Housing status', 'text'), created_at: now } as Column
      await act(async () => { useGridStore.setState({ columns: [...TEST_COLUMNS, added] }) })
      await flushEffects()
      const lit = document.querySelector('[data-flash]')
      expect(lit).toBeTruthy()
      expect(lit!.textContent).toContain('Housing status')
    })

    it('leaves room under the last row while the bulk bar shows (UX-B-25)', async () => {
      renderDataGrid()
      await flushEffects()
      expect(screen.queryByTestId('bulk-bar-room')).toBeNull()
      fireEvent.click(screen.getAllByLabelText('Select client')[0]!)
      await flushEffects()
      expect(screen.getByTestId('bulk-bar-room')).toBeTruthy()
    })

    it('"Select all" selects only the records the search shows (G-05)', async () => {
      setupStores({ searchQuery: 'Client 3' })
      renderDataGrid()
      await flushEffects()
      fireEvent.click(screen.getByLabelText(/^Select all /))
      await flushEffects()
      expect([...useGridStore.getState().selectedRowIds]).toEqual([3])
      expect(useGridStore.getState().sortedRowIds).toEqual([3])
    })

    it('searches when the first record has every cell empty', async () => {
      // @tanstack/react-table 8 only searched columns whose first-record value was text or a number
      setupStores({ rows: [makeRow(1, { col_1: null, col_2: null, col_3: null, col_4: null }), ...makeTestRows(5).slice(1)], searchQuery: 'Client 3' })
      renderDataGrid()
      await flushEffects()
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
    it('saves a width change at once when the list is left within the half-second wait (Q-088)', async () => {
      const { safeInvoke } = await import('../../../../src/renderer/utils/safeInvoke')
      const { IPC } = await import('../../../../src/shared/ipc-channels')
      const widthCalls = () => vi.mocked(safeInvoke).mock.calls.filter(c => c[0] === IPC.COLUMN_BATCH_UPDATE_WIDTHS)
      const { unmount } = renderDataGrid()
      await flushEffects()
      act(() => { pulseEvents.emit('column:resize', { columnId: 2, change: 'wider' }) })
      expect(widthCalls()).toHaveLength(0)
      unmount()
      expect(widthCalls()).toEqual([[IPC.COLUMN_BATCH_UPDATE_WIDTHS, [{ columnId: 2, width: 190 }]]])
    })

    it('saves a pending width change to the list it was made in when switching lists (Q-088)', async () => {
      const { safeInvoke } = await import('../../../../src/renderer/utils/safeInvoke')
      const { IPC } = await import('../../../../src/shared/ipc-channels')
      const widthCalls = () => vi.mocked(safeInvoke).mock.calls.filter(c => c[0] === IPC.COLUMN_BATCH_UPDATE_WIDTHS)
      renderDataGrid()
      await flushEffects()
      act(() => { pulseEvents.emit('column:resize', { columnId: 3, change: 'narrower' }) })
      act(() => { useGridStore.setState({ activeGridId: 2, columns: [] }) })
      await flushEffects()
      expect(widthCalls()).toEqual([[IPC.COLUMN_BATCH_UPDATE_WIDTHS, [{ columnId: 3, width: 110 }]]])
    })

    it('renders column headers with correct count', async () => {
      renderDataGrid()
      await flushEffects()
      const headers = screen.getAllByRole('columnheader')
      // 4 fixed headers (select-all, open, star, menu) + 4 data columns + "Add a column" = 9
      expect(headers.length).toBe(9)
    })

    it('sorted column shows correct aria-sort attribute', async () => {
      setupStores({
        sortConfig: [{ columnId: 1, direction: 'asc', priority: 1 }],
      })
      renderDataGrid()
      await flushEffects()
      const headers = screen.getAllByRole('columnheader')
      // Data columns start at index 4 (after the select-all, open, star and menu headers)
      expect(headers[4]!.getAttribute('aria-sort')).toBe('ascending')
      // Second data column should be 'none'
      expect(headers[5]!.getAttribute('aria-sort')).toBe('none')
    })

    it('descending sort shows correct aria-sort', async () => {
      setupStores({
        sortConfig: [{ columnId: 2, direction: 'desc', priority: 1 }],
      })
      renderDataGrid()
      await flushEffects()
      const headers = screen.getAllByRole('columnheader')
      // Due Date is column index 1 → header index 5
      expect(headers[5]!.getAttribute('aria-sort')).toBe('descending')
    })

    it('sorts again by deadline when the counts arrive after the records (R1)', async () => {
      const cols = [makeColumn(1, 'Name', 'text'), makeColumn(2, 'Visits', 'date', { config: '{"alert_rule_id":9}' })]
      setupStores({
        columns: cols,
        rows: [makeRow(1, { col_1: 'Ann' }), makeRow(2, { col_1: 'Bob' }), makeRow(3, { col_1: 'Cy' })],
        sortConfig: [{ columnId: 2, direction: 'asc', priority: 1 }],
        deadlineContext: null,
      })
      useAlertStore.setState({ rules: [{ id: 9, name: 'Visits', thresholds: [], kind: 'quota', rule_config: '{}' }] } as never)
      renderDataGrid()
      await flushEffects()
      const names = () => screen.getAllByRole('row').map(r => (r.textContent ?? '').match(/Ann|Bob|Cy/)?.[0]).filter(Boolean)
      expect(names()).toEqual(['Ann', 'Bob', 'Cy'])
      await act(async () => {
        useGridStore.setState({ deadlineContext: { meter: {}, quota: { '1:2': 30, '2:2': 5, '3:2': 12 }, progress: {}, extensions: {} } } as never)
      })
      expect(names()).toEqual(['Bob', 'Cy', 'Ann'])
    })

    it('filters again by due status when the counts arrive after the records (AUDIT-011)', async () => {
      const { matchFilter } = await import('../../../../src/renderer/utils/filterMatch')
      // "Overdue" here means the count says fewer than 10 days left
      vi.mocked(matchFilter).mockImplementation(row => {
        const n = useGridStore.getState().deadlineContext?.quota?.[`${row.row_id}:2`]
        return n != null && n < 10
      })
      try {
        const cols = [makeColumn(1, 'Name', 'text'), makeColumn(2, 'Visits', 'date', { config: '{"alert_rule_id":9}' })]
        setupStores({
          columns: cols,
          rows: [makeRow(1, { col_1: 'Ann' }), makeRow(2, { col_1: 'Bob' }), makeRow(3, { col_1: 'Cy' })],
          activeFilters: [{ columnId: 2, operator: 'due_status', value: 'overdue' }],
          deadlineContext: null,
        })
        renderDataGrid()
        await flushEffects()
        const names = () => screen.queryAllByRole('row').map(r => (r.textContent ?? '').match(/Ann|Bob|Cy/)?.[0]).filter(Boolean)
        expect(names()).toEqual([])
        await act(async () => {
          useGridStore.setState({ deadlineContext: { meter: {}, quota: { '1:2': 30, '2:2': 5, '3:2': 2 }, progress: {}, extensions: {} } } as never)
        })
        expect(names()).toEqual(['Bob', 'Cy'])
      } finally {
        vi.mocked(matchFilter).mockImplementation(() => true)
      }
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
      expect(screen.getByRole('grid', { name: 'Caseload' })).toBeTruthy()
    })

    // AUDIT-012: every header has a cell in each row, in the same place. The last header is
    // the "Add a column" button (UX-B-03), which no row has a cell under
    function expectCellsMatchHeaders(): void {
      const grid = screen.getByRole('grid')
      const headers = screen.getAllByRole('columnheader')
      expect(grid.getAttribute('aria-colcount')).toBe(String(headers.length))
      expect(headers.map(h => h.getAttribute('aria-colindex'))).toEqual(headers.map((_, i) => String(i + 1)))
      expect(headers[headers.length - 1]!.getAttribute('aria-label')).toBe('Add a column')
      const dataHeaders = headers.slice(0, -1)
      const bodyRows = screen.getAllByRole('row').slice(1)
      expect(bodyRows.length).toBeGreaterThan(0)
      for (const row of bodyRows) {
        const cells = Array.from(row.querySelectorAll('[role="gridcell"]'))
        expect(cells.map(c => c.getAttribute('aria-colindex'))).toEqual(dataHeaders.map((_, i) => String(i + 1)))
      }
    }

    it('gives each row a cell for every header, numbered alike (AUDIT-012)', async () => {
      renderDataGrid()
      await flushEffects()
      expectCellsMatchHeaders()
      // The first data cell sits under the first data column, not under "Select all"
      const nameHeader = screen.getAllByRole('columnheader').find(h => h.textContent?.includes('Name'))!
      expect(dataCells()[0]!.getAttribute('aria-colindex')).toBe(nameHeader.getAttribute('aria-colindex'))
    })

    it('keeps cells and headers matched with the priority and Tags columns shown (AUDIT-012)', async () => {
      setupStores({
        acuityEnabled: true, showTagsColumn: true,
        acuityLevels: [{ id: 1, grid_id: 1, name: 'High', abbreviation: 'H', points: 3, color: '#dc2626', position: 0, created_at: '' }],
      })
      renderDataGrid()
      await flushEffects()
      expect(screen.getAllByRole('columnheader').length).toBe(TEST_COLUMNS.length + 7)
      expectCellsMatchHeaders()
    })

    it('says how many rows there are and where each one sits (AUDIT-042)', async () => {
      setupStores({ rows: makeTestRows(12) })
      renderDataGrid()
      await flushEffects()
      const grid = screen.getByRole('grid')
      expect(grid.getAttribute('aria-rowcount')).toBe('13')
      expect(grid.getAttribute('aria-multiselectable')).toBe('true')
      const rows = screen.getAllByRole('row')
      expect(rows.map(r => r.getAttribute('aria-rowindex'))).toEqual(rows.map((_, i) => String(i + 1)))
    })

    it('holds only rows: the empty-list message sits outside the grid, and the old tip bar is gone (AUDIT-042, UX pass Q7)', async () => {
      localStorage.removeItem('pulse-grid-hints-dismissed')
      const { unmount } = renderDataGrid()
      await flushEffects()
      // The one-time grid hint (components/onboarding) replaced the blue tip bar
      expect(screen.queryByRole('button', { name: 'Dismiss tip' })).toBeNull()
      expect(screen.queryByText(/^Tip: click a column name/)).toBeNull()
      unmount()
      setupStores({ rows: [] })
      renderDataGrid()
      await flushEffects()
      const add = screen.getByRole('button', { name: 'Add Client' })
      expect(screen.getByRole('grid').contains(add)).toBe(false)
    })

    it('passes axe checks for grid structure and names (AUDIT-012, AUDIT-042)', async () => {
      renderDataGrid()
      await flushEffects()
      const axe = (await import('axe-core')).default
      const result = await axe.run(screen.getByRole('grid'), {
        runOnly: { type: 'rule', values: ['aria-required-children', 'aria-required-parent', 'aria-allowed-attr', 'aria-valid-attr-value', 'button-name', 'aria-prohibited-attr'] },
      })
      expect(result.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)).toEqual([])
    })

    it('a column menu\'s Wider and Narrower change the width, within limits (AUDIT-150)', async () => {
      const { container } = renderDataGrid()
      await flushEffects()
      const width = () => (container.querySelector('[style*="--cw-1"]') as HTMLElement).style.getPropertyValue('--cw-1')
      expect(width()).toBe('150px')
      act(() => { pulseEvents.emit('column:resize', { columnId: 1, change: 'wider' }) })
      expect(width()).toBe('190px')
      act(() => { for (let i = 0; i < 5; i++) pulseEvents.emit('column:resize', { columnId: 1, change: 'narrower' }) })
      expect(width()).toBe('60px')
    })

    it('each row has profile navigation button', async () => {
      renderDataGrid()
      await flushEffects()
      const profileBtns = screen.getAllByLabelText("Open client's page")
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
