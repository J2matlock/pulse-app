/**
 * gridAcuitySlice.test.ts — Tests for the acuity scoring slice of gridStore.
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
import type { AcuityLevel, GridRow } from '../../../src/shared/types'
import { setWords } from '../vocabFixture'

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

function makeAcuityLevel(id: number, name: string, overrides: Partial<AcuityLevel> = {}): AcuityLevel {
  return {
    id,
    grid_id: 1,
    name,
    abbreviation: name[0]!,
    points: id * 10,
    color: '#ff0000',
    position: id - 1,
    created_at: '2026-01-01T00:00:00',
    ...overrides,
  }
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

describe('gridAcuitySlice', () => {
  beforeEach(() => {
    setWords()
    mockInvoke.mockReset()
    useGridStore.setState(baseState)
    useUndoStore.setState({ undoStack: [], redoStack: [], toast: null, isUndoing: false })
  })

  describe('reloadAcuityLevels', () => {
    it('loads levels from IPC', async () => {
      const levels = [makeAcuityLevel(1, 'Low'), makeAcuityLevel(2, 'High')]
      mockInvoke.mockResolvedValue({ ok: true, data: levels })

      await useGridStore.getState().reloadAcuityLevels()
      expect(useGridStore.getState().acuityLevels).toEqual(levels)
    })

    it('does nothing without activeGridId', async () => {
      useGridStore.setState({ activeGridId: null })

      await useGridStore.getState().reloadAcuityLevels()
      expect(mockInvoke).not.toHaveBeenCalled()
      expect(useGridStore.getState().acuityLevels).toEqual([])
    })
  })

  describe('toggleAcuity', () => {
    it('enables acuity and reloads levels', async () => {
      const levels = [makeAcuityLevel(1, 'Critical')]
      mockInvoke
        .mockResolvedValueOnce({ ok: true, data: true }) // ACUITY_TOGGLE
        .mockResolvedValueOnce({ ok: true, data: levels }) // ACUITY_GET_LEVELS (via reloadAcuityLevels)

      await useGridStore.getState().toggleAcuity(true)
      expect(useGridStore.getState().acuityEnabled).toBe(true)
      expect(useGridStore.getState().acuityLevels).toEqual(levels)
    })

    it('disables acuity without reloading levels', async () => {
      useGridStore.setState({ acuityEnabled: true, acuityLevels: [makeAcuityLevel(1, 'X')] })
      mockInvoke.mockResolvedValue({ ok: true, data: true })

      await useGridStore.getState().toggleAcuity(false)
      expect(useGridStore.getState().acuityEnabled).toBe(false)
      // Should only call ACUITY_TOGGLE, not ACUITY_GET_LEVELS
      expect(mockInvoke).toHaveBeenCalledTimes(1)
    })
  })

  describe('setRowAcuityLevel', () => {
    it('assigns level to row optimistically', async () => {
      useGridStore.setState({ rows: [makeRow(1)] })
      mockInvoke.mockResolvedValue({ ok: true, data: true })

      await useGridStore.getState().setRowAcuityLevel(1, 5)
      expect(useGridStore.getState().rows[0]!.acuity_level_id).toBe(5)
    })

    it('pushes undo entry when level changes', async () => {
      useGridStore.setState({ rows: [makeRow(1, { acuity_level_id: 2 })] })
      mockInvoke.mockResolvedValue({ ok: true, data: true })

      await useGridStore.getState().setRowAcuityLevel(1, 5)
      expect(useUndoStore.getState().undoStack).toHaveLength(1)
      expect(useUndoStore.getState().undoStack[0]!.description).toBe('Changed acuity level')
    })

    it('does not push undo when level is unchanged', async () => {
      useGridStore.setState({ rows: [makeRow(1, { acuity_level_id: 5 })] })
      mockInvoke.mockResolvedValue({ ok: true, data: true })

      await useGridStore.getState().setRowAcuityLevel(1, 5)
      expect(useUndoStore.getState().undoStack).toHaveLength(0)
    })

    it('rolls back on IPC failure', async () => {
      useGridStore.setState({ rows: [makeRow(1, { acuity_level_id: 2 })] })
      mockInvoke.mockRejectedValue(new Error('DB error'))

      await useGridStore.getState().setRowAcuityLevel(1, 99)
      expect(useGridStore.getState().rows[0]!.acuity_level_id).toBe(2)
    })

    it('can clear acuity level by setting null', async () => {
      useGridStore.setState({ rows: [makeRow(1, { acuity_level_id: 3 })] })
      mockInvoke.mockResolvedValue({ ok: true, data: true })

      await useGridStore.getState().setRowAcuityLevel(1, null)
      expect(useGridStore.getState().rows[0]!.acuity_level_id).toBeNull()
    })
  })

  describe('createAcuityLevel', () => {
    it('adds new level to acuityLevels', async () => {
      const newLevel = makeAcuityLevel(10, 'Urgent')
      mockInvoke.mockResolvedValue({ ok: true, data: newLevel })

      const result = await useGridStore.getState().createAcuityLevel({
        name: 'Urgent', abbreviation: 'U', points: 100, color: '#ff0000',
      })
      expect(result).toEqual(newLevel)
      expect(useGridStore.getState().acuityLevels).toHaveLength(1)
    })

    it('returns null on failure', async () => {
      mockInvoke.mockRejectedValue(new Error('fail'))

      const result = await useGridStore.getState().createAcuityLevel({
        name: 'Fail', abbreviation: 'F', points: 0, color: '#000',
      })
      expect(result).toBeNull()
    })
  })

  describe('deleteAcuityLevel', () => {
    it('removes level and clears row assignments', async () => {
      useGridStore.setState({
        acuityLevels: [makeAcuityLevel(1, 'A'), makeAcuityLevel(2, 'B')],
        rows: [makeRow(1, { acuity_level_id: 1 }), makeRow(2, { acuity_level_id: 2 })],
      })
      mockInvoke.mockResolvedValue({ ok: true, data: true })

      await useGridStore.getState().deleteAcuityLevel(1)
      expect(useGridStore.getState().acuityLevels).toHaveLength(1)
      expect(useGridStore.getState().acuityLevels[0]!.id).toBe(2)
      // Row that had level 1 should now be null
      expect(useGridStore.getState().rows[0]!.acuity_level_id).toBeNull()
      // Row with level 2 should be unchanged
      expect(useGridStore.getState().rows[1]!.acuity_level_id).toBe(2)
    })
  })
})
