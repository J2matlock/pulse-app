/**
 * gridFormatSlice.test.ts — Tests for the cell format slice of gridStore.
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
import type { CellFormatRule } from '../../../src/shared/types'

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
  cellFormats: new Map<string, CellFormatRule[]>(),
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

const sampleRule: CellFormatRule = {
  operator: 'contains',
  value: 'urgent',
  bg: '#ff0000',
  fg: '#ffffff',
  bold: true,
  italic: false,
}

describe('gridFormatSlice', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    useGridStore.setState(baseState)
    useUndoStore.setState({ undoStack: [], redoStack: [], toast: null, isUndoing: false })
  })

  describe('setCellFormat', () => {
    it('updates format for a cell optimistically', async () => {
      mockInvoke.mockResolvedValue({ ok: true, data: true })

      await useGridStore.getState().setCellFormat(1, 5, [sampleRule])
      const formats = useGridStore.getState().cellFormats
      expect(formats.get('1_5')).toEqual([sampleRule])
    })

    it('pushes undo entry when setting format', async () => {
      mockInvoke.mockResolvedValue({ ok: true, data: true })

      await useGridStore.getState().setCellFormat(1, 5, [sampleRule])
      expect(useUndoStore.getState().undoStack).toHaveLength(1)
      expect(useUndoStore.getState().undoStack[0]!.description).toBe('Set cell formatting')
    })

    it('describes clearing when rules are empty', async () => {
      // Set initial format
      const initialMap = new Map<string, CellFormatRule[]>([['1_5', [sampleRule]]])
      useGridStore.setState({ cellFormats: initialMap })
      mockInvoke.mockResolvedValue({ ok: true, data: true })

      await useGridStore.getState().setCellFormat(1, 5, [])
      expect(useGridStore.getState().cellFormats.has('1_5')).toBe(false)
      expect(useUndoStore.getState().undoStack[0]!.description).toBe('Cleared cell formatting')
    })
  })

  describe('clearCellFormat (setCellFormat with empty rules)', () => {
    it('removes format entry from the map', async () => {
      const initialMap = new Map<string, CellFormatRule[]>([['2_3', [sampleRule]]])
      useGridStore.setState({ cellFormats: initialMap })
      mockInvoke.mockResolvedValue({ ok: true, data: true })

      await useGridStore.getState().setCellFormat(2, 3, [])
      expect(useGridStore.getState().cellFormats.has('2_3')).toBe(false)
    })
  })

  describe('batchSetCellFormat', () => {
    it('sets multiple cell formats at once', async () => {
      mockInvoke.mockResolvedValue({ ok: true, data: true })

      await useGridStore.getState().batchSetCellFormat([
        { rowId: 1, columnId: 1, rules: [sampleRule] },
        { rowId: 2, columnId: 1, rules: [{ ...sampleRule, value: 'other' }] },
      ])

      const formats = useGridStore.getState().cellFormats
      expect(formats.size).toBe(2)
      expect(formats.get('1_1')).toEqual([sampleRule])
    })
  })
})
