import toast from 'react-hot-toast'
import { IPC } from '../../shared/ipc-channels'
import { MS_PER_DAY } from '../../shared/constants'
import { parseDbTimestamp } from '../../shared/dates'
import { useSettingsStore } from '../stores/settingsStore'
import { useBackupStatusStore } from '../stores/backupStatusStore'
import { safeInvoke } from '../utils/safeInvoke'
import { localDateString } from '../../shared/dates'
import { pulseEvents } from '../events'
import { showRecoveryKeyReminder } from '../components/shared/RecoveryKeyReminderToast'


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
    if (status.offsiteOverdue) {
      if (status.lastOffsiteISO) {
        const days = Math.floor((Date.now() - parseDbTimestamp(status.lastOffsiteISO).getTime()) / MS_PER_DAY)
        toast(`Your last backup to a USB drive or another folder was ${days} day${days !== 1 ? 's' : ''} ago. Use Settings → Backup → "Back up now".`, { icon: '⚠️', duration: 8000 })
      } else {
        toast('You haven\'t saved a backup to a USB drive or another folder yet. Use Settings → Backup → "Back up now".', { icon: '⚠️', duration: 8000 })
      }
      // One reminder at a time: the recovery key's turn comes at the next unlock
      return
    }
    // Not tied to backups: people who keep backups current still need a recovery key
    await checkRecoveryKeyReminder(settings.ok ? settings.data.onboarding_recovery_snooze_until ?? null : null)
  } catch { /* non-critical */ }
}

/** A put-off recovery-key reminder comes back after a week */
export const RECOVERY_SNOOZE_DAYS = 7

/** A week from today, as a calendar date */
export function snoozeUntil(from = new Date()): string {
  const d = new Date(from)
  d.setDate(d.getDate() + RECOVERY_SNOOZE_DAYS)
  return localDateString(d)
}

/**
 * What's New, once, on the first unlock after the version changes (audit N-20).
 * A brand-new install just remembers its version: there's nothing "new" yet.
 */
export async function checkWhatsNew(): Promise<void> {
  const [info, seen] = await Promise.all([safeInvoke(IPC.APP_GET_INFO), safeInvoke(IPC.SETTINGS_GET, 'onboarding_last_seen_version')])
  if (!info.ok || !seen.ok) return
  const version = info.data.version
  if (seen.data === version) return
  await safeInvoke(IPC.SETTINGS_UPDATE, 'onboarding_last_seen_version', version)
  if (seen.data !== null) pulseEvents.emit('whats-new:open')
}

/**
 * A recovery key skipped at setup is offered again (audit F-32): once, then
 * not for another week, and never once the key exists.
 */
export async function checkRecoveryKeyReminder(snoozedUntil: string | null): Promise<void> {
  if (snoozedUntil && snoozedUntil > localDateString()) return
  const key = await safeInvoke(IPC.AUTH_HAS_RECOVERY_KEY)
  if (!key.ok || key.data) return
  showRecoveryKeyReminder()
  await safeInvoke(IPC.SETTINGS_UPDATE, 'onboarding_recovery_snooze_until', snoozeUntil())
}
