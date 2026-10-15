import type { Column, GridRow } from '../../shared/types'
import { columnTraits } from '../../shared/columnTraits'
import { IPC } from '../../shared/ipc-channels'
import { useUndoStore, rethrowIfUndoing } from './undoStore'
import { archiveReasonAction, voidReasonNotes } from './archiveReasonStore'
import type { ArchiveReasonState } from './archiveReasonStore'
import { getClientName } from '../utils/clientName'
import { wordNow } from '../utils/vocab'
import { rlog } from '../utils/rendererLogger'
import toast from 'react-hot-toast'
import { storeInvoke as invoke } from '../utils/safeInvoke'
import { pulseEvents } from '../events'
import { clearCellCoalescing } from './gridCellEditSlice'
import type { GridState } from './gridTypes'
import { motionReduced, ROW_LEAVE_MS, ROW_FLASH_MS } from '../utils/reducedMotion'

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

const blank = (v: unknown) => v === null || v === undefined || String(v).trim() === ''

/**
 * Nothing put in it that the grid can see: every column people fill (typed, or a deadline's
 * done date) is blank, and it has no star, priority or tag. Notes, files and checklists aren't
 * in the grid; ROW_DISCARD_IF_EMPTY checks those before anything is removed.
 */
export function looksUntouched(row: GridRow, s: Pick<GridState, 'columns' | 'hiddenColumns' | 'rowTagsMap'>): boolean {
  if (row.is_starred || row.acuity_level_id != null || row.is_active !== 1 || row.deleted_at) return false
  if ((s.rowTagsMap.get(row.row_id)?.length ?? 0) > 0) return false
  return [...s.columns, ...s.hiddenColumns].every(c => {
    const traits = columnTraits(c.column_type)
    return !traits.storesCells || traits.readOnly || blank(row[`col_${c.id}`])
  })
}

/** The record's own page is open (HashRouter: #/profile/12?gridId=3) */
function profileOpenFor(rowId: number): boolean {
  if (typeof window === 'undefined') return false
  const m = /^#\/profile\/(\d+)(?:[?/]|$)/.exec(window.location.hash)
  return !!m && Number(m[1]) === rowId
}

type SetState = (partial: Partial<GridState> | ((s: GridState) => Partial<GridState>)) => void
type GetState = () => GridState

let flashTimer: ReturnType<typeof setTimeout> | null = null

/** Light up a record that just arrived: added, or back from the Trash or the archive (Q6) */
function flashRow(set: SetState, rowId: number): void {
  if (flashTimer) clearTimeout(flashTimer)
  set({ flashRowId: rowId })
  flashTimer = setTimeout(() => {
    flashTimer = null
    set(s => s.flashRowId === rowId ? { flashRowId: null } : {})
  }, ROW_FLASH_MS)
}

function setLeaving(set: SetState, rowId: number, on: boolean): void {
  set(s => {
    if (s.leavingRowIds.has(rowId) === on) return {}
    const next = new Set(s.leavingRowIds)
    if (on) next.add(rowId)
    else next.delete(rowId)
    return { leavingRowIds: next }
  })
}

/**
 * A record leaving the list dims at once and closes up (Q6): the click shows it
 * landed before the save is back. Resolves when the closing-up has had its
 * time, counted from `startedAt`; at once under reduced motion.
 */
function leaveFinished(startedAt: number): Promise<void> {
  const left = motionReduced() ? 0 : ROW_LEAVE_MS - (Date.now() - startedAt)
  return left > 0 ? new Promise(resolve => setTimeout(resolve, left)) : Promise.resolve()
}

export const createRowSlice = (set: SetState, get: GetState) => ({
  rows: [] as GridRow[],
  mapRows: (fn: (row: GridRow) => GridRow) => set(s => ({ rows: s.rows.map(fn) })),
  lastAddedRowId: null as number | null,
  flashRowId: null as number | null,
  leavingRowIds: new Set<number>(),
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

  addingRow: false,
  freshRow: null as GridState['freshRow'],

  addRow: async () => {
    const gridId = get().activeGridId
    // One Add at a time (persona study R3): a double-click or Ctrl+N twice made two records
    if (!gridId || get().addingRow) return
    // The record Add just made is still empty: go back to its name rather than make another
    const fresh = get().freshRow
    const freshRow = fresh && fresh.gridId === gridId ? get().rows.find(r => r.row_id === fresh.rowId) : undefined
    if (fresh && freshRow && looksUntouched(freshRow, get())) {
      set({ lastAddedRowId: fresh.rowId, pinnedRowId: fresh.rowId })
      return
    }
    set({ addingRow: true })
    try {
      const newRowId = await invoke<number>(IPC.ROW_CREATE, gridId)
      const filled = await autoFilledValues(gridId, newRowId, get().columns)
      // Optimistic: add empty row locally (plus any number main gave it)
      const now = new Date().toISOString()
      const newRow: GridRow = {
        ...filled,
        row_id: newRowId,
        position: get().rows.length,
        is_active: 1,
        is_starred: 0,

        acuity_level_id: null,
        deleted_at: null,
        created_at: now,
        updated_at: now,
      }
      const undoId = crypto.randomUUID()
      set(s => ({ rows: [...s.rows, newRow], lastAddedRowId: newRowId, pinnedRowId: newRowId, freshRow: { rowId: newRowId, gridId, undoId, editing: false } }))
      flashRow(set, newRowId)
      // Undo moves it to the Trash and redo brings back the same record, so
      // later steps (the values typed into it) still find it by id
      useUndoStore.getState().push({
        id: undoId,
        description: `Added new ${wordNow('record')}`,
        timestamp: Date.now(),
        category: 'structural',
        icon: 'plus-circle',
        undo: async () => {
          await invoke(IPC.ROW_DELETE, newRowId)
          set(s => ({ rows: s.rows.filter(r => r.row_id !== newRowId), ...(s.freshRow?.rowId === newRowId ? { freshRow: null } : {}) }))
        },
        redo: async () => {
          await invoke(IPC.ROW_RESTORE_DELETED, newRowId)
          if (get().activeGridId === gridId) await get().loadGrid(gridId)
        },
      })
    } catch (err) {
      rlog.error('GridStore', 'Failed to add row', err)
      // The free-version limit already showed its own message
      toast.error(`We couldn't add the ${wordNow('record')} — try again`)
    } finally {
      set({ addingRow: false })
    }
  },

  discardIfUntouched: async (rowId: number) => {
    const fresh = get().freshRow
    // Add is taking it back to its name this moment
    if (!fresh || fresh.rowId !== rowId || get().lastAddedRowId === rowId) return false
    const row = get().rows.find(r => r.row_id === rowId)
    // Something was typed, starred or tagged: it's a real record now
    if (row && !looksUntouched(row, get())) { set({ freshRow: null }); return false }
    // Its page is open: what's put in it there hasn't reached the grid yet
    if (profileOpenFor(rowId)) return false
    set({ freshRow: null })
    try {
      // Main checks again, against notes, files, checklists and everything else
      const gone = await invoke<boolean>(IPC.ROW_DISCARD_IF_EMPTY, rowId)
      if (!gone) return false
      clearCellCoalescing(rowId)
      set(s => {
        const selectedRowIds = new Set(s.selectedRowIds)
        selectedRowIds.delete(rowId)
        return {
          rows: s.rows.filter(r => r.row_id !== rowId),
          selectedRowIds,
          ...(s.pinnedRowId === rowId ? { pinnedRowId: null } : {}),
          ...(s.lastAddedRowId === rowId ? { lastAddedRowId: null } : {}),
        }
      })
      // Nothing to undo: "Added new …" would bring back an empty record
      useUndoStore.getState().discardTop(fresh.undoId)
      return true
    } catch (err) {
      // Locked or closing: try again on the next load
      set(s => s.freshRow ? {} : { freshRow: fresh })
      rlog.warn('GridStore', 'Could not remove the empty new record', err)
      return false
    }
  },

  deleteRow: async (rowId: number) => {
    const startedAt = Date.now()
    setLeaving(set, rowId, true)
    try {
      const row = get().rows.find(r => r.row_id === rowId)
      const clientName = row ? getClientName(row, get().columns) : wordNow('record', { cap: true })

      // Soft-delete: row still exists in DB, just moved to trash
      await invoke(IPC.ROW_DELETE, rowId)
      // Clean up coalesce index entries for this row
      clearCellCoalescing(rowId)
      await leaveFinished(startedAt)
      set(s => ({ rows: s.rows.filter(r => r.row_id !== rowId) }))
      setLeaving(set, rowId, false)
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
          if (gridId && get().activeGridId === gridId) {
            await get().loadGrid(gridId)
            flashRow(set, rowId)
          }
        },
        redo: async () => {
          await invoke(IPC.ROW_DELETE, rowId)
          if (gridId && get().activeGridId === gridId) await get().loadGrid(gridId)
        },
      })
    } catch (err) {
      // It stays: the record comes back into view with the error
      setLeaving(set, rowId, false)
      rlog.error('GridStore', 'Failed to delete row', err)
      toast.error(`We couldn't move the ${wordNow('record')} to the Trash — try again`)
    }
  },

  archiveRow: async (rowId: number, reason?: string, opts?: { cancelAppointments?: boolean }) => {
    const row = get().rows.find(r => r.row_id === rowId)
    const clientName = row ? getClientName(row, get().columns) : wordNow('record', { cap: true })
    // Shown archived records stay (greyed); hidden ones leave the list
    const leaves = !get().showArchived
    const startedAt = Date.now()
    if (leaves) setLeaving(set, rowId, true)
    try {
      await invoke(IPC.ROW_ARCHIVE, rowId, reason)
      pulseEvents.emit('records:archive-changed')
      // Its upcoming appointments end with it, in the same undo step (audit 1.13)
      let apptSnapshot: unknown = null
      let cancelled = 0
      if (opts?.cancelAppointments) {
        try {
          // Only when it has some, as the Archive dialog's box was only there then
          if (await invoke<number>(IPC.APPT_UPCOMING_COUNT, [rowId]) > 0) {
            const res = await invoke<{ snapshot: unknown; ids?: number[] }>(IPC.APPT_CANCEL_UPCOMING, [rowId])
            apptSnapshot = res.snapshot
            cancelled = res.ids?.length ?? 0
          }
        } catch (err) {
          rlog.error('GridStore', 'Failed to cancel appointments of archived row', err)
          toast.error(`We couldn't cancel the upcoming ${wordNow('appointment', { many: true })}. You can delete them on the calendar.`)
        }
      }
      // If not showing archived, remove from view; otherwise update is_active flag
      if (leaves) await leaveFinished(startedAt)
      set(s => s.showArchived
        ? { rows: s.rows.map(r => r.row_id === rowId ? { ...r, is_active: 0 as const } : r) }
        : { rows: s.rows.filter(r => r.row_id !== rowId) }
      )
      if (leaves) setLeaving(set, rowId, false)
      // Archive doesn't ask first (Q4): a reason can be added from the toast, and the step learns it
      const reasonStep: ArchiveReasonState = { reason, noteIds: [] }
      const apptText = cancelled > 0 ? `; ${cancelled} upcoming ${wordNow('appointment', { count: cancelled })} cancelled` : ''
      useUndoStore.getState().pushWithToast({
        id: crypto.randomUUID(),
        description: `"${clientName}" archived${apptText}`,
        timestamp: Date.now(),
        category: 'structural',
        icon: 'archive',
        contextLabel: clientName,
        contextId: rowId,
        undo: async () => {
          await get().unarchiveRow(rowId)
          if (apptSnapshot) await invoke(IPC.APPT_RESTORE, apptSnapshot)
          await voidReasonNotes(reasonStep)
        },
        redo: async () => { await get().archiveRow(rowId, reasonStep.reason, opts) },
      }, reason ? undefined : { action: archiveReasonAction([rowId], `"${clientName}"`, reasonStep) })
    } catch (err) {
      if (leaves) setLeaving(set, rowId, false)
      rethrowIfUndoing(err)
      rlog.error('GridStore', 'Failed to archive row', err)
      toast.error(`We couldn't archive the ${wordNow('record')} — try again`)
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
        if (get().rows.some(r => r.row_id === rowId)) flashRow(set, rowId)
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
      toast.error(`We couldn't unarchive the ${wordNow('record')} — try again`)
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
      toast.error(`We couldn't duplicate the ${wordNow('record')} — try again`)
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
      toast.error(`We couldn't update the ${wordNow('record')} — try again`)
    }
  },
})
