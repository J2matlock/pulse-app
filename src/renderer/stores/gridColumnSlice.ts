import type { Column } from '../../shared/types'
import { IPC } from '../../shared/ipc-channels'
import type { GridState } from './gridTypes'
import { useUndoStore, rethrowIfUndoing } from './undoStore'
import { rlog } from '../utils/rendererLogger'
import toast from 'react-hot-toast'
import { storeInvoke as invoke } from '../utils/safeInvoke'

/** Pending column type change awaiting user confirmation. */
export interface PendingColumnTypeChange {
  columnId: number
  oldType: string
  newType: string
  updates: Partial<Column>
}

export interface ColumnSliceState {
  /** numberExisting: for an auto-number column, also number the records already in the list */
  /** Returns the new column's id, or null if it couldn't be added */
  addColumn: (name: string, columnType: string, config?: string, opts?: { numberExisting?: boolean }) => Promise<number | null>
  /**
   * skipConfirm: a type change the person already chose (a done-date rule turning a
   * Date column into a Deadline, Decision E1) saves straight away. Returns whether it saved.
   */
  updateColumn: (columnId: number, updates: Partial<Column>, opts?: { skipConfirm?: boolean }) => Promise<boolean>
  deleteColumn: (columnId: number) => Promise<void>
  /** "Use as name": this column names the records everywhere (undoable) */
  setNameColumn: (columnId: number) => Promise<void>
  reorderColumns: (orderedIds: number[]) => Promise<void>
  toggleColumnVisibility: (columnId: number, visible: boolean) => Promise<void>
  /** Non-null when a column type change is waiting for user confirmation. */
  pendingColumnTypeChange: PendingColumnTypeChange | null
  /** Proceed with the pending column type change. */
  confirmColumnTypeChange: () => Promise<void>
  /** Cancel the pending column type change. */
  cancelColumnTypeChange: () => void
}

/** Undo steps act on their own list; only redraw it if it's the one on screen */
async function reloadIfActive(get: () => GridState, gridId: number): Promise<void> {
  if (get().activeGridId === gridId) await get().loadGrid(gridId)
}

type Set = (partial: Partial<GridState> | ((s: GridState) => Partial<GridState>)) => void
type Get = () => GridState

export const createColumnSlice = (set: Set, get: Get) => ({
  pendingColumnTypeChange: null as PendingColumnTypeChange | null,

  confirmColumnTypeChange: async () => {
    const pending = get().pendingColumnTypeChange
    if (!pending) return
    set({ pendingColumnTypeChange: null })
    // Perform the actual update (bypass the type-change guard by calling IPC directly)
    const { columnId, updates } = pending
    const prevCol = get().columns.find(c => c.id === columnId)
    try {
      await invoke(IPC.COLUMN_UPDATE, columnId, updates)
      set(s => ({
        columns: s.columns.map(c => c.id === columnId ? { ...c, ...updates } : c)
      }))
      if (prevCol && updates.name && updates.name !== prevCol.name) {
        useUndoStore.getState().push({
          id: crypto.randomUUID(),
          description: `Renamed column to "${updates.name}"`,
          timestamp: Date.now(),
          category: 'silent',
          icon: 'type',
          undo: async () => { await get().updateColumn(columnId, { name: prevCol.name }) },
          redo: async () => { await get().updateColumn(columnId, { name: updates.name }) },
        })
      }
    } catch (err) {
      rlog.error('GridColumnSlice', 'Failed to update column (confirmed type change)', err)
      toast.error('Could not update column — please try again')
    }
  },

  cancelColumnTypeChange: () => {
    set({ pendingColumnTypeChange: null })
  },

  addColumn: async (name: string, columnType: string, config?: string, opts?: { numberExisting?: boolean }) => {
    const gridId = get().activeGridId
    if (!gridId) return null
    const numberExisting = columnType === 'auto_number' && !!opts?.numberExisting
    try {
      const colId = await invoke<number>(IPC.COLUMN_CREATE, gridId, name, columnType)
      if (config) {
        await invoke(IPC.COLUMN_UPDATE, colId, { config })
      }
      if (numberExisting) await invoke(IPC.COLUMN_NUMBER_EXISTING, colId)
      await get().loadGrid(gridId)
      // Undo parks it in the Trash and redo restores that copy, so the column
      // keeps its id and the values typed into it can be redone too
      let deletedId: number | null = null
      useUndoStore.getState().push({
        id: crypto.randomUUID(),
        description: `Added column "${name}"`,
        timestamp: Date.now(),
        category: 'structural',
        icon: 'type',
        undo: async () => {
          deletedId = (await invoke(IPC.COLUMN_DELETE, colId)).deletedId
          await reloadIfActive(get, gridId)
        },
        redo: async () => {
          if (deletedId !== null) await invoke(IPC.COLUMN_RESTORE, deletedId)
          deletedId = null
          await reloadIfActive(get, gridId)
        },
      })
      return colId
    } catch (err) {
      rlog.error('GridColumnSlice', 'Failed to add column', err)
      toast.error('Could not add column — please try again')
      return null
    }
  },

  updateColumn: async (columnId: number, updates: Partial<Column>, opts?: { skipConfirm?: boolean }) => {
    const prevCol = get().columns.find(c => c.id === columnId) ?? get().hiddenColumns.find(c => c.id === columnId)
    const typeChange = !!updates.column_type && !!prevCol && updates.column_type !== prevCol.column_type

    // If column_type is changing, require user confirmation before proceeding
    if (typeChange && !opts?.skipConfirm) {
      set({
        pendingColumnTypeChange: {
          columnId,
          oldType: prevCol!.column_type,
          newType: updates.column_type!,
          updates,
        }
      })
      return false
    }

    try {
      await invoke(IPC.COLUMN_UPDATE, columnId, updates)
      set(s => ({
        columns: s.columns.map(c => c.id === columnId ? { ...c, ...updates } : c)
      }))
      const gridId = get().activeGridId
      if (typeChange && gridId) await reloadIfActive(get, gridId)
      if (prevCol && updates.name && updates.name !== prevCol.name) {
        useUndoStore.getState().push({
          id: crypto.randomUUID(),
          description: `Renamed column to "${updates.name}"`,
          timestamp: Date.now(),
          category: 'silent',
          icon: 'type',
          undo: async () => { await get().updateColumn(columnId, { name: prevCol.name }) },
          redo: async () => { await get().updateColumn(columnId, { name: updates.name }) },
        })
      }
      return true
    } catch (err) {
      rethrowIfUndoing(err)
      rlog.error('GridColumnSlice', 'Failed to update column', err)
      toast.error('Could not update column — please try again')
      return false
    }
  },

  deleteColumn: async (columnId: number) => {
    const gridId = get().activeGridId
    const col = get().columns.find(c => c.id === columnId) ?? get().hiddenColumns.find(c => c.id === columnId)
    try {
      // It goes to the Trash with its values (D1), so Undo really brings it back
      let { deletedId } = await invoke(IPC.COLUMN_DELETE, columnId)
      set(s => ({ columns: s.columns.filter(c => c.id !== columnId), hiddenColumns: s.hiddenColumns.filter(c => c.id !== columnId) }))
      if (gridId) await get().loadGrid(gridId)
      if (col && gridId) {
        useUndoStore.getState().pushWithToast({
          id: crypto.randomUUID(),
          description: `Deleted column "${col.name}"`,
          timestamp: Date.now(),
          category: 'structural',
          icon: 'Trash2',
          contextLabel: `Column "${col.name}"`,
          undo: async () => {
            await invoke(IPC.COLUMN_RESTORE, deletedId)
            await reloadIfActive(get, gridId)
          },
          redo: async () => {
            deletedId = (await invoke(IPC.COLUMN_DELETE, columnId)).deletedId
            await reloadIfActive(get, gridId)
          },
        })
      }
    } catch (err) {
      rlog.error('GridColumnSlice', 'Failed to delete column', err)
      toast.error(err instanceof Error && err.message ? err.message : 'Could not delete column — please try again')
    }
  },

  setNameColumn: async (columnId: number) => {
    const col = get().columns.find(c => c.id === columnId) ?? get().hiddenColumns.find(c => c.id === columnId)
    try {
      const { previousId } = await invoke(IPC.COLUMN_SET_NAME, columnId)
      const gridId = get().activeGridId
      if (gridId) await get().loadGrid(gridId)
      if (previousId === null || previousId === columnId) return
      const reload = async () => { const g = get().activeGridId; if (g) await get().loadGrid(g) }
      useUndoStore.getState().pushWithToast({
        id: crypto.randomUUID(),
        description: `Named by "${col?.name ?? 'column'}"`,
        timestamp: Date.now(),
        category: 'structural',
        icon: 'type',
        undo: async () => { await invoke(IPC.COLUMN_SET_NAME, previousId); await reload() },
        redo: async () => { await invoke(IPC.COLUMN_SET_NAME, columnId); await reload() },
      })
    } catch (err) {
      rlog.error('GridColumnSlice', 'Failed to set name column', err)
      toast.error(err instanceof Error && err.message ? err.message : 'Could not change the name column — please try again')
    }
  },

  toggleColumnVisibility: async (columnId: number, visible: boolean) => {
    try {
      await invoke(IPC.COLUMN_UPDATE, columnId, { is_visible: visible ? 1 : 0 })
      const gridId = get().activeGridId
      if (gridId) await get().loadGrid(gridId)
    } catch (err) {
      rlog.error('GridColumnSlice', 'Failed to toggle column visibility', err)
      toast.error('Could not update column — please try again')
    }
  },

  reorderColumns: async (orderedIds: number[]) => {
    const gridId = get().activeGridId
    if (!gridId) return
    // Save previous state for rollback and undo
    const prevColumns = get().columns
    const prevOrderedIds = prevColumns.map(c => c.id)
    // Optimistic update
    set(s => {
      const colMap = new Map(s.columns.map(c => [c.id, c]))
      const reordered = orderedIds
        .map((id, i) => { const col = colMap.get(id); return col ? { ...col, position: i } : null })
        .filter((c): c is NonNullable<typeof c> => c != null)
      return { columns: reordered }
    })
    try {
      await invoke(IPC.COLUMN_REORDER, gridId, orderedIds)

      // Push undo entry for column reorder
      useUndoStore.getState().push({
        id: crypto.randomUUID(),
        description: 'Reorder columns',
        timestamp: Date.now(),
        category: 'structural',
        icon: 'ArrowUpDown',
        contextLabel: 'Reorder columns',
        undo: async () => {
          try {
            await invoke(IPC.COLUMN_REORDER, gridId, prevOrderedIds)
            await reloadIfActive(get, gridId)
          } catch (err) {
            rethrowIfUndoing(err)
            rlog.error('GridColumnSlice', 'Failed to undo column reorder', err)
          }
        },
        redo: async () => {
          try {
            await invoke(IPC.COLUMN_REORDER, gridId, orderedIds)
            await reloadIfActive(get, gridId)
          } catch (err) {
            rethrowIfUndoing(err)
            rlog.error('GridColumnSlice', 'Failed to redo column reorder', err)
          }
        },
      })
    } catch (err) {
      rlog.error('GridColumnSlice', 'Failed to reorder columns', err)
      // Rollback to previous column order immediately
      set({ columns: prevColumns })
      // Then reload from DB to ensure consistency
      await get().loadGrid(gridId)
    }
  },
})
