/** Why a restore failed, in words for people (not the zip library's or SQLite's). */
import { humanizeError } from './ipc/ipc-utils'

const DAMAGED_BACKUP = "This file is damaged or isn't a Pulse backup. Try a different backup file."

/**
 * Plain-language reason a restore failed, instead of the zip library's or
 * SQLite's wording. Messages already written for people pass through.
 */
export function describeRestoreError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  const code = (err as { code?: string } | null)?.code ?? ''
  if (raw === 'Incorrect password or recovery key') return "That password or recovery key doesn't match this backup. Use the password you had when the backup was made."
  if (code === 'SQLITE_NOTADB' || code === 'SQLITE_CORRUPT' || code === 'Z_DATA_ERROR' || code === 'Z_BUF_ERROR'
    || /hash mismatch|central directory|signature|not a database|file is encrypted|malformed|invalid (zip|relative|comment|code|distance|block|stored)|unexpected (end|EOF)|No database file found|doesn't contain a Pulse database|key information is damaged|Extraction failed/i.test(raw)) {
    return DAMAGED_BACKUP
  }
  if (raw === 'Backup file not found' || code === 'ENOENT') return "We couldn't find that backup file. If it's on a USB drive or network folder, check that it's connected."
  if (code === 'WAL_BUSY') return "Pulse was still saving your latest changes, so it didn't restore anything. Wait a moment and try again."
  if (code === 'ENOSPC') return "There isn't enough free space on this computer to restore that backup. Free up some space and try again."
  if (code === 'EACCES' || code === 'EPERM') return "Pulse isn't allowed to open that file. Copy it to your Documents folder and try again."
  return humanizeError(err)
}
