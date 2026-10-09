import { create } from 'zustand'
import { IPC } from '../../shared/ipc-channels'
import { DEFAULT_ACTIVITY_TYPES, type ActivityType } from '../../shared/activityTypes'
import { storeInvoke } from '../utils/safeInvoke'
import { rlog } from '../utils/rendererLogger'

/**
 * People's note types, archived ones included (old notes still need their
 * labels). Until the list loads, the five built-ins stand in.
 */
interface ActivityTypeStore {
  types: ActivityType[]
  isLoaded: boolean
  load: () => Promise<void>
}

export const useActivityTypeStore = create<ActivityTypeStore>((set) => ({
  types: [...DEFAULT_ACTIVITY_TYPES],
  isLoaded: false,

  load: async () => {
    try {
      const data = await storeInvoke<unknown>(IPC.ACTIVITY_TYPE_GET_ALL, true)
      const types = Array.isArray(data)
        ? data.filter((t): t is ActivityType => typeof t?.key === 'string' && typeof t?.label === 'string' && typeof t?.id === 'number')
        : []
      // An empty or odd answer would leave the composer with nothing to pick
      if (types.some(t => !t.is_archived)) set({ types, isLoaded: true })
    } catch (err) {
      rlog.warn('ActivityTypeStore', 'Could not load note types', err)
    }
  },
}))
