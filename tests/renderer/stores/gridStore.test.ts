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
import { IPC } from '../../../src/shared/ipc-channels'
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

    it('each list keeps its own filters, search, grouping and starred view (G-03)', async () => {
      const full = (id: number, colIds: number[]) => ({
        ok: true,
        data: { grid: { id, name: `L${id}`, sort_config: '[]' }, columns: colIds.map(c => makeColumn(c, `C${c}`)), hiddenColumns: [], rows: [], acuityLevels: [], cellFormats: [], rowTagsMap: {}, savedViews: [], customGroups: '[]' },
      })
      mockInvoke.mockImplementation(async (channel: string, id: number) => channel === 'grid:get-full' ? full(id, id === 1 ? [11, 12] : [21]) : { ok: true, data: null })
      await useGridStore.getState().loadGrid(1)
      useGridStore.setState({ activeFilters: [{ columnId: 11, operator: 'equals', value: 'Text' }], searchQuery: 'smith', groupByColumnId: 12, showStarredOnly: true })
      await useGridStore.getState().loadGrid(2)
      expect(useGridStore.getState()).toMatchObject({ activeFilters: [], searchQuery: '', groupByColumnId: null, showStarredOnly: false })
      await useGridStore.getState().loadGrid(1)
      expect(useGridStore.getState()).toMatchObject({ activeFilters: [{ columnId: 11, operator: 'equals', value: 'Text' }], searchQuery: 'smith', groupByColumnId: 12, showStarredOnly: true })
      mockInvoke.mockReset()
    })

    it('drops a filter or grouping on a column the list does not have (G-03)', async () => {
      useGridStore.setState({ activeGridId: 7, activeFilters: [{ columnId: 412, operator: 'equals', value: 'Text' }, { columnId: -1, operator: 'contains', value: 'vip' }], groupByColumnId: 412 })
      mockInvoke.mockResolvedValue({
        ok: true,
        data: { grid: { id: 7, name: 'L', sort_config: '[]' }, columns: [makeColumn(1, 'Name')], hiddenColumns: [], rows: [], acuityLevels: [], cellFormats: [], rowTagsMap: {}, savedViews: [], customGroups: '[]' },
      })
      await useGridStore.getState().loadGrid(7)
      expect(useGridStore.getState().activeFilters).toEqual([{ columnId: -1, operator: 'contains', value: 'vip' }])
      expect(useGridStore.getState().groupByColumnId).toBeNull()
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

  describe('refreshRows (R2)', () => {
    it('reads the records again in place: a record restored elsewhere shows, the selection stays', async () => {
      useGridStore.setState({ activeGridId: 1, isLoading: false, rows: [makeRow(1)], selectedRowIds: new Set([1]), sortedRowIds: [1] })
      mockInvoke.mockImplementation(async (channel: string) => channel === 'grid:get-full'
        ? { ok: true, data: { rows: [makeRow(1), makeRow(2)], rowTagsMap: { 2: ['new'] }, sampleRows: {} } }
        : { ok: true, data: null })
      await useGridStore.getState().refreshRows()
      const s = useGridStore.getState()
      expect(s.rows.map(r => r.row_id)).toEqual([1, 2])
      expect(s.rowTagsMap.get(2)).toEqual(['new'])
      expect(s.selectedRowIds).toEqual(new Set([1]))
      expect(s.isLoading).toBe(false)
    })

    it('does nothing while a list is loading, and drops an answer that a newer load overtook', async () => {
      useGridStore.setState({ activeGridId: 1, isLoading: true, rows: [] })
      await useGridStore.getState().refreshRows()
      expect(mockInvoke).not.toHaveBeenCalled()

      useGridStore.setState({ isLoading: false, rows: [makeRow(1)] })
      mockInvoke.mockImplementation(async () => {
        useGridStore.setState({ _loadVersion: useGridStore.getState()._loadVersion + 1 })
        return { ok: true, data: { rows: [makeRow(9)], rowTagsMap: {} } }
      })
      await useGridStore.getState().refreshRows()
      expect(useGridStore.getState().rows.map(r => r.row_id)).toEqual([1])
    })
  })

  describe('sample entries (audit 2.6)', () => {
    it('asks once, after the first edit to a sample entry, and remembers the answer', async () => {
      const row = makeRow(1)
      ;(row as Record<string, unknown>)['col_5'] = 'Sample Pat'
      useGridStore.setState({ activeGridId: 1, rows: [row, makeRow(2)], columns: [makeColumn(5, 'Name')], sampleRows: { 1: 0 }, sampleKeepPrompt: null })
      mockInvoke.mockResolvedValue({ ok: true, data: { sysLogId: null } })

      await useGridStore.getState().updateCell(2, 5, 'Real person')
      expect(useGridStore.getState().sampleKeepPrompt).toBeNull()
      await useGridStore.getState().updateCell(1, 5, 'Pat Real')
      expect(useGridStore.getState().sampleKeepPrompt).toBe(1)

      mockInvoke.mockClear()
      mockInvoke.mockResolvedValue({ ok: true, data: true })
      await useGridStore.getState().answerSampleRow(1, 'keep')
      expect(mockInvoke).toHaveBeenCalledWith('sample-data:answer', 1, 'keep')
      expect(useGridStore.getState().sampleRows).toEqual({})
      expect(useGridStore.getState().sampleKeepPrompt).toBeNull()
    })

    it('"just a sample" keeps the mark but never asks again', async () => {
      useGridStore.setState({ activeGridId: 1, rows: [makeRow(1)], columns: [makeColumn(5, 'Name')], sampleRows: { 1: 0 }, sampleKeepPrompt: 1 })
      mockInvoke.mockResolvedValue({ ok: true, data: true })
      await useGridStore.getState().answerSampleRow(1, 'sample')
      expect(useGridStore.getState().sampleRows).toEqual({ 1: 1 })
      mockInvoke.mockResolvedValue({ ok: true, data: { sysLogId: null } })
      await useGridStore.getState().updateCell(1, 5, 'Again')
      expect(useGridStore.getState().sampleKeepPrompt).toBeNull()
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

    it('a failed undo of a cell edit stays undoable instead of looking done (L-08)', async () => {
      useUndoStore.setState({ undoStack: [], redoStack: [], toast: null, isUndoing: false })
      const row = makeRow(1)
      ;(row as Record<string, unknown>)['col_5'] = 'old'
      useGridStore.setState({ activeGridId: 1, rows: [row], columns: [makeColumn(5, 'Notes')] })
      mockInvoke.mockResolvedValue({ ok: true, data: { sysLogId: null } })
      await useGridStore.getState().updateCell(1, 5, 'new')
      mockInvoke.mockResolvedValue({ ok: false, error: 'That record was deleted.' })
      await useUndoStore.getState().undo()
      expect(useUndoStore.getState().undoStack).toHaveLength(1)
      expect(useUndoStore.getState().toast?.description).toBe("Undo didn't work: That record was deleted.")
      expect((useGridStore.getState().rows[0] as Record<string, unknown>)['col_5']).toBe('new')
    })

    it('runs stage actions for a stage column that is hidden in the table (S-25)', async () => {
      const stageCol = makeColumn(9, 'Stage', { column_type: 'status', config: JSON.stringify({ options: [{ label: 'A', color: '#000' }, { label: 'B', color: '#111' }], stage: { options: [{ value: 'A' }, { value: 'B' }] } }) })
      useGridStore.setState({ activeGridId: 1, rows: [makeRow(1)], columns: [makeColumn(5, 'Notes')], hiddenColumns: [stageCol] })
      mockInvoke.mockReset()
      mockInvoke.mockResolvedValue({ ok: true, data: { previous: 'A', changed: true, sysLogIds: [], checklistItemIds: [], stamped: null } })
      await useGridStore.getState().updateCell(1, 9, 'B')
      expect(mockInvoke.mock.calls.some(c => c[0] === 'stages:move')).toBe(true)
      useGridStore.setState({ hiddenColumns: [] })
    })

    it('merges saves of one cell only while it is the latest step and moments apart (L-17)', async () => {
      useUndoStore.setState({ undoStack: [], redoStack: [], toast: null, isUndoing: false })
      const row = makeRow(1)
      ;(row as Record<string, unknown>)['col_5'] = 'a'
      useGridStore.setState({ activeGridId: 1, rows: [row], columns: [makeColumn(5, 'Phone'), makeColumn(6, 'Email')] })
      mockInvoke.mockResolvedValue({ ok: true, data: { sysLogId: null } })
      await useGridStore.getState().updateCell(1, 5, 'ab')
      await useGridStore.getState().updateCell(1, 5, 'abc')
      expect(useUndoStore.getState().undoStack).toHaveLength(1)
      expect(useUndoStore.getState().undoStack[0]!.description).toBe('Changed Phone')
      // Another cell in between: a later save of the first cell is its own step
      await useGridStore.getState().updateCell(1, 6, 'x@y.z')
      await useGridStore.getState().updateCell(1, 5, 'abcd')
      expect(useUndoStore.getState().undoStack).toHaveLength(3)
      // Long after: also its own step
      const stack = useUndoStore.getState().undoStack
      useUndoStore.setState({ undoStack: stack.map(i => ({ ...i, timestamp: i.timestamp - 60_000 })) })
      await useGridStore.getState().updateCell(1, 5, 'abcde')
      expect(useUndoStore.getState().undoStack).toHaveLength(4)
    })

    it('in a bulk action, collects the undo step and reports failure without a toast (G-26)', async () => {
      useUndoStore.setState({ undoStack: [], redoStack: [], toast: null, isUndoing: false })
      const toast = (await import('react-hot-toast')).default as unknown as { error: ReturnType<typeof vi.fn> }
      toast.error.mockClear()
      useGridStore.setState({ activeGridId: 1, rows: [makeRow(1), makeRow(2)], columns: [makeColumn(5, 'Notes')] })
      const steps: import('../../../src/renderer/stores/undoStore').UndoItem[] = []
      mockInvoke.mockResolvedValueOnce({ ok: true, data: { sysLogId: null } })
      expect(await useGridStore.getState().updateCell(1, 5, 'x', { collect: steps })).toBe(true)
      mockInvoke.mockResolvedValueOnce({ ok: false, error: 'nope' })
      expect(await useGridStore.getState().updateCell(2, 5, 'x', { collect: steps })).toBe(false)
      expect(steps).toHaveLength(1)
      expect(useUndoStore.getState().undoStack).toHaveLength(0)
      expect(toast.error).not.toHaveBeenCalled()
    })

    it('keeps the undo history when another list opens (L-16)', async () => {
      useUndoStore.setState({ undoStack: [], redoStack: [], toast: null, isUndoing: false })
      const row = makeRow(1)
      useGridStore.setState({ activeGridId: 1, rows: [row], columns: [makeColumn(5, 'Notes')] })
      mockInvoke.mockResolvedValue({ ok: true, data: { sysLogId: null } })
      await useGridStore.getState().updateCell(1, 5, 'x')
      mockInvoke.mockResolvedValue({
        ok: true,
        data: { grid: { id: 2, name: 'Other', sort_config: '[]' }, columns: [], hiddenColumns: [], rows: [], acuityLevels: [], cellFormats: [], rowTagsMap: {}, savedViews: [], customGroups: '[]' },
      })
      await useGridStore.getState().loadGrid(2)
      expect(useUndoStore.getState().undoStack).toHaveLength(1)
    })

    it('an edit typed while an undo runs gets its own undo entry (L-24)', async () => {
      useUndoStore.setState({ undoStack: [], redoStack: [], toast: null, isUndoing: true })
      const row = makeRow(1)
      ;(row as Record<string, unknown>)['col_5'] = 'old'
      useGridStore.setState({ activeGridId: 1, rows: [row], columns: [makeColumn(5, 'Notes')] })
      mockInvoke.mockResolvedValue({ ok: true, data: { sysLogId: null } })
      await useGridStore.getState().updateCell(1, 5, 'typed')
      expect(useUndoStore.getState().undoStack).toHaveLength(1)
      // The undo's own writes push nothing
      await useGridStore.getState().updateCell(1, 5, 'old', { fromUndo: true })
      expect(useUndoStore.getState().undoStack).toHaveLength(1)
      useUndoStore.setState({ isUndoing: false })
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

  describe('undo and redo of a new record keep its id (bug sweep S3)', () => {
    const loadData = { grid: { id: 1, name: 'L', sort_config: '[]' }, columns: [], hiddenColumns: [], rows: [], acuityLevels: [], cellFormats: [], rowTagsMap: {}, savedViews: [], customGroups: '[]' }
    function route(newId: number) {
      mockInvoke.mockImplementation(async (channel: string) => {
        if (channel === IPC.ROW_CREATE || channel === IPC.ROW_DUPLICATE) return { ok: true, data: newId }
        if (channel === IPC.GRID_GET_FULL) return { ok: true, data: loadData }
        return { ok: true, data: true }
      })
    }
    const callsTo = (ch: string) => mockInvoke.mock.calls.filter(c => c[0] === ch).map(c => c.slice(1))

    it('Undo of "Added new record" moves it to the Trash, and Redo brings back the same record', async () => {
      useGridStore.setState({ activeGridId: 1, rows: [] })
      route(42)
      await useGridStore.getState().addRow()
      await useUndoStore.getState().undo()
      expect(callsTo(IPC.ROW_HARD_DELETE)).toEqual([])
      expect(callsTo(IPC.ROW_DELETE)).toEqual([[42]])
      await useUndoStore.getState().redo()
      expect(callsTo(IPC.ROW_RESTORE_DELETED)).toEqual([[42]])
      // No second record is made, so edits typed into 42 can be redone
      expect(callsTo(IPC.ROW_CREATE)).toHaveLength(1)
    })

    it('Undo of a duplicate moves it to the Trash, and Redo restores it rather than duplicating again', async () => {
      useGridStore.setState({ activeGridId: 1, rows: [makeRow(1)] })
      route(77)
      await useGridStore.getState().duplicateRow(1)
      await useUndoStore.getState().undo()
      expect(callsTo(IPC.ROW_DELETE)).toEqual([[77]])
      await useUndoStore.getState().redo()
      expect(callsTo(IPC.ROW_RESTORE_DELETED)).toEqual([[77]])
      expect(callsTo(IPC.ROW_DUPLICATE)).toHaveLength(1)
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

  // The dashboard reloads when a record leaves or comes back, Undo included (R2)
  describe('archiving and reactivating', () => {
    it('tells the dashboard each time', async () => {
      const { pulseEvents } = await import('../../../src/renderer/events')
      const heard = vi.fn()
      const off = pulseEvents.on('records:archive-changed', heard)
      useGridStore.setState({ rows: [{ row_id: 5, is_active: 1 } as unknown as GridRow], columns: [] })
      mockInvoke.mockResolvedValue({ ok: true, data: true })
      await useGridStore.getState().archiveRow(5)
      await useGridStore.getState().unarchiveRow(5)
      off()
      expect(mockInvoke).toHaveBeenCalledWith('row:archive', 5, undefined)
      expect(mockInvoke).toHaveBeenCalledWith('row:unarchive', 5)
      expect(heard).toHaveBeenCalledTimes(2)
    })
  })
})
