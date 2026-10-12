import { IPC } from '../../shared/ipc-channels'
import { safeInvoke } from './safeInvoke'
import { localDateString } from '../../shared/dates'

/**
 * Ask where to save a .pulse-backup and save one there. Used by Settings → Backup
 * ("Back up now") and after a re-encrypt (P-001), when older backups no longer
 * match the data's key.
 */
export async function saveBackupArchive(): Promise<{ status: 'saved' } | { status: 'canceled' } | { status: 'failed'; error: string }> {
  const saveRes = await safeInvoke(IPC.APP_SHOW_SAVE_DIALOG, {
    title: 'Save Backup Archive',
    defaultPath: `pulse-backup-${localDateString()}.pulse-backup`,
    filters: [{ name: 'Pulse Backup', extensions: ['pulse-backup'] }]
  })
  if (!saveRes.ok || saveRes.data.canceled || !saveRes.data.filePath) return { status: 'canceled' }
  const res = await safeInvoke(IPC.BACKUP_MANUAL_CREATE, saveRes.data.filePath)
  return res.ok ? { status: 'saved' } : { status: 'failed', error: res.error }
}
