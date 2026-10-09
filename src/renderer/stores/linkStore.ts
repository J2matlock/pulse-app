import { create } from 'zustand'
import { IPC } from '../../shared/ipc-channels'
import type { LinkType } from '../../shared/links'
import { storeInvoke } from '../utils/safeInvoke'
import { rlog } from '../utils/rendererLogger'

/** Link types between lists (W04), so link columns know which list the other side is. */
interface LinkStore {
  types: LinkType[]
  isLoaded: boolean
  load: () => Promise<void>
}

let loading: Promise<void> | null = null

export const useLinkStore = create<LinkStore>((set) => ({
  types: [],
  isLoaded: false,

  load: async () => {
    if (loading) return loading
    loading = (async () => {
      try {
        const data = await storeInvoke<LinkType[]>(IPC.LINK_TYPE_GET_ALL)
        set({ types: Array.isArray(data) ? data : [], isLoaded: true })
      } catch (err) {
        rlog.warn('LinkStore', 'Could not load link types', err)
      } finally {
        loading = null
      }
    })()
    return loading
  },
}))
