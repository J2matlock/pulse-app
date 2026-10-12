import { create } from 'zustand'
import { IPC } from '../../shared/ipc-channels'
import type { RowLocation } from '../../shared/ipc-contract'
import { safeInvoke } from '../utils/safeInvoke'
import { pulseEvents } from '../events'
import { useGridStore } from './gridStore'

export interface RecentProfile {
  rowId: number
  gridId: number
  name: string
  gridName: string
  visitedAt: string
}

interface ProfileState {
  recentProfiles: RecentProfile[]
  /** Where the list was scrolled when a record was opened from it; used once, by that list only (AUDIT-129) */
  savedScroll: { gridId: number; top: number } | null

  addRecentProfile: (profile: RecentProfile) => void
  /** A record that's gone (Trash, deleted list) leaves Recent */
  removeRecentProfile: (rowId: number) => void
  /**
   * Check every recent record: drop the ones that are gone, and follow the
   * ones that moved to another list, so Recent doesn't lead to "This record
   * is in the Trash" or to the old list.
   */
  pruneRecentProfiles: () => Promise<void>
  saveScrollTop: (gridId: number, pos: number) => void
  clearSavedScroll: () => void
  clearRecentProfiles: () => void
}

export const useProfileStore = create<ProfileState>((set, get) => ({
  recentProfiles: [],
  savedScroll: null,

  addRecentProfile: (profile) =>
    set((state) => {
      // Deduplicate by rowId, prepend, trim to 10
      const filtered = state.recentProfiles.filter((p) => p.rowId !== profile.rowId)
      return { recentProfiles: [profile, ...filtered].slice(0, 10) }
    }),

  removeRecentProfile: (rowId) =>
    set((state) => {
      const next = state.recentProfiles.filter((p) => p.rowId !== rowId)
      return next.length === state.recentProfiles.length ? state : { recentProfiles: next }
    }),

  pruneRecentProfiles: async () => {
    const checked = get().recentProfiles
    if (checked.length === 0) return
    const found = new Map<number, RowLocation | null>()
    await Promise.all(checked.map(async (p) => {
      const res = await safeInvoke<RowLocation | null>(IPC.ROW_LOCATE, p.rowId)
      // Can't tell (database busy, locked): keep it
      if (res.ok) found.set(p.rowId, res.data)
    }))
    const grids = useGridStore.getState().grids
    set((state) => ({
      recentProfiles: state.recentProfiles.flatMap((p) => {
        if (!found.has(p.rowId)) return [p]
        const loc = found.get(p.rowId)
        if (!loc || loc.status === 'trash' || loc.status === 'list-deleted') return []
        if (loc.gridId === p.gridId) return [p]
        return [{ ...p, gridId: loc.gridId, gridName: grids.find((g) => g.id === loc.gridId)?.name ?? p.gridName }]
      }),
    }))
  },

  saveScrollTop: (gridId, pos) => set({ savedScroll: { gridId, top: pos } }),
  clearSavedScroll: () => set({ savedScroll: null }),

  clearRecentProfiles: () => set({ recentProfiles: [] }),
}))

// Removing the sample data deletes records that may be in Recent
pulseEvents.on('sample-data:changed', () => { void useProfileStore.getState().pruneRecentProfiles() })
// A record in the Trash leaves Recent straight away (Q-048)
pulseEvents.on('records:trashed', ({ rowIds }) => {
  const store = useProfileStore.getState()
  if (rowIds) for (const id of rowIds) store.removeRecentProfile(id)
  else void store.pruneRecentProfiles()
})
