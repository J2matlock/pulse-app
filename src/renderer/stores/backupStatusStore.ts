import { create } from 'zustand'
import { storeInvoke } from '../utils/safeInvoke'

interface BackupStatus {
  lastAutoBackup: string | null
  lastAutoBackupSuccess: boolean
  lastAutoBackupError: string | null
  loadedAt: number | null
  loading: boolean
  loadStatus: () => Promise<void>
}

export const useBackupStatusStore = create<BackupStatus>((set) => ({
  lastAutoBackup: null,
  lastAutoBackupSuccess: true,
  lastAutoBackupError: null,
  loadedAt: null,
  loading: false,
  loadStatus: async () => {
    set({ loading: true })
    try {
      const data = await storeInvoke<{ lastAutoBackup: string | null; lastAutoBackupSuccess: boolean; lastAutoBackupError: string | null }>('backup:get-status')
      set({
        lastAutoBackup: data.lastAutoBackup,
        lastAutoBackupSuccess: data.lastAutoBackupSuccess,
        lastAutoBackupError: data.lastAutoBackupError,
        loadedAt: Date.now(),
        loading: false,
      })
    } catch {
      set({ loading: false })
    }
  },
}))
