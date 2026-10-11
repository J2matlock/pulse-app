import { create } from 'zustand'
import { storeInvoke } from '../utils/safeInvoke'
import type { BackupStatusResult } from '../../shared/ipc-contract'

interface BackupStatusState {
  status: BackupStatusResult | null
  loadedAt: number | null
  loading: boolean
  loadStatus: () => Promise<void>
}

/** Whether backups are actually happening, for the status bar and reminders. */
export const useBackupStatusStore = create<BackupStatusState>((set) => ({
  status: null,
  loadedAt: null,
  loading: false,
  loadStatus: async () => {
    set({ loading: true })
    try {
      const status = await storeInvoke('backup:get-status')
      set({ status, loadedAt: Date.now(), loading: false })
    } catch {
      set({ loading: false })
    }
  },
}))
