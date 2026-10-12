import { create } from 'zustand'
import type { Grid, Column, GridRow, SortConfig, CellFormat, CellFormatRule, AcuityLevel, CustomGroupDef } from '../../shared/types'
import { ROW_TAG_COLUMN_ID, ANY_DEADLINE_COLUMN_ID } from '../../shared/types'
import { IPC } from '../../shared/ipc-channels'
import { useUndoStore } from './undoStore'
import { wordNow } from '../utils/vocab'
import { rlog } from '../utils/rendererLogger'
import toast from 'react-hot-toast'
import { storeInvoke as invoke } from '../utils/safeInvoke'
import { createFilterSlice, viewModeKey, tagsColumnKey } from './gridFilterSlice'
import { createColumnSlice } from './gridColumnSlice'
import { createFormatSlice } from './gridFormatSlice'
import { createAcuitySlice } from './gridAcuitySlice'
import { createCustomGroupSlice } from './gridCustomGroupSlice'
import { createRowSlice } from './gridRowSlice'
import { createCellEditSlice, cellEditsSeen, clearCellCoalescing, withUnsavedEdits } from './gridCellEditSlice'
import type { SavedView } from './gridFilterSlice'
import type { GridState } from './gridTypes'

/** What narrows a list on screen; each list keeps its own (G-03) */
type ListView = Pick<GridState, 'activeFilters' | 'filterMode' | 'searchQuery' | 'groupByColumnId' | 'showStarredOnly'>
const DEFAULT_LIST_VIEW: ListView = { activeFilters: [], filterMode: 'and', searchQuery: '', groupByColumnId: null, showStarredOnly: false }
const _listViews = new Map<number, ListView>()
import type { GridDeadlineContext } from '../../shared/ipc-contract'
import { pulseEvents } from '../events'

export type { GridState } from './gridTypes'

export type { FilterOperator } from '../../shared/types'

// Re-export slice types for consumers that import from gridStore
export type { SavedView } from './gridFilterSlice'


// Only the newest list-of-lists fetch may land, so a slow one from before setup can't wipe the new lists
let _gridListSeq = 0

export const useGridStore = create<GridState>((set, get) => ({
  // ── Slices ────────────────────────────────────────────────────────────
  ...createFilterSlice(set, get),
  ...createColumnSlice(set, get),
  ...createFormatSlice(set, get),
  ...createAcuitySlice(set, get),
  ...createCustomGroupSlice(set, get),
  ...createCellEditSlice(set, get),
  ...createRowSlice(set, get),

  // ── Core state ────────────────────────────────────────────────────────
  grids: [],
  gridListLoaded: false,
  activeGridId: null,
  columns: [],
  hiddenColumns: [],
  rows: [],
  isLoading: false,
  loadedGridId: null,
  loadError: null,
  showArchived: false,
  groupByColumnId: null,
  deadlineContext: { meter: {}, quota: {}, progress: {}, extensions: {} },
  refreshDeadlineContext: async () => {
    const gridId = get().activeGridId
    if (!gridId) return
    try {
      const ctx = await invoke<GridDeadlineContext>(IPC.GRID_DEADLINE_CONTEXT, gridId)
      if (get().activeGridId === gridId && ctx && typeof ctx === 'object' && ctx.meter) set({ deadlineContext: ctx })
    } catch (err) {
      rlog.warn('GridStore', 'Could not refresh deadline context', err)
    }
  },
  refreshLinkValues: async () => {
    const gridId = get().activeGridId
    if (!gridId || !get().columns.concat(get().hiddenColumns).some(c => c.column_type === 'link')) return
    try {
      const values = await invoke<Array<Record<string, unknown>>>(IPC.GRID_LINK_VALUES, gridId)
      if (get().activeGridId !== gridId || !Array.isArray(values)) return
      const byRow = new Map(values.map(v => [v.row_id as number, v]))
      set({ rows: get().rows.map(r => { const v = byRow.get(r.row_id); return v ? { ...r, ...v } as GridRow : r }) })
    } catch (err) {
      rlog.warn('GridStore', 'Could not refresh links', err)
    }
  },
  refreshRows: async () => {
    const { activeGridId: gridId, _loadVersion: version, isLoading, showArchived } = get()
    if (!gridId || isLoading) return
    const editsSeen = cellEditsSeen()
    try {
      const data = await invoke<{ rows: GridRow[]; rowTagsMap: Record<number, string[]>; sampleRows?: Record<number, number> }>(IPC.GRID_GET_FULL, gridId, showArchived)
      // A list opened or loaded meanwhile wins
      if (get()._loadVersion !== version || get().activeGridId !== gridId || !data || !Array.isArray(data.rows)) return
      const rowTagsMap = new Map(Object.entries(data.rowTagsMap ?? {}).map(([k, v]) => [Number(k), v]))
      set({
        rows: withUnsavedEdits(data.rows, editsSeen),
        rowTagsMap,
        sampleRows: data.sampleRows ?? {},
      })
      void get().refreshDeadlineContext()
      // The first tag added on a record's page brings the Tags column in (G-37), unless it was turned off
      if (!get().showTagsColumn && rowTagsMap.size > 0) {
        const tagsCol = await invoke<string | null>(IPC.SETTINGS_GET, tagsColumnKey(gridId))
        if (tagsCol !== '0' && get()._loadVersion === version && get().activeGridId === gridId) set({ showTagsColumn: true })
      }
    } catch (err) {
      rlog.warn('GridStore', 'Could not refresh the list', err)
    }
  },
  frozenColumnCount: 0,

  _loadVersion: 0,

  setShowArchived: (show: boolean) => {
    set({ showArchived: show })
    const { activeGridId } = get()
    if (activeGridId) void get().loadGrid(activeGridId)
  },

  setFrozenColumnCount: (count: number) => {
    set({ frozenColumnCount: count })
    const gridId = get().activeGridId
    if (gridId) {
      void invoke(IPC.GRID_UPDATE, gridId, { frozen_columns: count })
    }
  },

  setGroupByColumnId: (id: string | number | null) => {
    if (typeof id === 'string') {
      if (id === '__acuity__') {
        set({ groupByColumnId: id })
      } else {
        const parsed = parseInt(id, 10)
        set({ groupByColumnId: Number.isNaN(parsed) ? null : parsed })
      }
    } else {
      set({ groupByColumnId: id })
    }
  },

  loadGridList: async () => {
    const seq = ++_gridListSeq
    try {
      const grids = await invoke<Grid[]>(IPC.GRID_GET_ALL)
      if (seq !== _gridListSeq) return
      set({ grids, gridListLoaded: true })
    } catch (err) {
      rlog.error('GridStore', 'Failed to load grids', err)
      if (seq === _gridListSeq) set({ gridListLoaded: true })
    }
  },

  loadGrid: async (gridId: number) => {
    // The undo stack survives switching lists (L-16): every step works by row and column id and
    // reloads only the list it belongs to. It's cleared on lock, restore and sample removal.
    const version = get()._loadVersion + 1
    clearCellCoalescing()
    // Another list: put this one's filters, search and grouping away and bring back that one's (G-03)
    const prevGridId = get().activeGridId
    if (prevGridId !== gridId) {
      if (prevGridId !== null) {
        const s = get()
        _listViews.set(prevGridId, { activeFilters: s.activeFilters, filterMode: s.filterMode, searchQuery: s.searchQuery, groupByColumnId: s.groupByColumnId, showStarredOnly: s.showStarredOnly })
      }
      set({ ...(_listViews.get(gridId) ?? DEFAULT_LIST_VIEW), loadedGridId: null })
    }
    set({ isLoading: true, loadError: null, activeGridId: gridId, _loadVersion: version, sortedRowIds: [], selectedRowIds: new Set<number>(), pinnedRowId: null })
    const editsSeen = cellEditsSeen()
    try {
      const showArchived = get().showArchived
      const fullData = await invoke<{
        grid: Grid, columns: Column[], hiddenColumns: Column[], rows: GridRow[], acuityLevels: AcuityLevel[],
        cellFormats: CellFormat[], rowTagsMap: Record<number, string[]>,
        savedViews: SavedView[], customGroups: string | null, sampleRows?: Record<number, number>,
      }>(IPC.GRID_GET_FULL, gridId, showArchived)
      // Discard stale response if another loadGrid was called while awaiting
      if (get()._loadVersion !== version) return
      const { grid, columns, hiddenColumns, rows, acuityLevels } = fullData
      let sortConfig: SortConfig[] = []
      try {
        const parsedSort: unknown = JSON.parse(grid.sort_config || '[]')
        if (Array.isArray(parsedSort)) sortConfig = parsedSort.filter((s: unknown) =>
          typeof s === 'object' && s !== null && 'columnId' in s && 'direction' in s
        ) as SortConfig[]
      } catch { /* malformed sort_config — default to no sort */ }

      // Process cell formats from batched response
      const cellFormatsMap = new Map<string, CellFormatRule[]>()
      for (const f of fullData.cellFormats) {
        try {
          const parsed = JSON.parse(f.rules)
          if (!Array.isArray(parsed) || !parsed.every((r: unknown) => r && typeof r === 'object' && 'operator' in r)) continue
          cellFormatsMap.set(`${f.row_id}_${f.column_id}`, parsed)
        } catch { /* skip malformed */ }
      }

      // Process row tags map from batched response
      const rowTagsMapParsed = new Map<number, string[]>(
        Object.entries(fullData.rowTagsMap).map(([k, v]) => [Number(k), v])
      )

      // Process custom groups from batched response
      let customGroups: CustomGroupDef[] = []
      if (fullData.customGroups) {
        try { customGroups = JSON.parse(fullData.customGroups) } catch { /* ignore */ }
      }

      // A filter or grouping on a column this list doesn't have would hide everything (G-03)
      const known = new Set([...columns, ...hiddenColumns].map(c => c.id))
      const { activeFilters, groupByColumnId } = get()
      const keptFilters = activeFilters.filter(f => f.columnId === ROW_TAG_COLUMN_ID || f.columnId === ANY_DEADLINE_COLUMN_ID || known.has(f.columnId))
      set({
        ...(keptFilters.length !== activeFilters.length ? { activeFilters: keptFilters } : {}),
        ...(typeof groupByColumnId === 'number' && !known.has(groupByColumnId) ? { groupByColumnId: null } : {}),
        columns, hiddenColumns, rows: withUnsavedEdits(rows, editsSeen), sortConfig, isLoading: false, loadedGridId: gridId,
        acuityLevels: acuityLevels ?? [],
        acuityEnabled: grid.acuity_enabled === 1,
        cellFormats: cellFormatsMap,
        rowTagsMap: rowTagsMapParsed,
        savedViews: fullData.savedViews as SavedView[],
        customGroups,
        frozenColumnCount: grid.frozen_columns ?? 0,
        sampleRows: fullData.sampleRows ?? {},
        sampleKeepPrompt: null,
      })
      // The Tags column: as last chosen for this list, else shown when any record has tags (G-37)
      try {
        const tagsCol = await invoke<string | null>(IPC.SETTINGS_GET, tagsColumnKey(gridId))
        if (get()._loadVersion === version) set({ showTagsColumn: tagsCol === '1' || (tagsCol !== '0' && rowTagsMapParsed.size > 0) })
      } catch { /* leave it as it was */ }
      // Table or board, as last left for this list (W06)
      // Awaited, so a caller that sets the mode after loading (dashboard → board) wins
      try {
        const mode = await invoke<string | null>(IPC.SETTINGS_GET, viewModeKey(gridId))
        if (get()._loadVersion === version) set({ viewMode: mode === 'board' ? 'board' : 'table' })
      } catch { /* table it is */ }
      // Meter readings and the like for deadline colors; the grid shows without them first
      void invoke<GridDeadlineContext>(IPC.GRID_DEADLINE_CONTEXT, gridId)
        .then(ctx => { if (get()._loadVersion === version && ctx && typeof ctx === 'object' && ctx.meter) set({ deadlineContext: ctx }) })
        .catch(err => rlog.warn('GridStore', 'Could not load deadline context', err))
    } catch (err) {
      rlog.error('GridStore', 'Failed to load grid', err)
      if (get()._loadVersion !== version) return
      if (get().loadedGridId === gridId) {
        // A reload of the open list: what's on screen is still this list's, so keep it and say so
        set({ isLoading: false })
        toast.error(`We couldn't refresh this ${wordNow('list')}. Please try again.`)
      } else {
        // Another list's records must not show under this one's name (AUDIT-041)
        set({
          isLoading: false, columns: [], hiddenColumns: [], rows: [], cellFormats: new Map(), rowTagsMap: new Map(),
          sampleRows: {}, deadlineContext: { meter: {}, quota: {}, progress: {}, extensions: {} },
          loadError: `We couldn't open this ${wordNow('list')}.`,
        })
      }
    }
  },

  createGrid: async (name: string) => {
    try {
      const id = await invoke<number>(IPC.GRID_CREATE, name)
      await get().loadGridList()
      return id
    } catch (err) {
      rlog.error('GridStore', 'Failed to create grid', err)
      toast.error(`Could not create ${wordNow('list')} — please try again`)
      return null
    }
  },

  deleteGrid: async (gridId: number) => {
    try {
      const name = get().grids.find(g => g.id === gridId)?.name ?? wordNow('list', { cap: true })
      await invoke(IPC.GRID_DELETE, gridId)
      set(s => ({
        grids: s.grids.filter(g => g.id !== gridId),
        activeGridId: s.activeGridId === gridId ? null : s.activeGridId,
        columns: s.activeGridId === gridId ? [] : s.columns,
        rows: s.activeGridId === gridId ? [] : s.rows,
      }))
      pulseEvents.emit('records:trashed', {})
      // In the Trash, so Undo brings it back (D1)
      useUndoStore.getState().pushWithToast({
        id: crypto.randomUUID(),
        description: `Moved "${name}" to the Trash`,
        timestamp: Date.now(),
        category: 'structural',
        icon: 'Trash2',
        undo: async () => { await invoke(IPC.GRID_RESTORE, gridId); await get().loadGridList() },
        redo: async () => {
          await invoke(IPC.GRID_DELETE, gridId)
          if (get().activeGridId === gridId) set({ activeGridId: null, columns: [], rows: [] })
          await get().loadGridList()
        },
      })
    } catch (err) {
      rlog.error('GridStore', 'Failed to delete grid', err)
      toast.error(`Could not delete ${wordNow('list')} — please try again`)
    }
  },

  updateGridMeta: async (gridId: number, updates: Partial<Grid>) => {
    try {
      await invoke(IPC.GRID_UPDATE, gridId, updates)
      // Reflect name change locally so sidebar updates immediately
      if (updates.name !== undefined) {
        set(s => ({ grids: s.grids.map(g => g.id === gridId ? { ...g, name: updates.name! } : g) }))
      }
    } catch (err) {
      rlog.error('GridStore', 'Failed to update grid', err)
      toast.error(`Could not rename ${wordNow('list')} — please try again`)
    }
  },

  reorderGrids: async (orderedIds: number[]) => {
    // Optimistic local update first
    set(s => {
      const map = new Map(s.grids.map(g => [g.id, g]))
      const reordered = orderedIds.map(id => map.get(id)!).filter(Boolean)
      return { grids: reordered }
    })
    try {
      await invoke(IPC.GRID_REORDER, orderedIds)
    } catch (err) {
      rlog.error('GridStore', 'Failed to reorder grids', err)
      toast.error(`Could not reorder ${wordNow('list', { many: true })} — please try again`)
      // Reload to restore correct order on failure
      await get().loadGridList()
    }
  },

}))

// Locked: drop the open list's records (A24-11). The list and its view settings stay,
// so unlocking reloads the same list (GridView sees loadedGridId is null)
pulseEvents.on('app:locked', () => {
  clearCellCoalescing()
  useGridStore.setState(s => ({
    rows: [],
    rowTagsMap: new Map<number, string[]>(),
    sortedRowIds: [],
    selectedRowIds: new Set<number>(),
    sampleRows: {},
    sampleKeepPrompt: null,
    lastAddedRowId: null,
    pinnedRowId: null,
    deadlineContext: { meter: {}, quota: {}, progress: {}, extensions: {} },
    loadedGridId: null,
    isLoading: false,
    // A load still on its way back is dropped
    _loadVersion: s._loadVersion + 1,
  }))
})
