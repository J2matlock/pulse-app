import type { Column, GridRow } from '../../shared/types'
import { IPC } from '../../shared/ipc-channels'
import { useUndoStore, rethrowIfUndoing } from './undoStore'
import { getClientName } from '../utils/clientName'
import { wordNow } from '../utils/vocab'
import { rlog } from '../utils/rendererLogger'
import toast from 'react-hot-toast'
import { storeInvoke as invoke } from '../utils/safeInvoke'
import { pulseEvents } from '../events'
import { clearCellCoalescing } from './gridCellEditSlice'
import type { GridState } from './gridTypes'

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

type SetState = (partial: Partial<GridState> | ((s: GridState) => Partial<GridState>)) => void
type GetState = () => GridState

export const createRowSlice = (set: SetState, get: GetState) => ({
  rows: [] as GridRow[],
  mapRows: (fn: (row: GridRow) => GridRow) => set(s => ({ rows: s.rows.map(fn) })),
  lastAddedRowId: null as number | null,
  pinnedRowId: null as number | null,
  sampleRows: {} as Record<number, number>,
  sampleKeepPrompt: null as number | null,
  answerSampleRow: async (rowId: number, answer: 'keep' | 'sample' | 'later') => {
    set(s => {
      const sampleRows = { ...s.sampleRows }
      if (answer === 'keep') delete sampleRows[rowId]
      else if (rowId in sampleRows) sampleRows[rowId] = answer === 'sample' ? 1 : 2
      return { sampleRows, sampleKeepPrompt: null }
    })
    try {
      await invoke(IPC.SAMPLE_ROW_ANSWER, rowId, answer)
      if (answer === 'keep') pulseEvents.emit('sample-data:changed')
    } catch (err) {
      rlog.warn('GridStore', 'Could not save the sample answer', err)
    }
  },
  promptKeepSample: (rowId: number) => set({ sampleKeepPrompt: rowId }),
  selectedRowIds: new Set<number>(),
  setSelectedRowIds: (ids: Set<number> | ((prev: Set<number>) => Set<number>)) => {
    if (typeof ids === 'function') {
      set(s => ({ selectedRowIds: ids(s.selectedRowIds) }))
    } else {
      set({ selectedRowIds: ids })
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
      set(s => ({ rows: [...s.rows, newRow], lastAddedRowId: newRowId, pinnedRowId: newRowId }))
      // Undo moves it to the Trash and redo brings back the same record, so
      // later steps (the values typed into it) still find it by id
      useUndoStore.getState().push({
        id: crypto.randomUUID(),
        description: `Added new ${wordNow('record')}`,
        timestamp: Date.now(),
        category: 'structural',
        icon: 'plus-circle',
        undo: async () => {
          await invoke(IPC.ROW_DELETE, newRowId)
          set(s => ({ rows: s.rows.filter(r => r.row_id !== newRowId) }))
        },
        redo: async () => {
          await invoke(IPC.ROW_RESTORE_DELETED, newRowId)
          if (get().activeGridId === gridId) await get().loadGrid(gridId)
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
      clearCellCoalescing(rowId)
      set(s => ({ rows: s.rows.filter(r => r.row_id !== rowId) }))
      pulseEvents.emit('records:trashed', { rowIds: [rowId] })

      const gridId = get().activeGridId
      useUndoStore.getState().pushWithToast({
        id: crypto.randomUUID(),
        description: `"${clientName}" moved to the Trash`,
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

  archiveRow: async (rowId: number, reason?: string, opts?: { cancelAppointments?: boolean }) => {
    const row = get().rows.find(r => r.row_id === rowId)
    const clientName = row ? getClientName(row, get().columns) : wordNow('record', { cap: true })
    try {
      await invoke(IPC.ROW_ARCHIVE, rowId, reason)
      pulseEvents.emit('records:archive-changed')
      // Its upcoming appointments end with it, in the same undo step (audit 1.13)
      let apptSnapshot: unknown = null
      if (opts?.cancelAppointments) {
        try {
          apptSnapshot = (await invoke<{ snapshot: unknown }>(IPC.APPT_CANCEL_UPCOMING, [rowId])).snapshot
        } catch (err) {
          rlog.error('GridStore', 'Failed to cancel appointments of archived row', err)
          toast.error(`We couldn't cancel the upcoming ${wordNow('appointment', { many: true })}. You can delete them on the calendar.`)
        }
      }
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
        undo: async () => {
          await get().unarchiveRow(rowId)
          if (apptSnapshot) await invoke(IPC.APPT_RESTORE, apptSnapshot)
        },
        redo: async () => { await get().archiveRow(rowId, reason, opts) },
      })
    } catch (err) {
      rethrowIfUndoing(err)
      rlog.error('GridStore', 'Failed to archive row', err)
      toast.error(`Could not archive ${wordNow('record')} — please try again`)
    }
  },

  unarchiveRow: async (rowId: number) => {
    const row = get().rows.find(r => r.row_id === rowId)
    const clientName = row ? getClientName(row, get().columns) : wordNow('record', { cap: true })
    try {
      await invoke(IPC.ROW_UNARCHIVE, rowId)
      pulseEvents.emit('records:archive-changed')
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
      rethrowIfUndoing(err)
      rlog.error('GridStore', 'Failed to unarchive row', err)
      // The free-version limit already showed its own message
      toast.error(`Could not unarchive ${wordNow('record')} — please try again`)
    }
  },

  duplicateRow: async (rowId: number) => {
    const gridId = get().activeGridId
    if (!gridId) return null
    try {
      const newRowId = await invoke<number>(IPC.ROW_DUPLICATE, rowId)
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
        contextId: newRowId,
        // To the Trash and back, keeping the id later steps refer to
        undo: async () => {
          await invoke(IPC.ROW_DELETE, newRowId)
          if (get().activeGridId === gridId) await get().loadGrid(gridId)
        },
        redo: async () => {
          await invoke(IPC.ROW_RESTORE_DELETED, newRowId)
          if (get().activeGridId === gridId) await get().loadGrid(gridId)
        },
      })
      return newRowId
    } catch (err) {
      rlog.error('GridStore', 'Failed to duplicate row', err)
      // The free-version limit already showed its own message
      toast.error(`Could not duplicate ${wordNow('record')} — please try again`)
      return null
    }
  },

  updateRow: async (rowId: number, updates: Partial<{ is_starred: 0 | 1 }>) => {
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
})
