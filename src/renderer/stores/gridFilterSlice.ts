import type { ColumnFilter, SortConfig } from '../../shared/types'
import { IPC } from '../../shared/ipc-channels'
import type { GridState } from './gridTypes'
import { rlog } from '../utils/rendererLogger'
import toast from 'react-hot-toast'
import { storeInvoke as invoke } from '../utils/safeInvoke'

export interface SavedFilter {
  id: number
  grid_id: number
  name: string
  filter_config: string  // JSON: ColumnFilter[]
}

export interface SavedViewConfig {
  sortConfig: SortConfig[]
  activeFilters: ColumnFilter[]
  filterMode: 'and' | 'or'
  hiddenColumnIds: number[]
  groupByColumnId: number | string | null
  showStarredOnly: boolean
  /** Table or board (W06); older views have none and open as a table */
  viewMode?: ViewMode
}

export type ViewMode = 'table' | 'board'

export interface SavedView {
  id: number
  grid_id: number
  name: string
  config: string  // JSON: SavedViewConfig
}

export interface FilterSliceState {
  /** Table or board (W06), remembered per list */
  viewMode: ViewMode
  setViewMode: (mode: ViewMode) => void
  /** The built-in Tags column (G-37): a record's tags, shown in the table; each list remembers it */
  showTagsColumn: boolean
  setShowTagsColumn: (show: boolean) => void
  filterMode: 'and' | 'or'
  setFilterMode: (mode: 'and' | 'or') => void
  activeFilters: ColumnFilter[]
  addFilter: (filter: ColumnFilter) => void
  removeFilter: (index: number) => void
  clearFilters: () => void
  showStarredOnly: boolean
  setShowStarredOnly: (show: boolean) => void
  groupByColumnId: number | string | null
  setGroupByColumnId: (id: number | string | null) => void
  savedFilters: SavedFilter[]
  loadSavedFilters: () => Promise<void>
  saveFilter: (name: string) => Promise<void>
  deleteSavedFilter: (id: number) => Promise<void>
  applySavedFilter: (id: number) => void
  savedViews: SavedView[]
  loadSavedViews: () => Promise<void>
  saveCurrentView: (name: string) => Promise<void>
  applySavedView: (id: number) => void
  deleteSavedView: (id: number) => Promise<void>
  searchQuery: string
  setSearchQuery: (query: string) => void
  findReplaceQuery: string
  setFindReplaceQuery: (query: string) => void
  findReplaceActiveMatch: { rowId: number; colId: number } | null
  setFindReplaceActiveMatch: (match: { rowId: number; colId: number } | null) => void
  sortConfig: SortConfig[]
  setSortConfig: (config: SortConfig[]) => Promise<void>
  sortedRowIds: number[]
  setSortedRowIds: (ids: number[]) => void
  rowTagsMap: Map<number, string[]>
}

type Set = (partial: Partial<GridState> | ((s: GridState) => Partial<GridState>)) => void
type Get = () => GridState

// Type guard: ensures a JSON-parsed value is a valid ColumnFilter before use in state
function isColumnFilter(v: unknown): v is ColumnFilter {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const f = v as Record<string, unknown>
  return typeof f.columnId === 'number' && typeof f.operator === 'string' && typeof f.value === 'string'
}

export const viewModeKey = (gridId: number) => `grid_view_mode_${gridId}`
export const tagsColumnKey = (gridId: number) => `grid_tags_column_${gridId}`

export const createFilterSlice = (set: Set, get: Get) => ({
  viewMode: 'table' as ViewMode,
  showTagsColumn: false,
  setShowTagsColumn: (show: boolean) => {
    set({ showTagsColumn: show })
    const gridId = get().activeGridId
    if (gridId) invoke(IPC.SETTINGS_UPDATE, tagsColumnKey(gridId), show ? '1' : '0').catch(err => rlog.warn('GridFilterSlice', 'Could not save the tags column choice', err))
  },
  setViewMode: (mode: ViewMode) => {
    set({ viewMode: mode })
    const gridId = get().activeGridId
    if (gridId) invoke(IPC.SETTINGS_UPDATE, viewModeKey(gridId), mode).catch(err => rlog.warn('GridFilterSlice', 'Could not save view mode', err))
  },
  // ── Filter state ──────────────────────────────────────────────────────
  filterMode: 'and' as 'and' | 'or',
  setFilterMode: (mode: 'and' | 'or') => set({ filterMode: mode }),
  showStarredOnly: false,
  setShowStarredOnly: (show: boolean) => set({ showStarredOnly: show }),
  groupByColumnId: null as number | string | null,
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

  activeFilters: [] as ColumnFilter[],
  addFilter: (filter: ColumnFilter) => set(s => ({ activeFilters: [...s.activeFilters, filter] })),
  removeFilter: (index: number) => set(s => ({ activeFilters: s.activeFilters.filter((_, i) => i !== index) })),
  clearFilters: () => set({ activeFilters: [] }),

  // ── Saved filter presets ──────────────────────────────────────────────
  savedFilters: [] as SavedFilter[],
  loadSavedFilters: async () => {
    const { activeGridId } = get()
    if (!activeGridId) { rlog.warn('GridFilterSlice', 'loadSavedFilters: no activeGridId'); return }
    try {
      const rows = await invoke<SavedFilter[]>(IPC.SAVED_FILTER_GET_ALL, activeGridId)
      set({ savedFilters: rows })
    } catch (err) {
      rlog.error('GridFilterSlice', 'loadSavedFilters failed', err)
    }
  },
  saveFilter: async (name: string) => {
    const { activeGridId, activeFilters } = get()
    if (!activeGridId || activeFilters.length === 0) {
      rlog.warn('GridFilterSlice', `saveFilter bail: gridId=${activeGridId} filters=${activeFilters.length}`)
      return
    }
    try {
      await invoke(IPC.SAVED_FILTER_CREATE, activeGridId, name, JSON.stringify(activeFilters))
      await get().loadSavedFilters()
    } catch (err) {
      rlog.error('GridFilterSlice', 'saveFilter failed', err)
      toast.error("We couldn't save the filter — try again")
    }
  },
  deleteSavedFilter: async (id: number) => {
    try {
      await invoke(IPC.SAVED_FILTER_DELETE, id)
      set(s => ({ savedFilters: s.savedFilters.filter(f => f.id !== id) }))
    } catch (err) {
      rlog.error('GridFilterSlice', 'deleteSavedFilter failed', err)
      toast.error("We couldn't delete the saved filter — try again")
    }
  },
  applySavedFilter: (id: number) => {
    const { savedFilters } = get()
    const sf = savedFilters.find(f => f.id === id)
    if (!sf) return
    try {
      const parsed: unknown = JSON.parse(sf.filter_config)
      if (!Array.isArray(parsed) || !parsed.every(isColumnFilter)) {
        rlog.error('GridFilterSlice', `Corrupted filter_config for saved filter ${sf.id} — skipping`)
        return
      }
      set({ activeFilters: parsed })
    } catch (err) {
      rlog.error('GridFilterSlice', 'Failed to parse saved filter config', err)
    }
  },

  // ── Saved views ───────────────────────────────────────────────────────
  savedViews: [] as SavedView[],
  loadSavedViews: async () => {
    const { activeGridId } = get()
    if (!activeGridId) return
    try {
      const rows = await invoke<SavedView[]>(IPC.SAVED_VIEW_GET_ALL, activeGridId)
      set({ savedViews: rows })
    } catch (err) {
      rlog.error('GridFilterSlice', 'loadSavedViews failed', err)
    }
  },
  saveCurrentView: async (name: string) => {
    const { activeGridId, sortConfig, activeFilters, filterMode, hiddenColumns, groupByColumnId, showStarredOnly, viewMode } = get()
    if (!activeGridId) return
    const config: SavedViewConfig = {
      sortConfig,
      activeFilters,
      filterMode,
      hiddenColumnIds: hiddenColumns.map(c => c.id),
      groupByColumnId,
      showStarredOnly,
      viewMode,
    }
    try {
      await invoke(IPC.SAVED_VIEW_CREATE, activeGridId, name, JSON.stringify(config))
      await get().loadSavedViews()
    } catch (err) {
      rlog.error('GridFilterSlice', 'saveCurrentView failed', err)
      toast.error("We couldn't save the view — try again")
    }
  },
  applySavedView: (id: number) => {
    const { savedViews } = get()
    const sv = savedViews.find(v => v.id === id)
    if (!sv) return
    try {
      const parsed: unknown = JSON.parse(sv.config)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        rlog.error('GridFilterSlice', `Corrupted saved view config for view ${sv.id} — skipping`)
        return
      }
      const config = parsed as Partial<SavedViewConfig>
      // Saved view JSON is untrusted: keep only well-formed sort entries
      const rawSort: unknown[] = Array.isArray(config.sortConfig) ? config.sortConfig : []
      const sortConfig = rawSort.flatMap((s, i): SortConfig[] => {
        if (!s || typeof s !== 'object') return []
        const { columnId, direction, priority } = s as Record<string, unknown>
        if (typeof columnId !== 'number' || (direction !== 'asc' && direction !== 'desc')) return []
        return [{ columnId, direction, priority: typeof priority === 'number' ? priority : i + 1 }]
      })
      set({
        sortConfig,
        activeFilters: Array.isArray(config.activeFilters) && config.activeFilters.every(isColumnFilter)
          ? config.activeFilters
          : [],
        filterMode: config.filterMode === 'or' ? 'or' : 'and',
        groupByColumnId: config.groupByColumnId ?? null,
        showStarredOnly: config.showStarredOnly === true,
        viewMode: config.viewMode === 'board' ? 'board' : 'table',
      })
      // Persist sort config to DB
      const gridId = get().activeGridId
      if (gridId) invoke(IPC.SORT_UPDATE, gridId, sortConfig).catch(err => rlog.error('GridFilterSlice', 'Failed to persist sort config', err))
      // Batch-update column visibility in one IPC call + one DB transaction
      const applyVisibility = async () => {
        const allCols = [...get().columns, ...get().hiddenColumns]
        const hiddenSet = new Set(config.hiddenColumnIds ?? [])
        const updates: { columnId: number; isVisible: 0 | 1 }[] = []
        for (const col of allCols) {
          const shouldBeVisible = !hiddenSet.has(col.id)
          const isCurrentlyVisible = col.is_visible !== 0
          if (shouldBeVisible !== isCurrentlyVisible) {
            updates.push({ columnId: col.id, isVisible: shouldBeVisible ? 1 : 0 })
          }
        }
        if (updates.length > 0) {
          await invoke(IPC.COLUMN_BATCH_UPDATE_VISIBILITY, updates)
        }
        const gId = get().activeGridId
        if (gId) await get().loadGrid(gId)
      }
      applyVisibility().catch(err => rlog.error('GridFilterSlice', 'Failed to apply visibility', err))
    } catch (err) {
      rlog.error('GridFilterSlice', 'Failed to apply saved view config', err)
    }
  },
  deleteSavedView: async (id: number) => {
    try {
      await invoke(IPC.SAVED_VIEW_DELETE, id)
      set(s => ({ savedViews: s.savedViews.filter(v => v.id !== id) }))
    } catch (err) {
      rlog.error('GridFilterSlice', 'deleteSavedView failed', err)
      toast.error("We couldn't delete the saved view — try again")
    }
  },

  // ── Search ────────────────────────────────────────────────────────────
  searchQuery: '',
  setSearchQuery: (query: string) => set({ searchQuery: query }),
  findReplaceQuery: '',
  setFindReplaceQuery: (query: string) => set({ findReplaceQuery: query }),
  findReplaceActiveMatch: null,
  setFindReplaceActiveMatch: (match: FilterSliceState['findReplaceActiveMatch']) => set({ findReplaceActiveMatch: match }),

  // ── Sort ──────────────────────────────────────────────────────────────
  sortConfig: [] as SortConfig[],
  setSortConfig: async (config: SortConfig[]) => {
    const gridId = get().activeGridId
    if (!gridId) return
    set({ sortConfig: config })
    try {
      await invoke(IPC.SORT_UPDATE, gridId, config)
    } catch (err) {
      rlog.error('GridFilterSlice', 'Failed to save sort config', err)
    }
  },

  // ── Sorted row IDs (written by DataGrid for ProfileView prev/next) ──
  sortedRowIds: [] as number[],
  setSortedRowIds: (ids: number[]) => set({ sortedRowIds: ids }),

  // ── Row tags map ──────────────────────────────────────────────────────
  rowTagsMap: new Map<number, string[]>(),
})
