import { create } from 'zustand'
import type { Grid, Column, GridRow, SortConfig, CellFormat, CellFormatRule, AcuityLevel, CustomGroupDef } from '../../shared/types'
import { isReadOnlyColumnType } from '../../shared/types'
import { IPC } from '../../shared/ipc-channels'
import { useUndoStore } from './undoStore'
import type { SideEffect, UndoItem } from './undoStore'
import { getClientName } from '../utils/clientName'
import { wordNow } from '../utils/vocab'
import { rlog } from '../utils/rendererLogger'
import toast from 'react-hot-toast'
import { storeInvoke as invoke } from '../utils/safeInvoke'
import { createFilterSlice, viewModeKey } from './gridFilterSlice'
import { createColumnSlice } from './gridColumnSlice'
import { createFormatSlice } from './gridFormatSlice'
import { createAcuitySlice } from './gridAcuitySlice'
import { createCustomGroupSlice } from './gridCustomGroupSlice'
import type { SavedView } from './gridFilterSlice'
import type { GridState } from './gridTypes'
import type { GridDeadlineContext } from '../../shared/ipc-contract'
import { stageConfigOf } from '../../shared/stages'
import { pulseEvents } from '../events'

export type { GridState } from './gridTypes'

// FilterOperator and ColumnFilter imported from shared/types
export type { FilterOperator, ColumnFilter } from '../../shared/types'

// Re-export slice types for consumers that import from gridStore
export type { SavedFilter, SavedView, SavedViewConfig } from './gridFilterSlice'


// O(1) coalesce index for cell edits: maps "rowId:columnId" → undo item id
// Cleared when undo stack is cleared (new non-cell push clears redo, but coalesce
// entries become stale naturally — we just check existence in the stack).
const _coalesceIndex = new Map<string, string>()

/** Values main filled in on a new row (auto numbers), so it shows them straight away. */
async function autoFilledValues(gridId: number, rowId: number, columns: Column[]): Promise<Partial<GridRow>> {
  const auto = columns.filter(c => c.column_type === 'auto_number')
  if (!auto.length) return {}
  try {
    const row = await invoke<GridRow | null>(IPC.ROW_GET, gridId, rowId)
    if (!row) return {}
    return Object.fromEntries(auto.map(c => [`col_${c.id}`, row[`col_${c.id}` as keyof GridRow] ?? null])) as Partial<GridRow>
  } catch (err) {
    rlog.warn('GridStore', 'Could not read the new row back', err)
    return {}
  }
}

export const useGridStore = create<GridState>((set, get) => ({
  // ── Slices ────────────────────────────────────────────────────────────
  ...createFilterSlice(set, get),
  ...createColumnSlice(set, get),
  ...createFormatSlice(set, get),
  ...createAcuitySlice(set, get),
  ...createCustomGroupSlice(set, get),

  // ── Core state ────────────────────────────────────────────────────────
  grids: [],
  gridListLoaded: false,
  activeGridId: null,
  columns: [],
  hiddenColumns: [],
  rows: [],
  isLoading: false,
  isSaving: false,
  saveError: null,
  showArchived: false,
  groupByColumnId: null,
  lastAddedRowId: null,
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
  selectedRowIds: new Set<number>(),
  frozenColumnCount: 0,

  _loadVersion: 0,

  setShowArchived: (show: boolean) => {
    set({ showArchived: show })
    const { activeGridId } = get()
    if (activeGridId) void get().loadGrid(activeGridId)
  },

  setSelectedRowIds: (ids) => {
    if (typeof ids === 'function') {
      set(s => ({ selectedRowIds: ids(s.selectedRowIds) }))
    } else {
      set({ selectedRowIds: ids })
    }
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
    try {
      const grids = await invoke<Grid[]>(IPC.GRID_GET_ALL)
      set({ grids, gridListLoaded: true })
    } catch (err) {
      rlog.error('GridStore', 'Failed to load grids', err)
      set({ gridListLoaded: true })
    }
  },

  loadGrid: async (gridId: number) => {
    // Clear undo/redo when switching to a different grid — stale callbacks reference old row/column IDs
    if (gridId !== get().activeGridId) {
      useUndoStore.getState().clear()
    }
    const version = get()._loadVersion + 1
    _coalesceIndex.clear()
    set({ isLoading: true, activeGridId: gridId, _loadVersion: version, sortedRowIds: [], selectedRowIds: new Set<number>() })
    try {
      const showArchived = get().showArchived
      const fullData = await invoke<{
        grid: Grid, columns: Column[], hiddenColumns: Column[], rows: GridRow[], acuityLevels: AcuityLevel[],
        cellFormats: CellFormat[], rowTagsMap: Record<number, string[]>,
        savedViews: SavedView[], customGroups: string | null,
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

      set({
        columns, hiddenColumns, rows, sortConfig, isLoading: false,
        acuityLevels: acuityLevels ?? [],
        acuityEnabled: grid.acuity_enabled === 1,
        cellFormats: cellFormatsMap,
        rowTagsMap: rowTagsMapParsed,
        savedViews: fullData.savedViews as SavedView[],
        customGroups,
        frozenColumnCount: grid.frozen_columns ?? 0,
      })
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
      if (get()._loadVersion === version) set({ isLoading: false })
      rlog.error('GridStore', 'Failed to load grid', err)
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
      await invoke(IPC.GRID_DELETE, gridId)
      set(s => ({
        grids: s.grids.filter(g => g.id !== gridId),
        activeGridId: s.activeGridId === gridId ? null : s.activeGridId,
        columns: s.activeGridId === gridId ? [] : s.columns,
        rows: s.activeGridId === gridId ? [] : s.rows,
      }))
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

  addRow: async () => {
    const gridId = get().activeGridId
    if (!gridId) return
    try {
      const newRowId = await invoke<number>(IPC.ROW_CREATE, gridId)
      const filled = await autoFilledValues(gridId, newRowId, get().columns)
      // Optimistic: add empty row locally (plus any number main gave it)
      const newRow: GridRow = {
        ...filled,
        row_id: newRowId,
        position: get().rows.length,
        is_active: 1,
        is_starred: 0,

        acuity_level_id: null,
        deleted_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
      set(s => ({ rows: [...s.rows, newRow], lastAddedRowId: newRowId }))
      // Container object shared between undo/redo closures.
      // Redo updates `ref.rowId` immediately after creating the new row,
      // so a subsequent undo always targets the correct (most recent) row.
      const ref = { rowId: newRowId }
      useUndoStore.getState().push({
        id: crypto.randomUUID(),
        description: `Added new ${wordNow('record')}`,
        timestamp: Date.now(),
        category: 'structural',
        icon: 'plus-circle',
        undo: async () => {
          const idToDelete = ref.rowId
          await invoke(IPC.ROW_HARD_DELETE, idToDelete)
          set(s => ({ rows: s.rows.filter(r => r.row_id !== idToDelete) }))
        },
        redo: async () => {
          const redoRowId = await invoke<number>(IPC.ROW_CREATE, gridId)
          ref.rowId = redoRowId
          const redoFilled = await autoFilledValues(gridId, redoRowId, get().columns)
          const redoRow: GridRow = {
            ...redoFilled,
            row_id: redoRowId,
            position: get().rows.length,
            is_active: 1,
            is_starred: 0,
    
            acuity_level_id: null,
            deleted_at: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }
          set(s => ({ rows: [...s.rows, redoRow] }))
        },
      })
    } catch (err) {
      rlog.error('GridStore', 'Failed to add row', err)
      // The free-version limit already showed its own message
      toast.error(`Could not add ${wordNow('record')} — please try again`)
    }
  },

  deleteRow: async (rowId: number) => {
    try {
      const row = get().rows.find(r => r.row_id === rowId)
      const clientName = row ? getClientName(row, get().columns) : wordNow('record', { cap: true })

      // Soft-delete: row still exists in DB, just moved to trash
      await invoke(IPC.ROW_DELETE, rowId)
      // Clean up coalesce index entries for this row
      for (const key of _coalesceIndex.keys()) {
        if (key.startsWith(`${rowId}:`)) _coalesceIndex.delete(key)
      }
      set(s => ({ rows: s.rows.filter(r => r.row_id !== rowId) }))

      const gridId = get().activeGridId
      useUndoStore.getState().pushWithToast({
        id: crypto.randomUUID(),
        description: `"${clientName}" moved to trash`,
        timestamp: Date.now(),
        category: 'structural',
        icon: 'trash',
        contextLabel: clientName,
        contextId: rowId,
        undo: async () => {
          await invoke(IPC.ROW_RESTORE_DELETED, rowId)
          if (gridId && get().activeGridId === gridId) await get().loadGrid(gridId)
        },
        redo: async () => {
          await invoke(IPC.ROW_DELETE, rowId)
          if (gridId && get().activeGridId === gridId) await get().loadGrid(gridId)
        },
      })
    } catch (err) {
      rlog.error('GridStore', 'Failed to delete row', err)
      toast.error(`Could not delete ${wordNow('record')} — please try again`)
    }
  },

  archiveRow: async (rowId: number, reason?: string) => {
    const row = get().rows.find(r => r.row_id === rowId)
    const clientName = row ? getClientName(row, get().columns) : wordNow('record', { cap: true })
    try {
      await invoke(IPC.ROW_ARCHIVE, rowId, reason)
      // If not showing archived, remove from view; otherwise update is_active flag
      set(s => s.showArchived
        ? { rows: s.rows.map(r => r.row_id === rowId ? { ...r, is_active: 0 as const } : r) }
        : { rows: s.rows.filter(r => r.row_id !== rowId) }
      )
      useUndoStore.getState().pushWithToast({
        id: crypto.randomUUID(),
        description: `"${clientName}" archived`,
        timestamp: Date.now(),
        category: 'structural',
        icon: 'archive',
        contextLabel: clientName,
        contextId: rowId,
        undo: async () => { await get().unarchiveRow(rowId) },
        redo: async () => { await get().archiveRow(rowId, reason) },
      })
    } catch (err) {
      rlog.error('GridStore', 'Failed to archive row', err)
      toast.error(`Could not archive ${wordNow('record')} — please try again`)
    }
  },

  unarchiveRow: async (rowId: number) => {
    const row = get().rows.find(r => r.row_id === rowId)
    const clientName = row ? getClientName(row, get().columns) : wordNow('record', { cap: true })
    try {
      await invoke(IPC.ROW_UNARCHIVE, rowId)
      const rowExists = get().rows.some(r => r.row_id === rowId)
      if (rowExists) {
        set(s => ({ rows: s.rows.map(r => r.row_id === rowId ? { ...r, is_active: 1 as const } : r) }))
      } else {
        // Row was removed from view when archived — reload the grid to bring it back
        const gridId = get().activeGridId
        if (gridId) await get().loadGrid(gridId)
      }
      useUndoStore.getState().push({
        id: crypto.randomUUID(),
        description: `"${clientName}" unarchived`,
        timestamp: Date.now(),
        category: 'structural',
        icon: 'user-plus',
        contextLabel: clientName,
        contextId: rowId,
        undo: async () => { await get().archiveRow(rowId) },
        redo: async () => { await get().unarchiveRow(rowId) },
      })
    } catch (err) {
      rlog.error('GridStore', 'Failed to unarchive row', err)
      // The free-version limit already showed its own message
      toast.error(`Could not unarchive ${wordNow('record')} — please try again`)
    }
  },

  duplicateRow: async (rowId: number) => {
    const gridId = get().activeGridId
    if (!gridId) return
    try {
      let currentNewRowId = await invoke<number>(IPC.ROW_DUPLICATE, rowId)
      await get().loadGrid(gridId)
      // Get client name after grid reload for a meaningful description
      const sourceRow = get().rows.find(r => r.row_id === rowId)
      const clientName = sourceRow ? getClientName(sourceRow, get().columns) : wordNow('record', { cap: true })
      useUndoStore.getState().pushWithToast({
        id: crypto.randomUUID(),
        description: `Duplicated "${clientName}"`,
        timestamp: Date.now(),
        category: 'structural',
        icon: 'copy',
        contextLabel: clientName,
        contextId: currentNewRowId,
        undo: async () => {
          await invoke(IPC.ROW_HARD_DELETE, currentNewRowId)
          if (gridId && get().activeGridId === gridId) await get().loadGrid(gridId)
        },
        redo: async () => {
          if (!gridId) return
          currentNewRowId = await invoke<number>(IPC.ROW_DUPLICATE, rowId)
          if (get().activeGridId === gridId) await get().loadGrid(gridId)
        },
      })
    } catch (err) {
      rlog.error('GridStore', 'Failed to duplicate row', err)
      // The free-version limit already showed its own message
      toast.error(`Could not duplicate ${wordNow('record')} — please try again`)
    }
  },

  updateRow: async (rowId, updates) => {
    // Capture previous values for rollback
    const prevRow = get().rows.find(r => r.row_id === rowId)
    const prevValues: Partial<{ is_starred: 0 | 1 }> = {}
    if (prevRow) {
      if (updates.is_starred !== undefined) prevValues.is_starred = prevRow.is_starred
    }
    // Optimistic update
    set(s => ({ rows: s.rows.map(r => r.row_id === rowId ? { ...r, ...updates } : r) }))
    try {
      await invoke(IPC.ROW_UPDATE, rowId, updates)
    } catch (err) {
      // Rollback to previous values
      if (prevRow) {
        set(s => ({ rows: s.rows.map(r => r.row_id === rowId ? { ...r, ...prevValues } : r) }))
      }
      rlog.error('GridStore', 'Failed to update row', err)
      toast.error(`Could not update ${wordNow('record')} — please try again`)
    }
  },

  reorderRows: async (orderedIds: number[]) => {
    const gridId = get().activeGridId
    if (!gridId) return
    const snapshot = get().rows
    // Optimistic update
    set(s => {
      const rowMap = new Map(s.rows.map(r => [r.row_id, r]))
      const reordered = orderedIds
        .map((id, i) => { const row = rowMap.get(id); return row ? { ...row, position: i } : null })
        .filter((r): r is NonNullable<typeof r> => r != null)
      return { rows: reordered }
    })
    try {
      await invoke(IPC.ROW_REORDER, gridId, orderedIds)
    } catch (err) {
      set({ rows: snapshot })
      rlog.error('GridStore', 'Failed to reorder rows', err)
      toast.error(`Could not reorder ${wordNow('record', { many: true })} — please try again`)
    }
  },

  updateCell: async (rowId: number, columnId: number, value: string | null) => {
    // Computed and auto-number values are Pulse's to fill in (paste, Delete, bulk edit all land here)
    const column = get().columns.find(c => c.id === columnId)
    if (column && isReadOnlyColumnType(column.column_type)) return
    // The stage column (W06): moves run their on-enter actions as one undo step
    if (column && stageConfigOf(column) && !useUndoStore.getState().isUndoing) {
      const { moveToStage } = await import('../utils/stageMove')
      await moveToStage(rowId, columnId, value === '' ? null : value)
      return
    }
    const key = `col_${columnId}` as `col_${number}`
    // Capture previous value for undo before optimistic update
    const currentRows = get().rows
    const idx = currentRows.findIndex(r => r.row_id === rowId)
    const prevValue = idx !== -1 ? (currentRows[idx]![key] as string | null) ?? null : null

    // Optimistic update — single findIndex + splice instead of find + map (O(n) → O(n) but one pass)
    if (idx !== -1) {
      const newRows = [...currentRows]
      newRows[idx] = { ...newRows[idx]!, [key]: value }
      set({ rows: newRows, isSaving: true, saveError: null })
    } else {
      set({ isSaving: true, saveError: null })
    }
    try {
      const result = await invoke<{ sysLogId: number | null }>(IPC.CELL_UPDATE, rowId, columnId, value)
      set({ isSaving: false })
      // Lets a sequence ask "correction or new start?" when its start date changes (D-37)
      if (prevValue !== value && !useUndoStore.getState().isUndoing) pulseEvents.emit('cell:changed', { rowId, columnId, from: prevValue, to: value })
      // Push undo for cell change (only if value actually changed)
      if (prevValue !== value) {
        const col = get().columns.find(c => c.id === columnId)
        const colName = col?.name ?? 'cell'
        const row = get().rows.find(r => r.row_id === rowId)
        const contextLabel = row ? getClientName(row, get().columns) : undefined
        const sideEffects: SideEffect[] = result.sysLogId != null
          ? [{ type: 'void_case_log', caseLogId: result.sysLogId }]
          : []
        // During rapid edits to the same cell, keep the ORIGINAL prevValue
        // so undo restores to the state before the first edit, not an intermediate one.
        const undoState = useUndoStore.getState()
        const undoDesc = `Changed ${colName} [${columnId}]`
        const coalesceKey = `${rowId}:${columnId}`
        const cachedItemId = _coalesceIndex.get(coalesceKey)

        // Near-O(1) lookup: coalesce targets are usually near the top of the stack.
        // Search from the end (most recent) for better average-case performance.
        let existingItem: UndoItem | undefined
        if (cachedItemId) {
          const stack = undoState.undoStack
          for (let i = stack.length - 1; i >= 0; i--) {
            if (stack[i]!.id === cachedItemId) { existingItem = stack[i]; break }
          }
          if (!existingItem) _coalesceIndex.delete(coalesceKey) // stale entry
        }

        if (existingItem) {
          // Coalesce: keep original undo callback, update redo + sideEffects
          const matchPredicate = (item: UndoItem) => item.id === existingItem!.id
          useUndoStore.getState().coalesce(matchPredicate, {
            ...existingItem,
            timestamp: Date.now(),
            sideEffects: sideEffects.length > 0 ? sideEffects : existingItem.sideEffects,
            redo: async () => { await get().updateCell(rowId, columnId, value) },
          })
        } else {
          const newItemId = crypto.randomUUID()
          _coalesceIndex.set(coalesceKey, newItemId)
          // Cap coalesce index size to prevent unbounded memory growth
          if (_coalesceIndex.size > 500) {
            const keys = [..._coalesceIndex.keys()]
            for (let i = 0; i < 100; i++) _coalesceIndex.delete(keys[i]!)
          }
          useUndoStore.getState().push({
            id: newItemId,
            description: undoDesc,
            timestamp: Date.now(),
            category: sideEffects.length > 0 ? 'logged' : 'silent',
            icon: 'pencil',
            contextLabel,
            contextId: rowId,
            sideEffects: sideEffects.length > 0 ? sideEffects : undefined,
            undo: async () => { await get().updateCell(rowId, columnId, prevValue) },
            redo: async () => { await get().updateCell(rowId, columnId, value) },
          })
        }
      }
    } catch (err) {
      // Rollback optimistic update to previous value
      set(s => ({
        rows: s.rows.map(r => r.row_id === rowId ? { ...r, [key]: prevValue } : r),
        isSaving: false,
        saveError: "We couldn't save your changes — please try again."
      }))
      rlog.error('GridStore', 'Cell update failed', err)
      toast.error('Could not save — please try again')
    }
  },

}))
