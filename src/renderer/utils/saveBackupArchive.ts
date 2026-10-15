import { IPC } from '../../shared/ipc-channels'
import { safeInvoke } from './safeInvoke'
import { localDateString } from '../../shared/dates'

/** The path a manual backup was written to (main may add .pulse-backup), or the one asked for */
export function savedBackupPath(result: unknown, asked: string): string {
  if (result && typeof result === 'object' && 'destPath' in result && typeof result.destPath === 'string') return result.destPath
  return asked
}

/**
 * Ask where to save a .pulse-backup and save one there. Used by Settings → Backup
 * ("Back up now") and after a re-encrypt (P-001), when older backups no longer
 * match the data's key.
 */
export async function saveBackupArchive(): Promise<{ status: 'saved'; path: string } | { status: 'canceled' } | { status: 'failed'; error: string }> {
  const saveRes = await safeInvoke(IPC.APP_SHOW_SAVE_DIALOG, {
    title: 'Save a backup file',
    defaultPath: `pulse-backup-${localDateString()}.pulse-backup`,
    filters: [{ name: 'Pulse backup', extensions: ['pulse-backup'] }]
  })
  if (!saveRes.ok || saveRes.data.canceled || !saveRes.data.filePath) return { status: 'canceled' }
  const res = await safeInvoke(IPC.BACKUP_MANUAL_CREATE, saveRes.data.filePath)
  return res.ok ? { status: 'saved', path: savedBackupPath(res.data, saveRes.data.filePath) } : { status: 'failed', error: res.error }
}
