import toast from 'react-hot-toast'
import { IPC } from '../../shared/ipc-channels'
import { MS_PER_DAY } from '../../shared/constants'
import { useSettingsStore } from '../stores/settingsStore'
import { safeInvoke } from '../utils/safeInvoke'

/**
 * Checks backup recency after unlock and shows a toast reminder
 * if backups are older than the configured threshold.
 * Also hydrates settings from main process.
 * Call this once after the app transitions from locked to unlocked.
 */
export async function checkBackupReminder(): Promise<void> {
  try {
    const settings = await safeInvoke(IPC.SETTINGS_GET_ALL)
    if (settings.ok) {
      useSettingsStore.getState().hydrateFromSettings(settings.data)
    }
    if (settings.ok && settings.data.backup_reminder_enabled === 'true') {
      const days = Number(settings.data.backup_reminder_days) || 7
      const backupList = await safeInvoke(IPC.BACKUP_AUTO_LIST)
      if (backupList.ok) {
        const latest = backupList.data.length > 0
          ? new Date(backupList.data[0]!.timestamp).getTime()
          : 0
        const daysSince = latest > 0
          ? Math.floor((Date.now() - latest) / MS_PER_DAY)
          : Infinity
        if (daysSince >= days) {
          const msg = daysSince === Infinity
            ? 'No backups found \u2014 consider backing up your data.'
            : `No backup in ${daysSince} day${daysSince !== 1 ? 's' : ''} \u2014 consider backing up.`
          toast(msg, { icon: '\u26A0\uFE0F', duration: 8000 })
        }
      }
    }
  } catch { /* non-critical */ }
}
