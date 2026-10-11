import type { CustomGroupDef } from '../../shared/types'
import { IPC } from '../../shared/ipc-channels'
import type { GridState } from './gridTypes'
import { storeInvoke as invoke } from '../utils/safeInvoke'

export interface CustomGroupSliceState {
  customGroups: CustomGroupDef[]
  activeCustomGroupId: string | null
  saveCustomGroup: (gridId: number, def: CustomGroupDef) => Promise<void>
  deleteCustomGroup: (gridId: number, defId: string) => Promise<void>
  setActiveCustomGroupId: (id: string | null) => void
}

type Set = (partial: Partial<GridState> | ((s: GridState) => Partial<GridState>)) => void
type Get = () => GridState

export const createCustomGroupSlice = (set: Set, get: Get) => ({
  // ── Custom Group Definitions ────────────────────────────────────────
  customGroups: [] as CustomGroupDef[],
  activeCustomGroupId: null as string | null,

  saveCustomGroup: async (gridId: number, def: CustomGroupDef) => {
    const prevGroups = get().customGroups
    const existing = prevGroups.findIndex(g => g.id === def.id)
    const updated = existing >= 0
      ? prevGroups.map(g => g.id === def.id ? def : g)
      : [...prevGroups, def]
    set({ customGroups: updated })
    try {
      await invoke(IPC.SETTINGS_UPDATE, `custom_groups_${gridId}`, JSON.stringify(updated))
    } catch {
      set({ customGroups: prevGroups })
    }
  },

  deleteCustomGroup: async (gridId: number, defId: string) => {
    const prevGroups = get().customGroups
    const prevActiveId = get().activeCustomGroupId
    const updated = prevGroups.filter(g => g.id !== defId)
    set({
      customGroups: updated,
      activeCustomGroupId: prevActiveId === defId ? null : prevActiveId,
    })
    try {
      await invoke(IPC.SETTINGS_UPDATE, `custom_groups_${gridId}`, JSON.stringify(updated))
    } catch {
      set({ customGroups: prevGroups, activeCustomGroupId: prevActiveId })
    }
  },

  setActiveCustomGroupId: (id: string | null) => {
    set({ activeCustomGroupId: id })
  },
})
