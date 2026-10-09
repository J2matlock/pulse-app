/**
 * gridFilterSlice.test.ts — Tests for the filter/search/saved-filter slice of gridStore.
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
import type { ColumnFilter } from '../../../src/shared/types'

const baseState = {
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

describe('gridFilterSlice', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    useGridStore.setState(baseState)
    useUndoStore.setState({ undoStack: [], redoStack: [], toast: null, isUndoing: false })
  })

  describe('addFilter', () => {
    it('appends a filter to activeFilters', () => {
      const filter: ColumnFilter = { columnId: 1, operator: 'contains', value: 'test' }
      useGridStore.getState().addFilter(filter)
      expect(useGridStore.getState().activeFilters).toHaveLength(1)
      expect(useGridStore.getState().activeFilters[0]).toEqual(filter)
    })

    it('appends multiple filters', () => {
      useGridStore.getState().addFilter({ columnId: 1, operator: 'contains', value: 'a' })
      useGridStore.getState().addFilter({ columnId: 2, operator: 'equals', value: 'b' })
      expect(useGridStore.getState().activeFilters).toHaveLength(2)
    })
  })

  describe('removeFilter', () => {
    it('removes a filter by index', () => {
      useGridStore.setState({
        activeFilters: [
          { columnId: 1, operator: 'contains', value: 'a' },
          { columnId: 2, operator: 'equals', value: 'b' },
          { columnId: 3, operator: 'contains', value: 'c' },
        ],
      })
      useGridStore.getState().removeFilter(1)
      expect(useGridStore.getState().activeFilters).toHaveLength(2)
      expect(useGridStore.getState().activeFilters[0]!.value).toBe('a')
      expect(useGridStore.getState().activeFilters[1]!.value).toBe('c')
    })
  })

  describe('clearFilters', () => {
    it('empties the activeFilters array', () => {
      useGridStore.setState({
        activeFilters: [
          { columnId: 1, operator: 'contains', value: 'a' },
          { columnId: 2, operator: 'equals', value: 'b' },
        ],
      })
      useGridStore.getState().clearFilters()
      expect(useGridStore.getState().activeFilters).toHaveLength(0)
    })
  })

  describe('filterMode', () => {
    it('defaults to and', () => {
      expect(useGridStore.getState().filterMode).toBe('and')
    })

    it('can be set to or', () => {
      useGridStore.getState().setFilterMode('or')
      expect(useGridStore.getState().filterMode).toBe('or')
    })
  })

  describe('saved filters', () => {
    it('loadSavedFilters populates savedFilters from IPC', async () => {
      useGridStore.setState({ activeGridId: 1 })
      const savedFilters = [
        { id: 1, grid_id: 1, name: 'Active clients', filter_config: '[{"columnId":1,"operator":"contains","value":"active"}]' },
      ]
      mockInvoke.mockResolvedValue({ ok: true, data: savedFilters })

      await useGridStore.getState().loadSavedFilters()
      expect(useGridStore.getState().savedFilters).toEqual(savedFilters)
    })

    it('saveFilter calls IPC and reloads saved filters', async () => {
      useGridStore.setState({
        activeGridId: 1,
        activeFilters: [{ columnId: 1, operator: 'contains', value: 'test' }],
      })
      // First call: SAVED_FILTER_CREATE, second call: SAVED_FILTER_GET_ALL (from reload)
      mockInvoke
        .mockResolvedValueOnce({ ok: true, data: true })
        .mockResolvedValueOnce({ ok: true, data: [{ id: 1, grid_id: 1, name: 'My filter', filter_config: '[]' }] })

      await useGridStore.getState().saveFilter('My filter')
      expect(mockInvoke).toHaveBeenCalledTimes(2)
    })

    it('applySavedFilter sets activeFilters from saved filter config', () => {
      const filters: ColumnFilter[] = [{ columnId: 2, operator: 'equals', value: 'yes' }]
      useGridStore.setState({
        savedFilters: [{ id: 5, grid_id: 1, name: 'Preset', filter_config: JSON.stringify(filters) }],
      })
      useGridStore.getState().applySavedFilter(5)
      expect(useGridStore.getState().activeFilters).toEqual(filters)
    })

    it('applySavedFilter ignores corrupted config', () => {
      useGridStore.setState({
        savedFilters: [{ id: 5, grid_id: 1, name: 'Bad', filter_config: 'not-json' }],
        activeFilters: [],
      })
      useGridStore.getState().applySavedFilter(5)
      // Should remain empty since config is invalid
      expect(useGridStore.getState().activeFilters).toEqual([])
    })
  })

  describe('searchQuery', () => {
    it('updates search query', () => {
      useGridStore.getState().setSearchQuery('john')
      expect(useGridStore.getState().searchQuery).toBe('john')
    })

    it('can be cleared', () => {
      useGridStore.getState().setSearchQuery('test')
      useGridStore.getState().setSearchQuery('')
      expect(useGridStore.getState().searchQuery).toBe('')
    })
  })
})
