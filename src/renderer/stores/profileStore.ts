import { create } from 'zustand'

export interface RecentProfile {
  rowId: number
  gridId: number
  name: string
  gridName: string
  visitedAt: string
}

interface ProfileState {
  recentProfiles: RecentProfile[]
  savedScrollTop: number

  addRecentProfile: (profile: RecentProfile) => void
  saveScrollTop: (pos: number) => void
  clearRecentProfiles: () => void
}

export const useProfileStore = create<ProfileState>((set) => ({
  recentProfiles: [],
  savedScrollTop: 0,

  addRecentProfile: (profile) =>
    set((state) => {
      // Deduplicate by rowId, prepend, trim to 10
      const filtered = state.recentProfiles.filter((p) => p.rowId !== profile.rowId)
      return { recentProfiles: [profile, ...filtered].slice(0, 10) }
    }),

  saveScrollTop: (pos) => set({ savedScrollTop: pos }),

  clearRecentProfiles: () => set({ recentProfiles: [] }),
}))
