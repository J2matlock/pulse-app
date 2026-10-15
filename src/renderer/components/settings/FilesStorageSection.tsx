/** Settings → Data → Files (W09 §7): how much room files use, the limit, and emptying the files trash. */
import React, { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Paperclip } from 'lucide-react'
import { IPC } from '../../../shared/ipc-channels'
import { LIMIT_MB_RANGE, DEFAULT_LIMIT_MB, formatBytes } from '../../../shared/attachments'
import { safeInvoke } from '../../utils/safeInvoke'
import { friendlyError } from '../../utils/friendlyError'
import { useUndoStore } from '../../stores/undoStore'
import { MoreSettings } from './MoreSettings'

export function FilesStorageSection(): React.ReactElement {
  const [usage, setUsage] = useState<{ count: number; bytes: number; limitBytes: number } | null>(null)
  const [limit, setLimit] = useState('')
  const load = useCallback(async () => {
    const r = await safeInvoke<{ count: number; bytes: number; limitBytes: number }>(IPC.ATTACHMENT_USAGE)
    if (r.ok) { setUsage(r.data); setLimit(String(Math.round(r.data.limitBytes / (1024 * 1024)))) }
  }, [])
  useEffect(() => { void load() }, [load])

  async function saveLimit() {
    const mb = Math.round(Number(limit))
    if (!Number.isFinite(mb) || mb < LIMIT_MB_RANGE.min || mb > LIMIT_MB_RANGE.max) { toast.error(`Choose between ${LIMIT_MB_RANGE.min} and ${LIMIT_MB_RANGE.max} MB.`); return }
    const r = await safeInvoke(IPC.SETTINGS_UPDATE, 'attachments_max_mb', String(mb))
    if (r.ok) { toast.success('Saved'); void load() } else toast.error(friendlyError(r.error))
  }

  async function emptyTrash() {
    const r = await safeInvoke<number>(IPC.ATTACHMENT_PURGE)
    // Undo steps bringing removed files back would fail from now on, and block older steps (Q-045)
    if (r.ok) useUndoStore.getState().clear()
    if (r.ok) { toast.success(r.data ? `Removed ${r.data} file${r.data === 1 ? '' : 's'} from the Trash` : 'No files in the Trash'); void load() } else toast.error(friendlyError(r.error))
  }

  const pct = usage ? Math.min(100, Math.round((usage.bytes / usage.limitBytes) * 100)) : 0
  return (
    <section aria-labelledby="files-storage-heading" className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-700">
      <h3 id="files-storage-heading" className="text-lg font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2"><Paperclip className="w-5 h-5" aria-hidden="true" />Files</h3>
      {usage && (
        <>
          <p className="text-base text-slate-700 dark:text-slate-200">{usage.count} file{usage.count === 1 ? '' : 's'} using {formatBytes(usage.bytes)} of {formatBytes(usage.limitBytes)}, including any in the Trash.</p>
          <div className="h-3 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden" role="progressbar" aria-label="Room used by files" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className={`h-full ${pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-amber-500' : 'bg-blue-500'}`} style={{ width: `${pct}%` }} />
          </div>
        </>
      )}
      {/* The limit and emptying the Trash matter only when room runs short: open by itself then, or when the limit was changed (Q1c) */}
      <MoreSettings changed={usage !== null && (Math.round(usage.limitBytes / (1024 * 1024)) !== DEFAULT_LIMIT_MB || pct > 90)}>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block text-base text-slate-700 dark:text-slate-200">
            Room for files (MB)
            <input type="number" min={LIMIT_MB_RANGE.min} max={LIMIT_MB_RANGE.max} className="input w-32 mt-1 block" value={limit} onChange={e => setLimit(e.target.value)} />
          </label>
          <button type="button" className="btn-secondary" onClick={() => void saveLimit()}>Save</button>
          <button type="button" className="btn-secondary" onClick={() => void emptyTrash()}>Remove files in the Trash now</button>
        </div>
      </MoreSettings>
      <p className="text-sm text-slate-500 dark:text-slate-400">Files are kept inside your Pulse data, locked with your password, so they're part of every backup. Bigger files make backups slower.</p>
    </section>
  )
}
