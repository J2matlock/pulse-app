/**
 * gridColumnSlice.test.ts — Tests for the column management slice of gridStore.
 * Mocks window.api.invoke for all IPC calls.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock window.api before importing the store
const mockInvoke = vi.fn()
;(globalThis as Record<string, unknown>).window = { api: { invoke: mockInvoke } }

// Mock react-hot-toast
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn() } }))

// Mock crypto.randomUUID
vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2) })

import { useGridStore } from '../../../src/renderer/stores/gridStore'
import { useUndoStore } from '../../../src/renderer/stores/undoStore'
import type { Column, Grid } from '../../../src/shared/types'

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

const baseState = {
  grids: [],
  gridListLoaded: false,
  activeGridId: 1,
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

describe('gridColumnSlice', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    useGridStore.setState(baseState)
    useUndoStore.setState({ undoStack: [], redoStack: [], toast: null, isUndoing: false })
  })

  describe('addColumn', () => {
    it('calls IPC and reloads grid', async () => {
      // First call: COLUMN_CREATE returns new column id
      // Second call: loadGrid (GRID_LOAD) returns full grid data
      const mockGrid: Partial<Grid> = { id: 1, name: 'Test', sort_config: '[]' }
      mockInvoke
        .mockResolvedValueOnce({ ok: true, data: 99 }) // COLUMN_CREATE
        .mockResolvedValueOnce({
          ok: true,
          data: {
            grid: mockGrid,
            columns: [makeColumn(99, 'New Col')],
            hiddenColumns: [],
            rows: [],
            acuityLevels: [],
            cellFormats: [],
            rowTagsMap: {},
            savedViews: [],
            customGroups: '[]',
          },
        }) // loadGrid

      await useGridStore.getState().addColumn('New Col', 'text')
      expect(useGridStore.getState().columns).toHaveLength(1)
      expect(useGridStore.getState().columns[0]!.name).toBe('New Col')
    })

    it('pushes undo entry for column creation', async () => {
      const mockGrid: Partial<Grid> = { id: 1, name: 'Test', sort_config: '[]' }
      mockInvoke
        .mockResolvedValueOnce({ ok: true, data: 5 })
        .mockResolvedValueOnce({
          ok: true,
          data: {
            grid: mockGrid, columns: [], hiddenColumns: [], rows: [],
            acuityLevels: [], cellFormats: [], rowTagsMap: {}, savedViews: [], customGroups: '[]',
          },
        })

      await useGridStore.getState().addColumn('Status', 'dropdown')
      expect(useUndoStore.getState().undoStack).toHaveLength(1)
      expect(useUndoStore.getState().undoStack[0]!.description).toContain('Added column "Status"')
    })
  })

  describe('updateColumn (renameColumn)', () => {
    it('updates column name in state', async () => {
      useGridStore.setState({ columns: [makeColumn(1, 'Old Name')] })
      mockInvoke.mockResolvedValue({ ok: true, data: true })

      await useGridStore.getState().updateColumn(1, { name: 'New Name' })
      expect(useGridStore.getState().columns[0]!.name).toBe('New Name')
    })

    it('pushes undo entry when name changes', async () => {
      useGridStore.setState({ columns: [makeColumn(1, 'Before')] })
      mockInvoke.mockResolvedValue({ ok: true, data: true })

      await useGridStore.getState().updateColumn(1, { name: 'After' })
      expect(useUndoStore.getState().undoStack).toHaveLength(1)
      expect(useUndoStore.getState().undoStack[0]!.description).toContain('Renamed column')
    })

    it('does not push undo for non-name updates', async () => {
      useGridStore.setState({ columns: [makeColumn(1, 'Col')] })
      mockInvoke.mockResolvedValue({ ok: true, data: true })

      await useGridStore.getState().updateColumn(1, { width: 300 })
      expect(useUndoStore.getState().undoStack).toHaveLength(0)
    })
  })

  describe('deleteColumn', () => {
    it('removes column from columns array', async () => {
      useGridStore.setState({ columns: [makeColumn(1, 'A'), makeColumn(2, 'B')] })
      mockInvoke.mockResolvedValue({ ok: true, data: true })

      await useGridStore.getState().deleteColumn(1)
      expect(useGridStore.getState().columns).toHaveLength(1)
      expect(useGridStore.getState().columns[0]!.name).toBe('B')
    })
  })

  describe('reorderColumns', () => {
    it('reorders columns optimistically', async () => {
      useGridStore.setState({
        columns: [makeColumn(1, 'A', { position: 0 }), makeColumn(2, 'B', { position: 1 }), makeColumn(3, 'C', { position: 2 })],
      })
      mockInvoke.mockResolvedValue({ ok: true, data: true })

      await useGridStore.getState().reorderColumns([3, 1, 2])
      const cols = useGridStore.getState().columns
      expect(cols[0]!.id).toBe(3)
      expect(cols[0]!.position).toBe(0)
      expect(cols[1]!.id).toBe(1)
      expect(cols[1]!.position).toBe(1)
      expect(cols[2]!.id).toBe(2)
      expect(cols[2]!.position).toBe(2)
    })

    it('rolls back on IPC failure', async () => {
      const origCols = [makeColumn(1, 'A', { position: 0 }), makeColumn(2, 'B', { position: 1 })]
      useGridStore.setState({ columns: origCols })
      // COLUMN_REORDER fails, then loadGrid is called for consistency
      const mockGrid: Partial<Grid> = { id: 1, name: 'Test', sort_config: '[]' }
      mockInvoke
        .mockRejectedValueOnce(new Error('reorder failed'))
        .mockResolvedValueOnce({
          ok: true,
          data: {
            grid: mockGrid, columns: origCols, hiddenColumns: [], rows: [],
            acuityLevels: [], cellFormats: [], rowTagsMap: {}, savedViews: [], customGroups: '[]',
          },
        })

      await useGridStore.getState().reorderColumns([2, 1])
      // After rollback + reload, columns should match original order
      expect(useGridStore.getState().columns[0]!.id).toBe(1)
      expect(useGridStore.getState().columns[1]!.id).toBe(2)
    })
  })
})
