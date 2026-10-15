// @vitest-environment jsdom
/**
 * What a scroll or an edit redraws in the list (UX pass Q9b). The column headers listen to
 * the drag-to-reorder context; when its sensors were a new object every render, every header
 * redrew on every scroll frame and every edit, about half the grid's time per frame. Real
 * @dnd-kit here (DataGrid.test.tsx mocks it), and a virtualizer whose window can be moved.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import React from 'react'
import { render, act, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Column, GridRow } from '../../../../src/shared/types'

Object.defineProperty(window, 'api', { value: { invoke: vi.fn().mockResolvedValue({ ok: true, data: null }), on: vi.fn().mockReturnValue(vi.fn()) }, writable: true })
Element.prototype.scrollIntoView = vi.fn()

vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
vi.mock('../../../../src/renderer/utils/rendererLogger', () => ({ rlog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('../../../../src/renderer/utils/safeInvoke', () => ({
  safeInvoke: vi.fn().mockResolvedValue({ ok: false, error: 'test' }),
  storeInvoke: vi.fn().mockRejectedValue(new Error('test')),
  invoke: vi.fn().mockRejectedValue(new Error('test')),
}))

const VISIBLE = 10
const virtual = vi.hoisted(() => {
  const listeners = new Set<() => void>()
  return {
    start: 0,
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } },
    scrollTo(start: number) { this.start = start; for (const fn of listeners) fn() },
  }
})
vi.mock('@tanstack/react-virtual', async () => {
  const { useSyncExternalStore } = await vi.importActual<typeof import('react')>('react')
  return {
    useVirtualizer: ({ count }: { count: number }) => {
      const start = useSyncExternalStore(virtual.subscribe, () => virtual.start)
      const first = Math.max(0, Math.min(start, count - 1))
      const n = Math.max(0, Math.min(count - first, VISIBLE))
      return {
        getVirtualItems: () => Array.from({ length: n }, (_, k) => ({ index: first + k, start: (first + k) * 44, end: (first + k + 1) * 44, size: 44, key: first + k, lane: 0 })),
        getTotalSize: () => count * 44,
        measureElement: vi.fn(),
        scrollToIndex: vi.fn(),
      }
    },
  }
})

/** Every column header drawn */
const headerDraws = vi.hoisted(() => ({ n: 0 }))
vi.mock('../../../../src/renderer/components/grid/ColumnHeader', async () => {
  const actual = await vi.importActual<typeof import('../../../../src/renderer/components/grid/ColumnHeader')>('../../../../src/renderer/components/grid/ColumnHeader')
  const Counted: typeof actual.ColumnHeader = props => { headerDraws.n++; return actual.ColumnHeader(props) }
  return { ...actual, ColumnHeader: Counted }
})

import { useGridStore } from '../../../../src/renderer/stores/gridStore'
import { useSettingsStore } from '../../../../src/renderer/stores/settingsStore'
import { DataGrid } from '../../../../src/renderer/components/grid/DataGrid'
import { setWords } from '../../vocabFixture'

const columns: Column[] = Array.from({ length: 6 }, (_, i) => ({
  id: i + 1, grid_id: 1, name: i === 0 ? 'Name' : `Field ${i}`, column_type: 'text', position: i, width: 150, is_visible: 1,
  is_required: 0, is_identifier: 0, is_name_column: i === 0 ? 1 : 0, default_value: null, description: null, config: '{}',
  conditional_format: '[]', created_at: '2026-01-01 00:00:00',
} as Column))
const rows: GridRow[] = Array.from({ length: 200 }, (_, i) => {
  const r: GridRow = { row_id: i + 1, position: i, is_active: 1, is_starred: 0, acuity_level_id: null, deleted_at: null, created_at: '2026-01-01 00:00:00', updated_at: '2026-01-01 00:00:00' }
  for (const c of columns) r[`col_${c.id}`] = c.id === 1 ? `Person ${i + 1}` : `Note ${i}`
  return r
})

beforeAll(() => { setWords() })

beforeEach(() => {
  virtual.start = 0
  useGridStore.setState({
    grids: [{ id: 1, name: 'List', description: null, created_at: '', updated_at: '', sort_config: '[]', filter_config: '[]', column_order: '[]', frozen_columns: 0, row_height: 'comfortable', show_gridlines: 1, show_row_numbers: 0, show_alternating_rows: 0, position: 0, is_active: 1, acuity_enabled: 0 }],
    activeGridId: 1, loadedGridId: 1, columns, hiddenColumns: [], rows, isLoading: false, loadError: null,
    sortConfig: [], searchQuery: '', activeFilters: [], filterMode: 'and', showStarredOnly: false,
    cellFormats: new Map(), rowTagsMap: new Map(), acuityEnabled: false, acuityLevels: [], groupByColumnId: null,
    customGroups: [], activeCustomGroupId: null, sortedRowIds: [], selectedRowIds: new Set<number>(), lastAddedRowId: null, pinnedRowId: null, sampleRows: {},
  } as Partial<ReturnType<typeof useGridStore.getState>>)
  useSettingsStore.setState({ gridDensity: 'comfortable' })
})

function mount() {
  const view = render(<MemoryRouter><DataGrid /></MemoryRouter>)
  headerDraws.n = 0
  return view
}

describe('List redraws', () => {
  it('a scroll mounts the new records and leaves the column headers alone', () => {
    const view = mount()
    for (let k = 1; k <= 5; k++) act(() => { virtual.scrollTo(k) })
    expect(view.container.querySelector('[role="row"][data-row-index="5"]')).not.toBeNull()
    expect(view.container.querySelector('[role="row"][data-row-index="0"]')).toBeNull()
    expect(headerDraws.n).toBe(0)
  })

  it('an edit shows the new value and leaves the column headers alone', () => {
    const view = mount()
    act(() => { useGridStore.setState(s => ({ rows: s.rows.map(r => r.row_id === 2 ? { ...r, col_2: 'Changed' } : r) })) })
    expect(view.container.querySelector('[data-row-id="2"][data-col-id="2"]')?.textContent).toContain('Changed')
    expect(headerDraws.n).toBe(0)
  })

  it('a sort still reaches the headers: aria-sort follows it', () => {
    const view = mount()
    const sortOf = () => [...view.container.querySelectorAll('[role="columnheader"][aria-sort]')]
      .filter(h => h.getAttribute('aria-sort') !== 'none').map(h => `${h.textContent?.includes('Field 1') ? 'Field 1' : '?'}:${h.getAttribute('aria-sort')}`)
    expect(sortOf()).toEqual([])
    act(() => { useGridStore.setState({ sortConfig: [{ columnId: 2, direction: 'asc', priority: 1 }] }) })
    expect(sortOf()).toEqual(['Field 1:ascending'])
    act(() => { useGridStore.setState({ sortConfig: [{ columnId: 2, direction: 'desc', priority: 1 }] }) })
    expect(sortOf()).toEqual(['Field 1:descending'])
    act(() => { useGridStore.setState({ sortConfig: [] }) })
    expect(sortOf()).toEqual([])
  })

  it("dragging a column's edge still lights its handle, and letting go puts it out", () => {
    const view = mount()
    const handle = () => view.container.querySelectorAll<HTMLElement>('[data-testid="column-resize-handle"]')[1]!
    expect(handle().dataset.resizing).toBeUndefined()
    act(() => { fireEvent.mouseDown(handle(), { clientX: 300 }) })
    expect(handle().dataset.resizing).toBe('true')
    act(() => { fireEvent.mouseMove(document, { clientX: 340 }) })
    act(() => { fireEvent.mouseUp(document, { clientX: 340 }) })
    expect(handle().dataset.resizing).toBeUndefined()
  })

  it('a renamed column still redraws its header', () => {
    const view = mount()
    act(() => { useGridStore.setState(s => ({ columns: s.columns.map(c => c.id === 2 ? { ...c, name: 'Renamed' } : c) })) })
    expect(view.container.textContent).toContain('Renamed')
    expect(headerDraws.n).toBeGreaterThan(0)
  })
})
