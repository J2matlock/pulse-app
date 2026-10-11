// @vitest-environment jsdom
/**
 * Automated accessibility check (axe-core) on the list page: the real
 * toolbar, filter bar and grid with 20 records and several column types.
 * Only the virtualiser is replaced, because jsdom has no layout to measure.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen, cleanup, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Column, GridRow } from '../../../src/shared/types'
import { expectNoAxeViolations } from './axe'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke: mockInvoke, on: () => () => {}, copyToClipboard: vi.fn() }, writable: true, configurable: true })
Object.defineProperty(window, 'matchMedia', {
  value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }),
  writable: true,
})
class RO { observe() {} unobserve() {} disconnect() {} }
vi.stubGlobal('ResizeObserver', RO)
Element.prototype.scrollIntoView = function scrollIntoView() {}
vi.mock('lucide-react', async () => (await import('../lucideMock')).lucideMock)
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
vi.mock('../../../src/renderer/utils/rendererLogger', () => ({
  rlog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () => Array.from({ length: count }, (_, i) => ({ index: i, start: i * 44, end: (i + 1) * 44, size: 44, key: i })),
    getTotalSize: () => count * 44,
    measureElement: () => {},
    scrollToIndex: () => {},
  }),
}))

import { useGridStore } from '../../../src/renderer/stores/gridStore'
import { DataGrid } from '../../../src/renderer/components/grid/DataGrid'
import { GridToolbar } from '../../../src/renderer/components/grid/GridToolbar'
import { FilterBar } from '../../../src/renderer/components/grid/FilterBar'
import { setWords } from '../vocabFixture'

async function flush() { await act(async () => { await new Promise(r => setTimeout(r, 20)) }) }

function column(id: number, name: string, type: string, extra: Partial<Column> = {}): Column {
  return {
    id, grid_id: 1, name, column_type: type, position: id - 1, width: 150, is_visible: 1, is_required: 0,
    is_identifier: 0, is_name_column: id === 1 ? 1 : 0, default_value: null, description: null,
    config: type === 'dropdown' ? '{"options":["Open","Closed"]}' : '{}', conditional_format: '[]',
    created_at: '2026-01-01 00:00:00', ...extra,
  } as Column
}

const COLUMNS = [column(1, 'Name', 'text'), column(2, 'Next visit', 'date'), column(3, 'Status', 'dropdown'), column(4, 'Score', 'number'), column(5, 'Done', 'checkbox')]
const ROWS: GridRow[] = Array.from({ length: 20 }, (_, i) => ({
  row_id: i + 1, position: i, is_active: 1, is_starred: i === 0 ? 1 : 0, acuity_level_id: null, deleted_at: null,
  created_at: '2026-01-01 00:00:00', updated_at: '2026-01-01 00:00:00',
  col_1: `Test Person ${i + 1}`, col_2: `2026-11-${String((i % 27) + 1).padStart(2, '0')}`,
  col_3: i % 2 ? 'Open' : 'Closed', col_4: String(i * 3), col_5: i % 3 === 0 ? 'true' : 'false',
} as GridRow))

beforeEach(() => {
  setWords()
  mockInvoke.mockReset()
  mockInvoke.mockImplementation((channel: string) => Promise.resolve(channel === 'app:get-info'
    ? { ok: true, data: { platform: 'linux', version: '1.0.0' } }
    : { ok: false, error: 'not in this test' }))
  useGridStore.setState({
    grids: [{ id: 1, name: 'Test List', description: null, created_at: '', updated_at: '', sort_config: '[]', filter_config: '[]', column_order: '[]', frozen_columns: 0, row_height: 'comfortable', show_gridlines: 1, show_row_numbers: 0, show_alternating_rows: 0, position: 0, is_active: 1, acuity_enabled: 0 }],
    activeGridId: 1, columns: COLUMNS, hiddenColumns: [], rows: ROWS, isLoading: false, gridListLoaded: true,
    sortConfig: [], searchQuery: '', activeFilters: [], selectedRowIds: new Set<number>(),
  } as unknown as Parameters<typeof useGridStore.setState>[0])
})
afterEach(() => cleanup())

describe('axe: list page', () => {
  it('toolbar, filter bar and grid with 20 records', async () => {
    const { container } = render(<MemoryRouter><GridToolbar /><FilterBar /><DataGrid /></MemoryRouter>)
    await flush()
    expect(screen.getByText('Test Person 20')).toBeTruthy()
    // Known, owned by the grid ARIA work (GridHeaderRow / SortableRow / DataGrid
    // structure): rows hold select and profile buttons that aren't gridcells,
    // and the profile column header has a name but no visible text. Remove
    // these exceptions when that lands.
    await expectNoAxeViolations(container, { disableRules: ['aria-required-children', 'empty-table-header'] })
  })
})
