import type { CellFormat, CellFormatRule } from '../../shared/types'
import { IPC } from '../../shared/ipc-channels'
import type { GridState } from './gridTypes'
import { useUndoStore } from './undoStore'
import { rlog } from '../utils/rendererLogger'
import toast from 'react-hot-toast'
import { storeInvoke as invoke } from '../utils/safeInvoke'

export interface FormatSliceState {
  cellFormats: Map<string, CellFormatRule[]>
  loadCellFormats: () => Promise<void>
  setCellFormat: (rowId: number, columnId: number, rules: CellFormatRule[]) => Promise<void>
  batchSetCellFormat: (entries: Array<{ rowId: number; columnId: number; rules: CellFormatRule[] }>) => Promise<void>
  copiedFormatRules: CellFormatRule[] | null
  setCopiedFormatRules: (rules: CellFormatRule[] | null) => void
}

type Set = (partial: Partial<GridState> | ((s: GridState) => Partial<GridState>)) => void
type Get = () => GridState

export const createFormatSlice = (set: Set, get: Get) => ({
  cellFormats: new Map<string, CellFormatRule[]>(),
  copiedFormatRules: null as CellFormatRule[] | null,
  setCopiedFormatRules: (rules: CellFormatRule[] | null) => set({ copiedFormatRules: rules }),

  loadCellFormats: async () => {
    const gridId = get().activeGridId
    if (!gridId) return
    try {
      const formats = await invoke<CellFormat[]>(IPC.CELL_FORMAT_GET_FOR_GRID, gridId)
      const map = new Map<string, CellFormatRule[]>()
      for (const f of formats) {
        try {
          const parsed = JSON.parse(f.rules)
          if (!Array.isArray(parsed) || !parsed.every((r: unknown) => r && typeof r === 'object' && 'operator' in r)) {
            rlog.error('GridFormatSlice', `Invalid cell format shape for row=${f.row_id} col=${f.column_id}`)
            continue
          }
          map.set(`${f.row_id}_${f.column_id}`, parsed)
        } catch (err) {
          rlog.error('GridFormatSlice', `Malformed cell format rules for row=${f.row_id} col=${f.column_id}`, err)
        }
      }
      set({ cellFormats: map })
    } catch (err) {
      rlog.error('GridFormatSlice', 'Failed to load cell formats', err)
    }
  },

  setCellFormat: async (rowId: number, columnId: number, rules: CellFormatRule[]) => {
    const rulesJson = JSON.stringify(rules)
    const key = `${rowId}_${columnId}`
    // Snapshot previous rules for undo
    const prevRules = get().cellFormats.get(key) ?? []
    // Optimistic update
    set(s => {
      const next = new Map(s.cellFormats)
      if (rules.length === 0) next.delete(key)
      else next.set(key, rules)
      return { cellFormats: next }
    })
    try {
      await invoke(IPC.CELL_FORMAT_SET, rowId, columnId, rulesJson)
      // Push undo entry
      const isClearing = rules.length === 0 && prevRules.length > 0
      const isAdding = rules.length > 0 && prevRules.length === 0
      useUndoStore.getState().push({
        id: crypto.randomUUID(),
        description: isClearing ? 'Cleared cell formatting' : isAdding ? 'Set cell formatting' : 'Changed cell formatting',
        timestamp: Date.now(),
        category: 'silent',
        icon: 'palette',
        undo: async () => { await get().setCellFormat(rowId, columnId, prevRules) },
        redo: async () => { await get().setCellFormat(rowId, columnId, rules) },
      })
    } catch (err) {
      rlog.error('GridFormatSlice', 'Failed to save cell format', err)
      toast.error('Could not apply formatting — please try again')
    }
  },

  batchSetCellFormat: async (entries: Array<{ rowId: number; columnId: number; rules: CellFormatRule[] }>) => {
    // Snapshot previous rules for rollback and undo (capture all before any optimistic update)
    const prevMap = new Map<string, CellFormatRule[]>()
    for (const e of entries) {
      prevMap.set(`${e.rowId}_${e.columnId}`, get().cellFormats.get(`${e.rowId}_${e.columnId}`) ?? [])
    }
    const prevEntries = entries.map(e => ({
      rowId: e.rowId,
      columnId: e.columnId,
      rules: prevMap.get(`${e.rowId}_${e.columnId}`) ?? [],
    }))
    // Optimistic update
    set(s => {
      const next = new Map(s.cellFormats)
      for (const { rowId, columnId, rules } of entries) {
        const key = `${rowId}_${columnId}`
        if (rules.length === 0) next.delete(key)
        else next.set(key, rules)
      }
      return { cellFormats: next }
    })
    try {
      await invoke(IPC.CELL_FORMAT_BATCH_SET, entries.map(e => ({
        rowId: e.rowId, columnId: e.columnId, rules: JSON.stringify(e.rules),
      })))
      // Push undo entry
      const isClearing = entries.every(e => e.rules.length === 0)
      useUndoStore.getState().push({
        id: crypto.randomUUID(),
        description: isClearing
          ? `Cleared formatting from ${entries.length} cells`
          : `Applied formatting to ${entries.length} cells`,
        timestamp: Date.now(),
        category: 'silent',
        icon: 'palette',
        undo: async () => { await get().batchSetCellFormat(prevEntries) },
        redo: async () => { await get().batchSetCellFormat(entries) },
      })
    } catch (err) {
      rlog.error('GridFormatSlice', 'Failed to batch-set cell formats', err)
      toast.error('Could not apply formatting — please try again')
      // Rollback optimistic update: restore all pre-update values
      set(s => {
        const rolled = new Map(s.cellFormats)
        for (const [key, rules] of prevMap) {
          if (rules.length === 0) rolled.delete(key)
          else rolled.set(key, rules)
        }
        return { cellFormats: rolled }
      })
    }
  },
})
