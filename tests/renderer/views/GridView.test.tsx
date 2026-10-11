// @vitest-environment jsdom
/**
 * GridView smoke tests — renders empty state, toolbar, grid when active.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, act, fireEvent } from '@testing-library/react'
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
  DEBOUNCE_SEARCH: 0,
  DEBOUNCE_TASK_RELOAD: 0,
  SPINNER_DELAY: 0,
  MS_PER_DAY: 86400000,
  DAYS_THIS_WEEK: 7,
  DAYS_THIS_MONTH: 30,
}))

// ── Store mocks ──────────────────────────────────────────────────────────────

let gridStoreOverride: Record<string, unknown> = {}

const refreshRowsMock = vi.fn().mockResolvedValue(undefined)

function getGridStoreData() {
  return {
    grids: [], rows: [], columns: [], activeGridId: null,
    isLoading: false, gridListLoaded: true,
    loadGridList: vi.fn().mockResolvedValue(undefined), loadGrid: vi.fn(),
    refreshRows: refreshRowsMock,
    searchQuery: '', setSearchQuery: vi.fn(),
    sortConfig: [], showArchived: false,
    acuityLevels: [], acuityEnabled: false,
    hiddenColumns: [], sortedRowIds: [],
    updateRow: vi.fn(), updateCell: vi.fn(),
    pendingColumnTypeChange: null,
    confirmColumnTypeChange: vi.fn(),
    cancelColumnTypeChange: vi.fn(),
    setFindReplaceQuery: vi.fn(),
    setFindReplaceActiveMatch: vi.fn(),
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
  const storeData = {
    undoStack: [], redoStack: [], undo: vi.fn(), redo: vi.fn(),
    canUndo: false, canRedo: false, pushWithToast: vi.fn(),
  }
  const store = (selector: Function) => selector(storeData)
  store.getState = () => storeData
  store.subscribe = vi.fn().mockReturnValue(vi.fn())
  return { useUndoStore: store }
})

vi.mock('../../../src/renderer/stores/settingsStore', () => {
  const storeData = {
    theme: 'light', gridDensity: 'normal', rowStriping: true,
    gridLines: true, reducedMotion: false, highContrast: false,
    uiScale: 100, sidebarWidth: 240,
  }
  return { useSettingsStore: (selector?: Function) => selector ? selector(storeData) : storeData }
})

vi.mock('../../../src/renderer/stores/alertStore', () => ({
  useAlertStore: (selector: Function) => selector({
    rules: [], isLoaded: true, loadRules: vi.fn(),
  }),
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
  GridStatusFooter: () => <div data-testid="grid-footer">Footer</div>,
}))
vi.mock('../../../src/renderer/components/shared/EmptyState', () => ({
  EmptyState: ({ title, description }: { title: string; description?: string }) => (
    <div data-testid="empty-state">
      <span>{title}</span>
      {description && <span>{description}</span>}
    </div>
  ),
}))
vi.mock('../../../src/renderer/components/shared/ConfirmDialog', () => ({
  ConfirmDialog: () => null,
}))

// ── Import (after mocks) ─────────────────────────────────────────────────────

import GridView from '../../../src/renderer/views/GridView'
import { setWords } from '../vocabFixture'

async function flushEffects() {
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => { setWords() })

describe('GridView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gridStoreOverride = {}
    mockInvoke.mockResolvedValue({ ok: true, data: [] })
  })

  it('renders without crashing', async () => {
    const { container } = render(<MemoryRouter><GridView /></MemoryRouter>)
    await flushEffects()
    expect(container.innerHTML.length).toBeGreaterThan(0)
  })

  it('reads the open list\'s records again on coming back, so restored ones show (R2)', async () => {
    refreshRowsMock.mockClear()
    render(<MemoryRouter><GridView /></MemoryRouter>)
    await flushEffects()
    expect(refreshRowsMock).toHaveBeenCalledTimes(1)
  })

  it('reads the records again at midnight, so deadline colors move on (bug sweep S5)', async () => {
    const { pulseEvents } = await import('../../../src/renderer/events')
    render(<MemoryRouter><GridView /></MemoryRouter>)
    await flushEffects()
    refreshRowsMock.mockClear()
    act(() => { pulseEvents.emit('day:changed', { date: '2026-10-12' }) })
    expect(refreshRowsMock).toHaveBeenCalledTimes(1)
  })

  it('with no lists at all, offers the setup starting points (audit 2.1)', async () => {
    gridStoreOverride = { gridListLoaded: true, activeGridId: null, grids: [] }
    const { pulseEvents } = await import('../../../src/renderer/events')
    const steps: string[] = []
    const off = pulseEvents.on('setup:open', e => steps.push(e.step))
    render(<MemoryRouter><GridView /></MemoryRouter>)
    await flushEffects()
    expect(screen.getByText("You don't have any caseloads yet")).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: /Start from an example/ }))
    fireEvent.click(screen.getByRole('button', { name: /Bring in a spreadsheet/ }))
    fireEvent.click(screen.getByRole('button', { name: /Start blank/ }))
    expect(steps).toEqual(['examples', 'sheet-name', 'blank'])
    off()
  })

  it('after the last list was deleted, says it can come back from the Trash (R5)', async () => {
    gridStoreOverride = { gridListLoaded: true, activeGridId: null, grids: [] }
    const { safeInvoke } = await import('../../../src/renderer/utils/safeInvoke')
    vi.mocked(safeInvoke).mockImplementation((async (channel: string) => channel === 'grid:deleted-list'
      ? { ok: true, data: [{ id: 3, name: 'Foster kids', deleted_at: '', records: 8 }] }
      : { ok: false, error: 'test-mock' }) as never)
    render(<MemoryRouter><GridView /></MemoryRouter>)
    await flushEffects()
    expect(screen.getByRole('button', { name: /Bring back "Foster kids" from the Trash/ })).toBeDefined()
    vi.mocked(safeInvoke).mockResolvedValue({ ok: false, error: 'test-mock' } as never)
  })

  it('shows empty state when no grid is selected', async () => {
    gridStoreOverride = { gridListLoaded: true, activeGridId: null, grids: [{ id: 1, name: 'Test Grid', is_active: 1, position: 0, created_at: '', updated_at: '' }] }
    render(<MemoryRouter><GridView /></MemoryRouter>)
    await flushEffects()
    expect(screen.getByTestId('empty-state')).toBeDefined()
    expect(screen.getByText('No caseload selected')).toBeDefined()
  })

  it('renders toolbar, grid, and footer when a grid is active', async () => {
    gridStoreOverride = {
      gridListLoaded: true,
      activeGridId: 1,
      grids: [{ id: 1, name: 'Test Grid', is_active: 1, position: 0, created_at: '', updated_at: '' }],
    }
    render(<MemoryRouter><GridView /></MemoryRouter>)
    await flushEffects()
    expect(screen.getByTestId('grid-toolbar')).toBeDefined()
    expect(screen.getByTestId('data-grid')).toBeDefined()
    expect(screen.getByTestId('grid-footer')).toBeDefined()
  })

  it('renders FilterBar when grid is active', async () => {
    gridStoreOverride = {
      gridListLoaded: true,
      activeGridId: 1,
      grids: [{ id: 1, name: 'Test Grid', is_active: 1, position: 0, created_at: '', updated_at: '' }],
    }
    render(<MemoryRouter><GridView /></MemoryRouter>)
    await flushEffects()
    expect(screen.getByTestId('filter-bar')).toBeDefined()
  })
})
