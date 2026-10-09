/**
 * gridStore.test.ts — Zustand grid store unit tests.
 * Mocks window.api.invoke for all IPC calls.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act } from 'react'

// Mock window.api before importing the store
const mockInvoke = vi.fn()
;(globalThis as Record<string, unknown>).window = { api: { invoke: mockInvoke } }

// Mock react-hot-toast
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn() } }))

// Mock crypto.randomUUID
vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2) })

import { useGridStore } from '../../../src/renderer/stores/gridStore'
import { useUndoStore } from '../../../src/renderer/stores/undoStore'
import type { GridRow, Column, Grid } from '../../../src/shared/types'

// Helpers
function makeRow(id: number, overrides: Partial<GridRow> = {}): GridRow {
  return {
    row_id: id,
    position: id - 1,
    is_active: 1,
    is_starred: 0,
    acuity_level_id: null,
    deleted_at: null,
    created_at: '2026-01-01T00:00:00',
    updated_at: '2026-01-01T00:00:00',
    ...overrides,
  }
}

function makeColumn(id: number, name: string, overrides: Partial<Column> = {}): Column {
  return {
    id,
    grid_id: 1,
    name,
    column_type: 'text',
    width: 200,
    position: id - 1,
    is_visible: 1,
    is_required: 0,
    is_identifier: 0,
    is_name_column: 0,
    default_value: null,
    description: null,
    config: '{}',
    ...overrides,
  } as Column
}

const initialState = {
  grids: [],
  gridListLoaded: false,
  activeGridId: null,
  columns: [],
  hiddenColumns: [],
  rows: [],
  isLoading: false,
  isSaving: false,
  saveError: null,
  sortConfig: [],
  searchQuery: '',
  showArchived: false,
  groupByColumnId: null,
  cellFormats: new Map(),
  sortedRowIds: [],
  _loadVersion: 0,
  acuityLevels: [],
  acuityEnabled: false,
  rowTagsMap: new Map(),
  filterMode: 'and' as const,
  showStarredOnly: false,
  activeFilters: [],
  savedFilters: [],
  savedViews: [],
  copiedFormatRules: null,
}

describe('gridStore', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    useGridStore.setState(initialState)
    useUndoStore.setState({ undoStack: [], redoStack: [], toast: null, isUndoing: false })
  })

  describe('loadGrid', () => {
    it('sets isLoading true then false after load completes', async () => {
      const mockGrid: Partial<Grid> = { id: 1, name: 'Test', sort_config: '[]' }
      mockInvoke.mockResolvedValue({
        ok: true,
        data: { grid: mockGrid, columns: [], hiddenColumns: [], rows: [], acuityLevels: [], cellFormats: [], rowTagsMap: {}, savedViews: [], customGroups: '[]' },
      })

      const promise = useGridStore.getState().loadGrid(1)
      // isLoading should be true immediately after call
      expect(useGridStore.getState().isLoading).toBe(true)
      expect(useGridStore.getState().activeGridId).toBe(1)

      await promise
      expect(useGridStore.getState().isLoading).toBe(false)
    })

    it('clears previous state on new loadGrid', async () => {
      // Set some pre-existing state
      useGridStore.setState({
        rows: [makeRow(1)],
        columns: [makeColumn(1, 'Name')],
        cellFormats: new Map([['1_1', []]]),
        sortedRowIds: [1],
      })

      const mockGrid: Partial<Grid> = { id: 2, name: 'New Grid', sort_config: '[]' }
      mockInvoke.mockResolvedValue({
        ok: true,
        data: { grid: mockGrid, columns: [], hiddenColumns: [], rows: [], acuityLevels: [], cellFormats: [], rowTagsMap: {}, savedViews: [], customGroups: '[]' },
      })

      await useGridStore.getState().loadGrid(2)
      expect(useGridStore.getState().activeGridId).toBe(2)
      expect(useGridStore.getState().rows).toEqual([])
      expect(useGridStore.getState().columns).toEqual([])
    })

    it('parses sort_config from grid JSON', async () => {
      const sortConfig = [{ columnId: 1, direction: 'asc', priority: 0 }]
      const mockGrid: Partial<Grid> = { id: 1, name: 'Test', sort_config: JSON.stringify(sortConfig) }
      mockInvoke.mockResolvedValue({
        ok: true,
        data: { grid: mockGrid, columns: [], hiddenColumns: [], rows: [], acuityLevels: [], cellFormats: [], rowTagsMap: {}, savedViews: [], customGroups: '[]' },
      })

      await useGridStore.getState().loadGrid(1)
      expect(useGridStore.getState().sortConfig).toEqual(sortConfig)
    })
  })

  describe('updateCell', () => {
    it('performs optimistic update before IPC resolves', async () => {
      const row = makeRow(1)
      ;(row as Record<string, unknown>)['col_5'] = 'old value'
      useGridStore.setState({ activeGridId: 1, rows: [row], columns: [makeColumn(5, 'Notes')] })

      mockInvoke.mockResolvedValue({ ok: true, data: { sysLogId: null } })

      const promise = useGridStore.getState().updateCell(1, 5, 'new value')
      // Optimistic: value should be updated immediately
      const updatedRow = useGridStore.getState().rows.find(r => r.row_id === 1)
      expect((updatedRow as Record<string, unknown>)['col_5']).toBe('new value')
      expect(useGridStore.getState().isSaving).toBe(true)

      await promise
      expect(useGridStore.getState().isSaving).toBe(false)
    })

    it('leaves auto-number and computed cells alone', async () => {
      const row = makeRow(1)
      ;(row as Record<string, unknown>)['col_5'] = 'J-0001'
      useGridStore.setState({ activeGridId: 1, rows: [row], columns: [{ ...makeColumn(5, 'Number'), column_type: 'auto_number' }] })
      mockInvoke.mockClear()

      await useGridStore.getState().updateCell(1, 5, null)
      expect((useGridStore.getState().rows[0] as Record<string, unknown>)['col_5']).toBe('J-0001')
      expect(mockInvoke).not.toHaveBeenCalled()
    })

    it('rolls back on IPC failure', async () => {
      const row = makeRow(1)
      ;(row as Record<string, unknown>)['col_5'] = 'original'
      useGridStore.setState({ activeGridId: 1, rows: [row], columns: [makeColumn(5, 'Notes')] })

      mockInvoke.mockRejectedValue(new Error('DB error'))

      await useGridStore.getState().updateCell(1, 5, 'new value')
      const updatedRow = useGridStore.getState().rows.find(r => r.row_id === 1)
      expect((updatedRow as Record<string, unknown>)['col_5']).toBe('original')
      expect(useGridStore.getState().saveError).toBeTruthy()
    })

    it('pushes to undo stack when value changes', async () => {
      const row = makeRow(1)
      ;(row as Record<string, unknown>)['col_5'] = 'old'
      useGridStore.setState({ activeGridId: 1, rows: [row], columns: [makeColumn(5, 'Notes')] })
      mockInvoke.mockResolvedValue({ ok: true, data: { sysLogId: null } })

      await useGridStore.getState().updateCell(1, 5, 'new')
      expect(useUndoStore.getState().undoStack.length).toBe(1)
      expect(useUndoStore.getState().undoStack[0]!.category).toBe('silent')
    })
  })

  describe('addRow', () => {
    it('appends a new row to state', async () => {
      useGridStore.setState({ activeGridId: 1, rows: [makeRow(1)] })
      mockInvoke.mockResolvedValue({ ok: true, data: 42 })

      await useGridStore.getState().addRow()
      expect(useGridStore.getState().rows).toHaveLength(2)
      expect(useGridStore.getState().rows[1]!.row_id).toBe(42)
    })

    it('pushes undo entry for addRow', async () => {
      useGridStore.setState({ activeGridId: 1, rows: [] })
      mockInvoke.mockResolvedValue({ ok: true, data: 10 })

      await useGridStore.getState().addRow()
      expect(useUndoStore.getState().undoStack).toHaveLength(1)
      expect(useUndoStore.getState().undoStack[0]!.icon).toBe('plus-circle')
    })
  })

  describe('deleteRow', () => {
    it('removes row from state via soft-delete', async () => {
      useGridStore.setState({
        activeGridId: 1,
        rows: [makeRow(1), makeRow(2)],
        columns: [makeColumn(1, 'First Name', { is_name_column: 1 })],
      })
      mockInvoke.mockResolvedValue({ ok: true, data: true })

      await useGridStore.getState().deleteRow(1)
      expect(useGridStore.getState().rows).toHaveLength(1)
      expect(useGridStore.getState().rows[0]!.row_id).toBe(2)
    })
  })

  describe('setSearchQuery', () => {
    it('updates searchQuery in state', () => {
      useGridStore.getState().setSearchQuery('john')
      expect(useGridStore.getState().searchQuery).toBe('john')
    })

    it('can be cleared', () => {
      useGridStore.getState().setSearchQuery('test')
      useGridStore.getState().setSearchQuery('')
      expect(useGridStore.getState().searchQuery).toBe('')
    })
  })

  describe('setShowArchived', () => {
    it('toggles showArchived and triggers reload', async () => {
      useGridStore.setState({ activeGridId: 1 })
      const mockGrid: Partial<Grid> = { id: 1, name: 'Test', sort_config: '[]' }
      mockInvoke.mockResolvedValue({
        ok: true,
        data: { grid: mockGrid, columns: [], hiddenColumns: [], rows: [], acuityLevels: [], cellFormats: [], rowTagsMap: {}, savedViews: [], customGroups: '[]' },
      })

      act(() => { useGridStore.getState().setShowArchived(true) })
      expect(useGridStore.getState().showArchived).toBe(true)
      // Should trigger loadGrid which calls invoke
      await vi.waitFor(() => expect(mockInvoke).toHaveBeenCalled())
    })
  })

  describe('filter management', () => {
    it('addFilter appends to activeFilters', () => {
      useGridStore.getState().addFilter({ columnId: 1, operator: 'contains', value: 'test' })
      expect(useGridStore.getState().activeFilters).toHaveLength(1)
      expect(useGridStore.getState().activeFilters[0]!.value).toBe('test')
    })

    it('removeFilter removes by index', () => {
      useGridStore.setState({
        activeFilters: [
          { columnId: 1, operator: 'contains', value: 'a' },
          { columnId: 2, operator: 'equals', value: 'b' },
        ],
      })
      useGridStore.getState().removeFilter(0)
      expect(useGridStore.getState().activeFilters).toHaveLength(1)
      expect(useGridStore.getState().activeFilters[0]!.value).toBe('b')
    })

    it('clearFilters empties the array', () => {
      useGridStore.setState({
        activeFilters: [{ columnId: 1, operator: 'contains', value: 'a' }],
      })
      useGridStore.getState().clearFilters()
      expect(useGridStore.getState().activeFilters).toHaveLength(0)
    })
  })

  describe('deleteGrid', () => {
    it('removes grid from grids list and clears active if matching', async () => {
      useGridStore.setState({
        grids: [{ id: 1, name: 'G1' } as Grid, { id: 2, name: 'G2' } as Grid],
        activeGridId: 1,
        columns: [makeColumn(1, 'Col')],
        rows: [makeRow(1)],
      })
      mockInvoke.mockResolvedValue({ ok: true, data: true })

      await useGridStore.getState().deleteGrid(1)
      expect(useGridStore.getState().grids).toHaveLength(1)
      expect(useGridStore.getState().activeGridId).toBeNull()
      expect(useGridStore.getState().columns).toEqual([])
      expect(useGridStore.getState().rows).toEqual([])
    })
  })

  describe('setGroupByColumnId', () => {
    it('accepts numeric column id', () => {
      useGridStore.getState().setGroupByColumnId(5)
      expect(useGridStore.getState().groupByColumnId).toBe(5)
    })

    it('accepts __acuity__ string', () => {
      useGridStore.getState().setGroupByColumnId('__acuity__')
      expect(useGridStore.getState().groupByColumnId).toBe('__acuity__')
    })

    it('accepts null to clear', () => {
      useGridStore.setState({ groupByColumnId: 5 })
      useGridStore.getState().setGroupByColumnId(null)
      expect(useGridStore.getState().groupByColumnId).toBeNull()
    })
  })

  describe('reorderRows', () => {
    it('optimistically reorders rows by provided id order', async () => {
      const rows = [makeRow(1), makeRow(2), makeRow(3)]
      useGridStore.setState({ activeGridId: 1, rows })
      mockInvoke.mockResolvedValue({ ok: true, data: true })

      const promise = useGridStore.getState().reorderRows([3, 1, 2])
      // Optimistic: rows should be reordered immediately
      const reordered = useGridStore.getState().rows
      expect(reordered[0]!.row_id).toBe(3)
      expect(reordered[1]!.row_id).toBe(1)
      expect(reordered[2]!.row_id).toBe(2)
      // Positions should be updated
      expect(reordered[0]!.position).toBe(0)
      expect(reordered[1]!.position).toBe(1)
      expect(reordered[2]!.position).toBe(2)

      await promise
    })

    it('rolls back on IPC failure', async () => {
      const rows = [makeRow(1), makeRow(2), makeRow(3)]
      useGridStore.setState({ activeGridId: 1, rows })
      mockInvoke.mockRejectedValue(new Error('DB error'))

      await useGridStore.getState().reorderRows([3, 1, 2])
      // Should rollback to original order
      const result = useGridStore.getState().rows
      expect(result[0]!.row_id).toBe(1)
      expect(result[1]!.row_id).toBe(2)
      expect(result[2]!.row_id).toBe(3)
    })

    it('does nothing without activeGridId', async () => {
      useGridStore.setState({ activeGridId: null, rows: [makeRow(1)] })

      await useGridStore.getState().reorderRows([1])
      expect(mockInvoke).not.toHaveBeenCalled()
    })
  })

  describe('loadGridList', () => {
    it('fetches grids and sets gridListLoaded', async () => {
      const grids = [{ id: 1, name: 'G1' } as Grid, { id: 2, name: 'G2' } as Grid]
      mockInvoke.mockResolvedValue({ ok: true, data: grids })

      await useGridStore.getState().loadGridList()
      expect(useGridStore.getState().grids).toEqual(grids)
      expect(useGridStore.getState().gridListLoaded).toBe(true)
    })

    it('sets gridListLoaded true even on error', async () => {
      mockInvoke.mockRejectedValue(new Error('DB error'))

      await useGridStore.getState().loadGridList()
      expect(useGridStore.getState().gridListLoaded).toBe(true)
      expect(useGridStore.getState().grids).toEqual([])
    })
  })

  describe('loadGrid error handling', () => {
    it('sets isLoading false on IPC failure', async () => {
      mockInvoke.mockRejectedValue(new Error('DB error'))

      await useGridStore.getState().loadGrid(1)
      expect(useGridStore.getState().isLoading).toBe(false)
    })

    it('discards stale response when loadVersion changes', async () => {
      // Simulate two concurrent loadGrid calls
      let resolveFirst: (v: unknown) => void
      const firstPromise = new Promise(r => { resolveFirst = r })

      const mockGrid2: Partial<Grid> = { id: 2, name: 'Second', sort_config: '[]' }
      const gridData = (grid: Partial<Grid>) => ({
        ok: true,
        data: { grid, columns: [], hiddenColumns: [], rows: [], acuityLevels: [], cellFormats: [], rowTagsMap: {}, savedViews: [], customGroups: '[]' },
      })

      // First call hangs, second resolves immediately
      mockInvoke
        .mockImplementationOnce(() => firstPromise)
        .mockResolvedValueOnce(gridData(mockGrid2))

      const p1 = useGridStore.getState().loadGrid(1)
      const p2 = useGridStore.getState().loadGrid(2)

      await p2
      expect(useGridStore.getState().activeGridId).toBe(2)

      // Now resolve first — it should be discarded (stale _loadVersion)
      resolveFirst!(gridData({ id: 1, name: 'First', sort_config: '[]' }))
      await p1

      // Should still show grid 2 data
      expect(useGridStore.getState().activeGridId).toBe(2)
    })
  })

  describe('updateRow', () => {
    it('optimistically updates row fields', async () => {
      useGridStore.setState({ rows: [makeRow(1, { is_starred: 0 })] })
      mockInvoke.mockResolvedValue({ ok: true, data: true })

      await useGridStore.getState().updateRow(1, { is_starred: 1 })
      expect(useGridStore.getState().rows[0]!.is_starred).toBe(1)
    })

    it('rolls back on IPC failure', async () => {
      useGridStore.setState({ rows: [makeRow(1, { is_starred: 0 })] })
      mockInvoke.mockRejectedValue(new Error('DB error'))

      await useGridStore.getState().updateRow(1, { is_starred: 1 })
      // Should rollback
      expect(useGridStore.getState().rows[0]!.is_starred).toBe(0)
    })
  })

  describe('createGrid', () => {
    it('creates grid and reloads grid list', async () => {
      mockInvoke
        .mockResolvedValueOnce({ ok: true, data: 5 })  // GRID_CREATE
        .mockResolvedValueOnce({ ok: true, data: [{ id: 5, name: 'New' }] })  // GRID_GET_ALL

      const id = await useGridStore.getState().createGrid('New')
      expect(id).toBe(5)
      expect(useGridStore.getState().grids).toHaveLength(1)
    })

    it('returns null on failure', async () => {
      mockInvoke.mockRejectedValue(new Error('DB error'))

      const id = await useGridStore.getState().createGrid('Fail')
      expect(id).toBeNull()
    })
  })

  describe('updateGridMeta', () => {
    it('updates grid name in local state', async () => {
      useGridStore.setState({ grids: [{ id: 1, name: 'Old' } as Grid] })
      mockInvoke.mockResolvedValue({ ok: true, data: true })

      await useGridStore.getState().updateGridMeta(1, { name: 'Renamed' })
      expect(useGridStore.getState().grids[0]!.name).toBe('Renamed')
    })
  })

  describe('reorderGrids', () => {
    it('optimistically reorders grids', async () => {
      useGridStore.setState({
        grids: [
          { id: 1, name: 'A' } as Grid,
          { id: 2, name: 'B' } as Grid,
          { id: 3, name: 'C' } as Grid,
        ],
      })
      mockInvoke.mockResolvedValue({ ok: true, data: true })

      await useGridStore.getState().reorderGrids([3, 1, 2])
      const names = useGridStore.getState().grids.map(g => g.name)
      expect(names).toEqual(['C', 'A', 'B'])
    })

    it('reloads grid list on failure', async () => {
      useGridStore.setState({
        grids: [{ id: 1, name: 'A' } as Grid, { id: 2, name: 'B' } as Grid],
      })
      // First call: GRID_REORDER fails, second call: GRID_GET_ALL succeeds
      mockInvoke
        .mockRejectedValueOnce(new Error('reorder failed'))
        .mockResolvedValueOnce({ ok: true, data: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }] })

      await useGridStore.getState().reorderGrids([2, 1])
      // loadGridList should have been called after GRID_REORDER failure
      expect(mockInvoke).toHaveBeenCalledWith('grid:reorder', [2, 1])
      expect(mockInvoke).toHaveBeenCalledWith('grid:get-all')
    })
  })
})
