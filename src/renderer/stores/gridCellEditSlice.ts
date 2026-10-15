import type { GridRow } from '../../shared/types'
import { isReadOnlyColumnType } from '../../shared/types'
import { IPC } from '../../shared/ipc-channels'
import { useUndoStore } from './undoStore'
import type { SideEffect, UndoItem } from './undoStore'
import { getClientName } from '../utils/clientName'
import { rlog } from '../utils/rendererLogger'
import { friendlyError } from '../utils/friendlyError'
import toast from 'react-hot-toast'
import { storeInvoke as invoke } from '../utils/safeInvoke'
import { stageConfigOf } from '../../shared/stages'
import { pulseEvents } from '../events'
import type { GridState, UpdateCellOptions } from './gridTypes'


/** Saves of the same cell closer together than this are one undo step (L-17) */
const COALESCE_MS = 3000

// O(1) coalesce index for cell edits: maps "rowId:columnId" → undo item id
// Cleared when undo stack is cleared (new non-cell push clears redo, but coalesce
// entries become stale naturally — we just check existence in the stack).
const _coalesceIndex = new Map<string, string>()

// Cell saves still on their way to main, by "rowId:columnId" (Q-044). A list load that was asked for
// before the save reads the old value; the edit is put back on top of it so it doesn't snap back.
// `confirmed` is the value main last accepted, which a failed save falls back to: an edit's own
// "before" value may be another edit that failed too, and never reached the database.
interface PendingCell { seq: number; value: string | null; confirmed: string | null; count: number }
const _pendingCells = new Map<string, PendingCell>()
// Saves that landed after a load was asked for, which that load may not have seen
const _savedCells = new Map<string, { seq: number; value: string | null }>()
let _cellSeq = 0
let _savesInFlight = 0
// Bumped on lock, so a save that lands after the lock isn't remembered in _savedCells
let _lockEpoch = 0

/** The edit count now; a load notes it when asked for and passes it to withUnsavedEdits. */
export function cellEditsSeen(): number {
  return _cellSeq
}

/** Typing after a list (re)load, a lock or a record leaving the list starts a new undo step. */
export function clearCellCoalescing(rowId?: number): void {
  if (rowId === undefined) { _coalesceIndex.clear(); return }
  for (const key of _coalesceIndex.keys()) {
    if (key.startsWith(`${rowId}:`)) _coalesceIndex.delete(key)
  }
}

/**
 * Locked: forget saved cell values (names, notes, dates people typed) so they don't stay in
 * memory while Pulse is locked (A24-11, R3-03). The load after unlock asks with a fresh
 * cellEditsSeen(), so it never needed them. Saves still on their way keep their own entry
 * in _pendingCells until main answers, then it goes as usual.
 */
export function clearCellEditMemory(): void {
  _lockEpoch++
  _savedCells.clear()
}

/** Lays edits a load can't have seen over the rows it read; `sinceSeq` is the edit count when the load was asked for. */
export function withUnsavedEdits(rows: GridRow[], sinceSeq: number): GridRow[] {
  if (!_pendingCells.size && !_savedCells.size) return rows
  const byRow = new Map<number, Array<[string, string | null]>>()
  const note = (k: string, value: string | null) => {
    const [rowId, columnId] = k.split(':').map(Number) as [number, number]
    const list = byRow.get(rowId) ?? []
    list.push([`col_${columnId}`, value])
    byRow.set(rowId, list)
  }
  for (const [k, saved] of _savedCells) if (saved.seq > sinceSeq && !_pendingCells.has(k)) note(k, saved.value)
  for (const [k, pending] of _pendingCells) note(k, pending.value)
  if (!byRow.size) return rows
  return rows.map(r => {
    const edits = byRow.get(r.row_id)
    return edits ? { ...r, ...Object.fromEntries(edits) } as GridRow : r
  })
}

type Set = (partial: Partial<GridState> | ((s: GridState) => Partial<GridState>)) => void
type Get = () => GridState

export const createCellEditSlice = (set: Set, get: Get) => ({
  isSaving: false,
  saveError: null as string | null,

  updateCell: async (rowId: number, columnId: number, value: string | null, opts?: UpdateCellOptions) => {
    // fromUndo: an undo or redo is putting a value back; it pushes nothing and a failure throws (L-08, L-24)
    const fromUndo = !!opts?.fromUndo
    // collect: a bulk action gathers each change's undo step and pushes one for all of them (G-26)
    const collect = opts?.collect
    // Computed and auto-number values are Pulse's to fill in (paste, Delete, bulk edit all land here)
    // Hidden columns too: a hidden stage column edited on the record page still runs its stage actions (S-25)
    const column = get().columns.find(c => c.id === columnId) ?? get().hiddenColumns.find(c => c.id === columnId)
    if (column && isReadOnlyColumnType(column.column_type)) return false
    // The stage column (W06): moves run their on-enter actions as one undo step
    if (column && stageConfigOf(column) && !fromUndo) {
      const { moveToStage } = await import('../utils/stageMove')
      try {
        await moveToStage(rowId, columnId, value === '' ? null : value, collect ? { collect } : undefined)
        return true
      } catch { return false }
    }
    const key = `col_${columnId}` as `col_${number}`
    // Capture previous value for undo before optimistic update
    const currentRows = get().rows
    const idx = currentRows.findIndex(r => r.row_id === rowId)
    const listValue = idx !== -1 ? (currentRows[idx]![key] as string | null) ?? null : null

    const cellKey = `${rowId}:${columnId}`
    const seq = ++_cellSeq
    const epoch = _lockEpoch
    const pending = _pendingCells.get(cellKey)
    if (pending) { pending.seq = seq; pending.value = value; pending.count++ }
    else _pendingCells.set(cellKey, { seq, value, confirmed: listValue, count: 1 })
    _savesInFlight++
    // A save is done when main has answered for this edit; the entry goes when no other edit of the cell is out
    const settle = (): PendingCell | undefined => {
      _savesInFlight = Math.max(0, _savesInFlight - 1)
      const entry = _pendingCells.get(cellKey)
      if (entry && --entry.count <= 0) _pendingCells.delete(cellKey)
      return entry
    }

    // Optimistic update — single findIndex + splice instead of find + map (O(n) → O(n) but one pass)
    if (idx !== -1) {
      const newRows = [...currentRows]
      newRows[idx] = { ...newRows[idx]!, [key]: value }
      set({ rows: newRows, isSaving: true, saveError: null })
    } else {
      set({ isSaving: true, saveError: null })
    }
    let result: { sysLogId: number | null; previous?: string | null }
    try {
      // An undo or redo writes no change note of its own: the edit's note is voided or restored by its side effect (F-028)
      result = await invoke<{ sysLogId: number | null; previous?: string | null }>(IPC.CELL_UPDATE, rowId, columnId, value, ...(fromUndo ? [{ silent: true }] : []))
    } catch (err) {
      const entry = settle()
      // Back to what main last accepted, unless a newer edit has replaced this one meanwhile (AUDIT-130, Q-044)
      const isLatest = !entry || entry.seq === seq
      const fallback = entry ? entry.confirmed : listValue
      set(s => ({
        rows: isLatest ? s.rows.map(r => r.row_id === rowId ? { ...r, [key]: fallback } : r) : s.rows,
        isSaving: _savesInFlight > 0,
        saveError: fromUndo || collect ? null : "We couldn't save your changes — try again"
      }))
      rlog.error('GridStore', 'Cell update failed', err)
      if (fromUndo) throw err
      // A bulk action counts its failures and says so once
      if (!collect) toast.error(friendlyError(err instanceof Error ? err.message : null, "We couldn't save that — try again"))
      return false
    }
    const entry = settle()
    if (entry) entry.confirmed = value
    _savedCells.delete(cellKey)
    if (epoch === _lockEpoch) _savedCells.set(cellKey, { seq, value })
    if (_savedCells.size > 500) {
      const keys = [..._savedCells.keys()]
      for (let i = 0; i < 100; i++) _savedCells.delete(keys[i]!)
    }
    try {
      set({ isSaving: _savesInFlight > 0 })
      // A record not in the open list (archived, shown on its own page) has no copy here:
      // the value it replaced comes from the database, or Undo would blank the field (F-016)
      const prevValue = idx !== -1 ? listValue : (result?.previous ?? null)
      // Lets a page showing a record that isn't in the list keep its copy current, Undo included
      pulseEvents.emit('cell:saved', { rowId, columnId, value })
      // Lets a sequence ask "correction or new start?" when its start date changes (D-37)
      if (prevValue !== value && !useUndoStore.getState().isUndoing) pulseEvents.emit('cell:changed', { rowId, columnId, from: prevValue, to: value })
      // The first edit to a made-up sample entry: ask once whether it's real now
      if (prevValue !== value && get().sampleRows[rowId] === 0 && !useUndoStore.getState().isUndoing) get().promptKeepSample(rowId)
      // Push undo for cell change (only if value actually changed)
      if (prevValue !== value && !fromUndo) {
        const col = get().columns.find(c => c.id === columnId)
        const colName = col?.name ?? opts?.columnName ?? 'cell'
        const row = get().rows.find(r => r.row_id === rowId)
        const contextLabel = row ? getClientName(row, get().columns) : opts?.recordName
        const sideEffects: SideEffect[] = result?.sysLogId != null
          ? [{ type: 'void_case_log', caseLogId: result.sysLogId }]
          : []
        const item: UndoItem = {
          id: crypto.randomUUID(),
          description: `Changed ${colName}`,
          timestamp: Date.now(),
          category: sideEffects.length > 0 ? 'logged' : 'silent',
          icon: 'pencil',
          contextLabel,
          contextId: rowId,
          sideEffects: sideEffects.length > 0 ? sideEffects : undefined,
          undo: async () => { await get().updateCell(rowId, columnId, prevValue, { fromUndo: true }) },
          redo: async () => { await get().updateCell(rowId, columnId, value, { fromUndo: true }) },
        }
        if (collect) {
          collect.push(item)
          return true
        }
        // Typing into the same cell in quick succession is one undo step, but only while it is the
        // latest step and the last keystroke-save was moments ago (L-17); otherwise it's a new step
        const undoState = useUndoStore.getState()
        const coalesceKey = `${rowId}:${columnId}`
        const top = undoState.undoStack[undoState.undoStack.length - 1]
        const existingItem = top && _coalesceIndex.get(coalesceKey) === top.id && Date.now() - top.timestamp < COALESCE_MS ? top : undefined

        if (existingItem) {
          // Coalesce: keep original undo callback, update redo + sideEffects
          useUndoStore.getState().coalesce(i => i.id === existingItem.id, {
            ...existingItem,
            timestamp: Date.now(),
            sideEffects: sideEffects.length > 0 ? [...(existingItem.sideEffects ?? []), ...sideEffects] : existingItem.sideEffects,
            category: sideEffects.length > 0 ? 'logged' : existingItem.category,
            redo: item.redo,
          }, { evenWhileUndoing: true })
        } else {
          _coalesceIndex.set(coalesceKey, item.id)
          // Cap coalesce index size to prevent unbounded memory growth
          if (_coalesceIndex.size > 500) {
            const keys = [..._coalesceIndex.keys()]
            for (let i = 0; i < 100; i++) _coalesceIndex.delete(keys[i]!)
          }
          useUndoStore.getState().push(item, { evenWhileUndoing: true })
        }
      }
      return true
    } catch (err) {
      // The value is saved; only the bookkeeping after it (undo step, events) went wrong
      rlog.error('GridStore', 'Cell saved, but its undo step could not be recorded', err)
      return true
    }
  },
})
