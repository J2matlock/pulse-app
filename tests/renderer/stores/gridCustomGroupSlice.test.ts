/**
 * gridCustomGroupSlice.test.ts — Tests for the custom group slice of gridStore.
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
import type { CustomGroupDef } from '../../../src/shared/types'

function makeCustomGroup(id: string, name: string, overrides: Partial<CustomGroupDef> = {}): CustomGroupDef {
  return {
    id,
    name,
    columnId: 1,
    buckets: [
      { label: 'Group A', values: ['a', 'b'] },
      { label: 'Group B', values: ['c', 'd'] },
    ],
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
  customGroups: [] as CustomGroupDef[],
  activeCustomGroupId: null as string | null,
}

describe('gridCustomGroupSlice', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    useGridStore.setState(baseState)
    useUndoStore.setState({ undoStack: [], redoStack: [], toast: null, isUndoing: false })
  })

  describe('saveCustomGroup', () => {
    it('adds a new group and persists to settings', async () => {
      mockInvoke.mockResolvedValue({ ok: true, data: true })
      const newGroup = makeCustomGroup('g1', 'By Priority')

      await useGridStore.getState().saveCustomGroup(1, newGroup)
      expect(useGridStore.getState().customGroups).toHaveLength(1)
      expect(useGridStore.getState().customGroups[0]!.name).toBe('By Priority')
      expect(mockInvoke).toHaveBeenCalledWith(
        'settings:update',
        'custom_groups_1',
        JSON.stringify([newGroup]),
      )
    })

    it('updates an existing group by id', async () => {
      const existing = makeCustomGroup('g1', 'Old Name')
      useGridStore.setState({ customGroups: [existing] })
      mockInvoke.mockResolvedValue({ ok: true, data: true })

      const updated = { ...existing, name: 'New Name' }
      await useGridStore.getState().saveCustomGroup(1, updated)

      expect(useGridStore.getState().customGroups).toHaveLength(1)
      expect(useGridStore.getState().customGroups[0]!.name).toBe('New Name')
    })

    it('rolls back on IPC failure', async () => {
      const existing = makeCustomGroup('g1', 'Stable')
      useGridStore.setState({ customGroups: [existing] })
      mockInvoke.mockResolvedValue({ ok: false, error: 'write failed' })

      const newGroup = makeCustomGroup('g2', 'Transient')
      await useGridStore.getState().saveCustomGroup(1, newGroup)

      // Should rollback to previous state (only the existing group)
      expect(useGridStore.getState().customGroups).toEqual([existing])
    })

    it('appends to existing groups', async () => {
      const g1 = makeCustomGroup('g1', 'First')
      const g2 = makeCustomGroup('g2', 'Second')
      useGridStore.setState({ customGroups: [g1] })
      mockInvoke.mockResolvedValue({ ok: true, data: true })

      await useGridStore.getState().saveCustomGroup(1, g2)
      expect(useGridStore.getState().customGroups).toHaveLength(2)
      expect(useGridStore.getState().customGroups[1]!.id).toBe('g2')
    })
  })

  describe('deleteCustomGroup', () => {
    it('removes group by id', async () => {
      const g1 = makeCustomGroup('g1', 'Keep')
      const g2 = makeCustomGroup('g2', 'Delete')
      useGridStore.setState({ customGroups: [g1, g2] })
      mockInvoke.mockResolvedValue({ ok: true, data: true })

      await useGridStore.getState().deleteCustomGroup(1, 'g2')
      expect(useGridStore.getState().customGroups).toHaveLength(1)
      expect(useGridStore.getState().customGroups[0]!.id).toBe('g1')
    })

    it('clears activeCustomGroupId if deleted group was active', async () => {
      const g1 = makeCustomGroup('g1', 'Active')
      useGridStore.setState({ customGroups: [g1], activeCustomGroupId: 'g1' })
      mockInvoke.mockResolvedValue({ ok: true, data: true })

      await useGridStore.getState().deleteCustomGroup(1, 'g1')
      expect(useGridStore.getState().activeCustomGroupId).toBeNull()
      expect(useGridStore.getState().customGroups).toHaveLength(0)
    })

    it('preserves activeCustomGroupId if different group deleted', async () => {
      const g1 = makeCustomGroup('g1', 'Active')
      const g2 = makeCustomGroup('g2', 'Other')
      useGridStore.setState({ customGroups: [g1, g2], activeCustomGroupId: 'g1' })
      mockInvoke.mockResolvedValue({ ok: true, data: true })

      await useGridStore.getState().deleteCustomGroup(1, 'g2')
      expect(useGridStore.getState().activeCustomGroupId).toBe('g1')
    })

    it('rolls back on IPC failure', async () => {
      const g1 = makeCustomGroup('g1', 'Keep')
      useGridStore.setState({ customGroups: [g1], activeCustomGroupId: 'g1' })
      mockInvoke.mockResolvedValue({ ok: false, error: 'delete failed' })

      await useGridStore.getState().deleteCustomGroup(1, 'g1')
      // Should rollback
      expect(useGridStore.getState().customGroups).toEqual([g1])
      expect(useGridStore.getState().activeCustomGroupId).toBe('g1')
    })

    it('handles deleting non-existent group gracefully', async () => {
      const g1 = makeCustomGroup('g1', 'Only')
      useGridStore.setState({ customGroups: [g1] })
      mockInvoke.mockResolvedValue({ ok: true, data: true })

      await useGridStore.getState().deleteCustomGroup(1, 'nonexistent')
      // No change — g1 remains
      expect(useGridStore.getState().customGroups).toHaveLength(1)
    })
  })

  describe('setActiveCustomGroupId', () => {
    it('sets active group id', () => {
      useGridStore.getState().setActiveCustomGroupId('g1')
      expect(useGridStore.getState().activeCustomGroupId).toBe('g1')
    })

    it('clears active group id with null', () => {
      useGridStore.setState({ activeCustomGroupId: 'g1' })
      useGridStore.getState().setActiveCustomGroupId(null)
      expect(useGridStore.getState().activeCustomGroupId).toBeNull()
    })

    it('can switch between groups', () => {
      useGridStore.getState().setActiveCustomGroupId('g1')
      expect(useGridStore.getState().activeCustomGroupId).toBe('g1')

      useGridStore.getState().setActiveCustomGroupId('g2')
      expect(useGridStore.getState().activeCustomGroupId).toBe('g2')
    })
  })

  describe('edge cases', () => {
    it('handles save with empty groups state', async () => {
      mockInvoke.mockResolvedValue({ ok: true, data: true })
      const group = makeCustomGroup('g1', 'First Group')

      await useGridStore.getState().saveCustomGroup(1, group)
      expect(useGridStore.getState().customGroups).toHaveLength(1)
    })
  })
})
