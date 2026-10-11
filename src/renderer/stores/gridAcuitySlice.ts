import type { AcuityLevel } from '../../shared/types'
import { IPC } from '../../shared/ipc-channels'
import type { GridState } from './gridTypes'
import { useUndoStore, rethrowIfUndoing } from './undoStore'
import { rlog } from '../utils/rendererLogger'
import toast from 'react-hot-toast'
import { storeInvoke as invoke } from '../utils/safeInvoke'
import { wordNow } from '../utils/vocab'

export interface AcuitySliceState {
  acuityLevels: AcuityLevel[]
  acuityEnabled: boolean
  toggleAcuity: (enabled: boolean) => Promise<void>
  setRowAcuityLevel: (rowId: number, levelId: number | null) => Promise<void>
  bulkSetRowAcuityLevel: (rowIds: number[], levelId: number | null) => Promise<void>
  createAcuityLevel: (data: { name: string; abbreviation: string; points: number; color: string }) => Promise<AcuityLevel | null>
  updateAcuityLevel: (levelId: number, updates: Partial<{ name: string; abbreviation: string; points: number; color: string }>) => Promise<void>
  deleteAcuityLevel: (levelId: number) => Promise<void>
  reorderAcuityLevels: (orderedIds: number[]) => Promise<void>
  reloadAcuityLevels: () => Promise<void>
}

type Set = (partial: Partial<GridState> | ((s: GridState) => Partial<GridState>)) => void
type Get = () => GridState

export const createAcuitySlice = (set: Set, get: Get) => ({
  // ── Acuity state ────────────────────────────────────────────────────
  acuityLevels: [] as AcuityLevel[],
  acuityEnabled: false,

  toggleAcuity: async (enabled: boolean) => {
    const gridId = get().activeGridId
    if (!gridId) return
    try {
      await invoke(IPC.ACUITY_TOGGLE, gridId, enabled)
      set({ acuityEnabled: enabled })
      if (enabled) {
        // Reload levels from DB so we see any that already exist
        await get().reloadAcuityLevels()
      }
    } catch (err) {
      rlog.error('GridAcuitySlice', 'Failed to toggle acuity', err)
      toast.error(`Could not update ${wordNow('priority')} — please try again`)
    }
  },

  setRowAcuityLevel: async (rowId: number, levelId: number | null) => {
    const prevRow = get().rows.find(r => r.row_id === rowId)
    const prevLevelId = prevRow?.acuity_level_id ?? null
    // Optimistic update
    set(s => ({
      rows: s.rows.map(r => r.row_id === rowId ? { ...r, acuity_level_id: levelId } : r)
    }))
    try {
      await invoke(IPC.ACUITY_SET_ROW_LEVEL, rowId, levelId)
      if (prevLevelId !== levelId) {
        useUndoStore.getState().push({
          id: crypto.randomUUID(),
          description: `Changed ${wordNow('priority')}`,
          timestamp: Date.now(),
          category: 'silent',
          icon: 'gauge',
          undo: async () => { await get().setRowAcuityLevel(rowId, prevLevelId) },
          redo: async () => { await get().setRowAcuityLevel(rowId, levelId) },
        })
      }
    } catch (err) {
      // Rollback
      set(s => ({
        rows: s.rows.map(r => r.row_id === rowId ? { ...r, acuity_level_id: prevLevelId } : r)
      }))
      rlog.error('GridAcuitySlice', 'Failed to set acuity level', err)
      rethrowIfUndoing(err)
      toast.error(`Could not update ${wordNow('priority')} — please try again`)
    }
  },

  createAcuityLevel: async (data: { name: string; abbreviation: string; points: number; color: string }) => {
    const gridId = get().activeGridId
    if (!gridId) return null
    try {
      const level = await invoke<AcuityLevel>(IPC.ACUITY_CREATE_LEVEL, gridId, data)
      set(s => ({ acuityLevels: [...s.acuityLevels, level] }))
      return level
    } catch (err) {
      rlog.error('GridAcuitySlice', 'Failed to create acuity level', err)
      toast.error(`Could not create ${wordNow('priority')} — please try again`)
      return null
    }
  },

  updateAcuityLevel: async (levelId: number, updates: Partial<{ name: string; abbreviation: string; points: number; color: string }>) => {
    // Optimistic update
    set(s => ({
      acuityLevels: s.acuityLevels.map(l => l.id === levelId ? { ...l, ...updates } : l)
    }))
    try {
      await invoke(IPC.ACUITY_UPDATE_LEVEL, levelId, updates)
    } catch (err) {
      rlog.error('GridAcuitySlice', 'Failed to update acuity level', err)
      toast.error(`Could not update ${wordNow('priority')} — please try again`)
      await get().reloadAcuityLevels()
    }
  },

  deleteAcuityLevel: async (levelId: number) => {
    const prev = get().acuityLevels
    set(s => ({ acuityLevels: s.acuityLevels.filter(l => l.id !== levelId) }))
    try {
      await invoke(IPC.ACUITY_DELETE_LEVEL, levelId)
      // Clear assignments locally for rows that had this level
      set(s => ({
        rows: s.rows.map(r => r.acuity_level_id === levelId ? { ...r, acuity_level_id: null } : r)
      }))
    } catch (err) {
      set({ acuityLevels: prev })
      rlog.error('GridAcuitySlice', 'Failed to delete acuity level', err)
      toast.error(`Could not delete ${wordNow('priority')} — please try again`)
    }
  },

  reorderAcuityLevels: async (orderedIds: number[]) => {
    const gridId = get().activeGridId
    if (!gridId) return
    const prev = get().acuityLevels
    set(s => {
      const map = new Map(s.acuityLevels.map(l => [l.id, l]))
      return { acuityLevels: orderedIds.map((id, i) => ({ ...map.get(id)!, position: i })).filter(Boolean) }
    })
    try {
      await invoke(IPC.ACUITY_REORDER_LEVELS, gridId, orderedIds)
    } catch (err) {
      set({ acuityLevels: prev })
      rlog.error('GridAcuitySlice', 'Failed to reorder acuity levels', err)
      toast.error(`Could not reorder ${wordNow('priority', { many: true })} — please try again`)
    }
  },

  reloadAcuityLevels: async () => {
    const gridId = get().activeGridId
    if (!gridId) return
    try {
      const levels = await invoke<AcuityLevel[]>(IPC.ACUITY_GET_LEVELS, gridId)
      set({ acuityLevels: levels })
    } catch (err) {
      rlog.error('GridAcuitySlice', 'Failed to reload acuity levels', err)
    }
  },

  bulkSetRowAcuityLevel: async (rowIds: number[], levelId: number | null) => {
    // Save previous levels for undo
    const prevLevels = new Map<number, number | null>()
    for (const id of rowIds) {
      const row = get().rows.find(r => r.row_id === id)
      prevLevels.set(id, row?.acuity_level_id ?? null)
    }

    // Optimistic update all rows
    set(s => ({
      rows: s.rows.map(r => rowIds.includes(r.row_id) ? { ...r, acuity_level_id: levelId } : r)
    }))

    try {
      await invoke(IPC.ACUITY_BULK_SET_LEVEL, rowIds, levelId)

      useUndoStore.getState().pushWithToast({
        id: crypto.randomUUID(),
        description: `Set ${wordNow('priority')} for ${rowIds.length} ${wordNow('record', { count: rowIds.length })}`,
        timestamp: Date.now(),
        category: 'logged',
        icon: 'gauge',
        undo: async () => {
          for (const [rid, prevId] of prevLevels) {
            await get().setRowAcuityLevel(rid, prevId)
          }
        },
        redo: async () => {
          await get().bulkSetRowAcuityLevel(rowIds, levelId)
        },
      })
    } catch (err) {
      // Rollback
      set(s => ({
        rows: s.rows.map(r => {
          if (prevLevels.has(r.row_id)) {
            return { ...r, acuity_level_id: prevLevels.get(r.row_id) ?? null }
          }
          return r
        })
      }))
      rlog.error('GridAcuitySlice', 'Bulk acuity set failed', err)
      rethrowIfUndoing(err)
      toast.error(`Could not update ${wordNow('priority')} — please try again`)
    }
  },
})
