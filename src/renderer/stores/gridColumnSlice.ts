import type { Column } from '../../shared/types'
import { IPC } from '../../shared/ipc-channels'
import type { GridState } from './gridTypes'
import { useUndoStore } from './undoStore'
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
  addColumn: (name: string, columnType: string, config?: string, opts?: { numberExisting?: boolean }) => Promise<void>
  updateColumn: (columnId: number, updates: Partial<Column>) => Promise<void>
  deleteColumn: (columnId: number) => Promise<void>
  reorderColumns: (orderedIds: number[]) => Promise<void>
  toggleColumnVisibility: (columnId: number, visible: boolean) => Promise<void>
  /** Non-null when a column type change is waiting for user confirmation. */
  pendingColumnTypeChange: PendingColumnTypeChange | null
  /** Proceed with the pending column type change. */
  confirmColumnTypeChange: () => Promise<void>
  /** Cancel the pending column type change. */
  cancelColumnTypeChange: () => void
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
    if (!gridId) return
    const numberExisting = columnType === 'auto_number' && !!opts?.numberExisting
    try {
      const colId = await invoke<number>(IPC.COLUMN_CREATE, gridId, name, columnType)
      if (config) {
        await invoke(IPC.COLUMN_UPDATE, colId, { config })
      }
      if (numberExisting) await invoke(IPC.COLUMN_NUMBER_EXISTING, colId)
      await get().loadGrid(gridId)
      // Mutable so redo cycles always reference the most recently created column
      let activeColId = colId
      useUndoStore.getState().push({
        id: crypto.randomUUID(),
        description: `Added column "${name}"`,
        timestamp: Date.now(),
        category: 'structural',
        icon: 'type',
        undo: async () => {
          await invoke(IPC.COLUMN_DELETE, activeColId)
          const gId = get().activeGridId
          if (gId) await get().loadGrid(gId)
        },
        redo: async () => {
          const gId = get().activeGridId
          if (!gId) return
          const newColId = await invoke<number>(IPC.COLUMN_CREATE, gId, name, columnType)
          if (config) await invoke(IPC.COLUMN_UPDATE, newColId, { config })
          if (numberExisting) await invoke(IPC.COLUMN_NUMBER_EXISTING, newColId)
          activeColId = newColId
          await get().loadGrid(gId)
        },
      })
    } catch (err) {
      rlog.error('GridColumnSlice', 'Failed to add column', err)
      toast.error('Could not add column — please try again')
    }
  },

  updateColumn: async (columnId: number, updates: Partial<Column>) => {
    const prevCol = get().columns.find(c => c.id === columnId)

    // If column_type is changing, require user confirmation before proceeding
    if (updates.column_type && prevCol && updates.column_type !== prevCol.column_type) {
      set({
        pendingColumnTypeChange: {
          columnId,
          oldType: prevCol.column_type,
          newType: updates.column_type,
          updates,
        }
      })
      return
    }

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
      rlog.error('GridColumnSlice', 'Failed to update column', err)
      toast.error('Could not update column — please try again')
    }
  },

  deleteColumn: async (columnId: number) => {
    const gridId = get().activeGridId
    const col = get().columns.find(c => c.id === columnId)
    try {
      await invoke(IPC.COLUMN_DELETE, columnId)
      set(s => ({ columns: s.columns.filter(c => c.id !== columnId) }))

      // Push undo entry — Option C: recreate column structure (cells not recovered)
      if (col && gridId) {
        // Mutable so redo cycles always reference the most recently created column
        let activeColId = columnId
        useUndoStore.getState().pushWithToast({
          id: crypto.randomUUID(),
          description: `Deleted column "${col.name}"`,
          timestamp: Date.now(),
          category: 'structural',
          icon: 'Trash2',
          contextLabel: `Column "${col.name}"`,
          undo: async () => {
            const gId = get().activeGridId
            if (!gId) return
            try {
              const newColId = await invoke<number>(IPC.COLUMN_CREATE, gId, col.name, col.column_type)
              // Restore column properties (width, config, visibility, etc.)
              await invoke(IPC.COLUMN_UPDATE, newColId, {
                width: col.width,
                config: col.config,
                is_visible: col.is_visible,
                is_required: col.is_required,
                description: col.description,
                default_value: col.default_value,
                conditional_format: col.conditional_format,
              })
              activeColId = newColId
              await get().loadGrid(gId)
            } catch (err) {
              rlog.error('GridColumnSlice', 'Failed to undo column delete', err)
            }
          },
          redo: async () => {
            try {
              await invoke(IPC.COLUMN_DELETE, activeColId)
              const gId = get().activeGridId
              if (gId) await get().loadGrid(gId)
            } catch (err) {
              rlog.error('GridColumnSlice', 'Failed to redo column delete', err)
            }
          },
        })
      }
    } catch (err) {
      rlog.error('GridColumnSlice', 'Failed to delete column', err)
      toast.error('Could not delete column — please try again')
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
          const gId = get().activeGridId
          if (!gId) return
          try {
            await invoke(IPC.COLUMN_REORDER, gId, prevOrderedIds)
            await get().loadGrid(gId)
          } catch (err) {
            rlog.error('GridColumnSlice', 'Failed to undo column reorder', err)
          }
        },
        redo: async () => {
          const gId = get().activeGridId
          if (!gId) return
          try {
            await invoke(IPC.COLUMN_REORDER, gId, orderedIds)
            await get().loadGrid(gId)
          } catch (err) {
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
