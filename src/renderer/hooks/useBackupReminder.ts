import toast from 'react-hot-toast'
import { IPC } from '../../shared/ipc-channels'
import { MS_PER_DAY } from '../../shared/constants'
import { useSettingsStore } from '../stores/settingsStore'
import { safeInvoke } from '../utils/safeInvoke'
import { localDateString } from '../../shared/dates'
import { pulseEvents } from '../events'


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
  toast('Save a recovery key (1 minute): without it, a forgotten password means losing your data. Settings → Security → Recovery key.', { icon: '🔑', duration: 10000 })
  await safeInvoke(IPC.SETTINGS_UPDATE, 'onboarding_recovery_snooze_until', snoozeUntil())
}
