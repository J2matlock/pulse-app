import toast from 'react-hot-toast'
import { IPC } from '../../shared/ipc-channels'
import { MS_PER_DAY } from '../../shared/constants'
import { parseDbTimestamp } from '../../shared/dates'
import { useSettingsStore } from '../stores/settingsStore'
import { useBackupStatusStore } from '../stores/backupStatusStore'
import { safeInvoke } from '../utils/safeInvoke'

/**
 * After unlock: hydrate settings, then remind the user if no backup has been
 * saved somewhere other than this computer's Pulse folder for a while.
 * Auto-backups sit on the same disk, so they don't count. Reminders are on
 * unless the user switched them off.
 * Call this once after the app transitions from locked to unlocked.
 */
export async function checkBackupReminder(): Promise<void> {
  try {
    const settings = await safeInvoke(IPC.SETTINGS_GET_ALL)
    if (settings.ok) {
      useSettingsStore.getState().hydrateFromSettings(settings.data)
    }
    const res = await safeInvoke(IPC.BACKUP_GET_STATUS)
    if (!res.ok) return
    const status = res.data
    useBackupStatusStore.setState({ status, loadedAt: Date.now() })
    if (status.scheduled.overdue) {
      toast(`Your scheduled backup isn't working. ${status.scheduled.lastError ?? ''} Open Settings → Backup to fix it.`.replace(/\s+/g, ' '), { icon: '⚠️', duration: 10000 })
      return
    }
    if (!status.offsiteOverdue) return
    if (status.lastOffsiteISO) {
      const days = Math.floor((Date.now() - parseDbTimestamp(status.lastOffsiteISO).getTime()) / MS_PER_DAY)
      toast(`Your last backup to a USB drive or another folder was ${days} day${days !== 1 ? 's' : ''} ago. Use Settings → Backup → "Back up now".`, { icon: '⚠️', duration: 8000 })
    } else {
      toast('You haven\'t saved a backup to a USB drive or another folder yet. Use Settings → Backup → "Back up now".', { icon: '⚠️', duration: 8000 })
    }
  } catch { /* non-critical */ }
}
