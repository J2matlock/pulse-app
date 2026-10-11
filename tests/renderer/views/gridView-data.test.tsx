// @vitest-environment jsdom
/**
 * GridView data smoke tests — renders GridView with 10 rows, 5 columns of
 * mixed types and verifies that DataGrid, toolbar, and footer all mount.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// ── Global mocks ─────────────────────────────────────────────────────────────

const mockInvoke = vi.fn()
const mockOn = vi.fn().mockReturnValue(vi.fn())
Object.defineProperty(window, 'api', {
  value: { invoke: mockInvoke, on: mockOn, copyToClipboard: vi.fn() },
  writable: true,
})

if (!globalThis.crypto?.randomUUID) {
  vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2) })
}

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

vi.mock('zustand/react/shallow', () => ({ useShallow: (fn: Function) => fn }))

vi.mock('lucide-react', async () => (await import('../lucideMock')).lucideMock)

vi.mock('../../../src/renderer/utils/safeInvoke', () => ({
  safeInvoke: vi.fn().mockResolvedValue({ ok: false, error: 'test-mock' }),
}))

vi.mock('../../../src/renderer/utils/rendererLogger', () => ({
  rlog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../../src/shared/constants', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('../../../src/shared/constants')),
  DEBOUNCE_SEARCH: 0, DEBOUNCE_TASK_RELOAD: 0, SPINNER_DELAY: 0,
  MS_PER_DAY: 86400000, DAYS_THIS_WEEK: 7, DAYS_THIS_MONTH: 30,
}))

// ── Sample data: 5 columns, 10 rows ─────────────────────────────────────────

const sampleColumns = [
  { id: 1, grid_id: 1, name: 'Client Name', column_type: 'text', width: 200, position: 0, is_visible: 1, is_required: 1, is_identifier: 1, is_name_column: 1, config: '{}', created_at: '', updated_at: '' },
  { id: 2, grid_id: 1, name: 'Next Review', column_type: 'date', width: 150, position: 1, is_visible: 1, is_required: 0, is_identifier: 0, is_name_column: 0, config: '{}', created_at: '', updated_at: '' },
  { id: 3, grid_id: 1, name: 'Priority Score', column_type: 'number', width: 120, position: 2, is_visible: 1, is_required: 0, is_identifier: 0, is_name_column: 0, config: '{}', created_at: '', updated_at: '' },
  { id: 4, grid_id: 1, name: 'Active', column_type: 'checkbox', width: 100, position: 3, is_visible: 1, is_required: 0, is_identifier: 0, is_name_column: 0, config: '{}', created_at: '', updated_at: '' },
  { id: 5, grid_id: 1, name: 'Status', column_type: 'dropdown', width: 130, position: 4, is_visible: 1, is_required: 0, is_identifier: 0, is_name_column: 0, config: '{"options":["Open","Closed","Pending"]}', created_at: '', updated_at: '' },
]

function makeRow(i: number) {
  const names = ['Alice Johnson', 'Bob Williams', 'Carmen Diaz', 'Derek Lee', 'Elena Ruiz',
    'Frank Okafor', 'Grace Kim', 'Hiro Tanaka', 'Isabel Morales', 'James Petrov']
  const dates = ['2026-03-15', '2026-04-01', '2026-03-20', '2026-05-10', '2026-03-08',
    '2026-06-01', '2026-03-25', '2026-04-12', '2026-03-18', '2026-07-01']
  const statuses = ['Open', 'Closed', 'Pending', 'Open', 'Open', 'Closed', 'Pending', 'Open', 'Open', 'Closed']
  return {
    row_id: i + 1, position: i, is_active: 1 as const, is_starred: (i % 3 === 0 ? 1 : 0) as 0 | 1,
    acuity_level_id: null, display_name: names[i], deleted_at: null,
    created_at: '2026-01-01', updated_at: '2026-03-01',
    col_1: names[i]!, col_2: dates[i]!, col_3: String((i + 1) * 10), col_4: i % 2 === 0 ? '1' : '0', col_5: statuses[i]!,
  }
}

const sampleRows = Array.from({ length: 10 }, (_, i) => makeRow(i))

// ── Store mocks ──────────────────────────────────────────────────────────────

let gridStoreOverride: Record<string, unknown> = {}

function getGridStoreData() {
  return {
    grids: [{ id: 1, name: 'Main Caseload', is_active: 1, position: 0, created_at: '', updated_at: '' }],
    rows: sampleRows, columns: sampleColumns,
    activeGridId: 1, isLoading: false, gridListLoaded: true,
    loadGridList: vi.fn().mockResolvedValue(undefined), loadGrid: vi.fn(),
    searchQuery: '', setSearchQuery: vi.fn(),
    sortConfig: [], showArchived: false,
    acuityLevels: [], acuityEnabled: false,
    hiddenColumns: [], sortedRowIds: [],
    updateRow: vi.fn(), updateCell: vi.fn(),
    pendingColumnTypeChange: null,
    confirmColumnTypeChange: vi.fn(), cancelColumnTypeChange: vi.fn(),
    setFindReplaceQuery: vi.fn(), setFindReplaceActiveMatch: vi.fn(),
    ...gridStoreOverride,
  }
}

vi.mock('../../../src/renderer/stores/gridStore', () => {
  const store = (selector: Function) => selector(getGridStoreData())
  store.getState = () => getGridStoreData()
  store.subscribe = vi.fn().mockReturnValue(vi.fn())
  return { useGridStore: store }
})

vi.mock('../../../src/renderer/stores/undoStore', () => {
  const d = { undoStack: [], redoStack: [], undo: vi.fn(), redo: vi.fn(), canUndo: false, canRedo: false, pushWithToast: vi.fn() }
  const store = (sel: Function) => sel(d)
  store.getState = () => d; store.subscribe = vi.fn().mockReturnValue(vi.fn())
  return { useUndoStore: store }
})

vi.mock('../../../src/renderer/stores/settingsStore', () => {
  const d = { theme: 'light', gridDensity: 'normal', rowStriping: true, gridLines: true, reducedMotion: false, highContrast: false, uiScale: 100, sidebarWidth: 240 }
  return { useSettingsStore: (sel?: Function) => sel ? sel(d) : d }
})

vi.mock('../../../src/renderer/stores/alertStore', () => ({
  useAlertStore: (sel: Function) => sel({ rules: [], isLoaded: true, loadRules: vi.fn() }),
}))

// ── Mock child components ─────────────────────────────────────────────────────

vi.mock('../../../src/renderer/components/grid/DataGrid', () => ({
  DataGrid: () => <div data-testid="data-grid">DataGrid</div>,
}))
vi.mock('../../../src/renderer/components/grid/GridToolbar', () => ({
  GridToolbar: () => <div data-testid="grid-toolbar">GridToolbar</div>,
}))
vi.mock('../../../src/renderer/components/grid/FilterBar', () => ({
  FilterBar: () => <div data-testid="filter-bar">FilterBar</div>,
}))
vi.mock('../../../src/renderer/components/grid/FindReplaceBar', () => ({
  FindReplaceBar: () => null,
}))
vi.mock('../../../src/renderer/components/grid/GridStatusFooter', () => ({
  GridStatusFooter: ({ rowCount, columnCount }: { rowCount?: number; columnCount?: number }) => (
    <div data-testid="grid-footer" data-rows={rowCount} data-cols={columnCount}>
      {rowCount} rows, {columnCount} columns
    </div>
  ),
}))
vi.mock('../../../src/renderer/components/shared/EmptyState', () => ({
  EmptyState: ({ title }: { title: string }) => <div data-testid="empty-state"><span>{title}</span></div>,
}))
vi.mock('../../../src/renderer/components/shared/ConfirmDialog', () => ({
  ConfirmDialog: () => null,
}))

// ── Import (after mocks) ─────────────────────────────────────────────────────

import GridView from '../../../src/renderer/views/GridView'

async function flushEffects() {
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('GridView — data smoke tests (10 rows, 5 columns)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gridStoreOverride = {}
    mockInvoke.mockResolvedValue({ ok: true, data: [] })
  })

  it('renders DataGrid component when grid has data', async () => {
    render(<MemoryRouter><GridView /></MemoryRouter>)
    await flushEffects()
    expect(screen.getByTestId('data-grid')).toBeDefined()
  })

  it('renders GridToolbar when grid is active', async () => {
    render(<MemoryRouter><GridView /></MemoryRouter>)
    await flushEffects()
    expect(screen.getByTestId('grid-toolbar')).toBeDefined()
  })

  it('renders FilterBar when grid is active', async () => {
    render(<MemoryRouter><GridView /></MemoryRouter>)
    await flushEffects()
    expect(screen.getByTestId('filter-bar')).toBeDefined()
  })

  it('renders footer when grid has data', async () => {
    render(<MemoryRouter><GridView /></MemoryRouter>)
    await flushEffects()
    expect(screen.getByTestId('grid-footer')).toBeDefined()
  })

  it('does not show empty state when grid has rows', async () => {
    render(<MemoryRouter><GridView /></MemoryRouter>)
    await flushEffects()
    expect(screen.queryByTestId('empty-state')).toBeNull()
  })

  it('shows empty state when grid list is loaded but no grid selected', async () => {
    gridStoreOverride = { activeGridId: null, grids: [{ id: 1, name: 'Test', is_active: 1, position: 0, created_at: '', updated_at: '' }], rows: [], columns: [] }
    render(<MemoryRouter><GridView /></MemoryRouter>)
    await flushEffects()
    expect(screen.getByTestId('empty-state')).toBeDefined()
  })

  it('grid store contains 10 rows and 5 columns', () => {
    const state = getGridStoreData()
    expect(state.rows).toHaveLength(10)
    expect(state.columns).toHaveLength(5)
  })

  it('rows have correct column data types populated', () => {
    const row = sampleRows[0]!
    expect(row.col_1).toBe('Alice Johnson')       // text
    expect(row.col_2).toBe('2026-03-15')           // date
    expect(row.col_3).toBe('10')                   // number
    expect(row.col_4).toBe('1')                    // checkbox
    expect(row.col_5).toBe('Open')                 // dropdown
  })

  it('columns have correct types assigned', () => {
    const types = sampleColumns.map(c => c.column_type)
    expect(types).toEqual(['text', 'date', 'number', 'checkbox', 'dropdown'])
  })
})
