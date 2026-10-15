import React from 'react'
import toast from 'react-hot-toast'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'
import { friendlyError } from '../../utils/friendlyError'
import { SecondaryButton } from '../ui/Button'

// "Backup saved." left people asking where (persona study #19): say the folder, with a
// way to see the file. The full path is in the tooltip.

const SHOW_FOR_MS = 8000

/** The folder a file is in, by its last name only ("USB" for /run/media/karen/USB/x.pulse-backup) */
export function folderNameOf(filePath: string): string {
  const parts = filePath.split(/[\\/]+/).filter(Boolean)
  parts.pop()
  return parts[parts.length - 1] ?? filePath
}

export function BackupSavedToast({ id, filePath, extra }: { id: string; filePath: string; extra?: string }): React.ReactElement {
  async function show() {
    toast.dismiss(id)
    const res = await safeInvoke(IPC.APP_SHOW_IN_FOLDER, filePath)
    if (!res.ok) toast.error(friendlyError(res.error, "We couldn't open that folder."))
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-base">
      <span title={filePath}>Backup saved to {folderNameOf(filePath)}.{extra ? ` ${extra}` : ''}</span>
      <SecondaryButton onClick={() => void show()}>Show</SecondaryButton>
    </div>
  )
}

/** The success toast after a backup file is saved where the person chose */
export function showBackupSaved(filePath: string, extra?: string): void {
  toast.success(t => <BackupSavedToast id={t.id} filePath={filePath} extra={extra} />, { id: 'backup-saved', duration: SHOW_FOR_MS })
}
