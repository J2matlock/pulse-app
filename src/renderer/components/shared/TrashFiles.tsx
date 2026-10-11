/** Trash → Files (W09 §7): removed files waiting 30 days, with restore and remove-for-good. */
import React, { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Paperclip, RotateCcw, Trash2 } from 'lucide-react'
import { IPC } from '../../../shared/ipc-channels'
import { formatBytes, type Attachment } from '../../../shared/attachments'
import { parseDbTimestamp } from '../../../shared/dates'
import { safeInvoke } from '../../utils/safeInvoke'
import { useVocab } from '../../hooks/useVocab'
import { ConfirmDialog } from './ConfirmDialog'
import { friendlyError } from '../../utils/friendlyError'

type TrashedFile = Attachment & { record_name: string | null }

export function TrashFiles(): React.ReactElement | null {
  const { t } = useVocab(null)
  const [files, setFiles] = useState<TrashedFile[]>([])
  const [purge, setPurge] = useState<TrashedFile | null>(null)
  const load = useCallback(async () => {
    const r = await safeInvoke<TrashedFile[]>(IPC.ATTACHMENT_TRASH_LIST)
    if (r.ok) setFiles(r.data)
  }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => window.api.on(IPC.ATTACHMENTS_CHANGED, () => { void load() }), [load])

  async function restore(f: TrashedFile) {
    const r = await safeInvoke(IPC.ATTACHMENT_RESTORE, f.id)
    if (r.ok) { toast.success(`Restored ${f.file_name}`); void load() } else toast.error(friendlyError(r.error))
  }

  if (files.length === 0) return null
  return (
    <section aria-labelledby="trash-files-heading" className="px-6 py-4 border-t border-slate-200 dark:border-slate-700">
      <h2 id="trash-files-heading" className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2 mb-2"><Paperclip className="w-5 h-5" aria-hidden="true" />Files</h2>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {files.map(f => (
          <li key={f.id} className="flex flex-wrap items-center gap-3 py-2" style={{ minHeight: 44 }}>
            <div className="flex-1 min-w-0">
              <span className="block text-base font-medium text-slate-900 dark:text-white truncate">{f.file_name}</span>
              <span className="block text-sm text-slate-500 dark:text-slate-400">
                {formatBytes(f.size_bytes)} · {t('record', { cap: true })}: {f.record_name ?? '(unnamed)'} · removed {f.deleted_at ? parseDbTimestamp(f.deleted_at).toLocaleDateString() : ''}
              </span>
            </div>
            <button type="button" className="btn-compact-secondary" onClick={() => void restore(f)}><RotateCcw className="w-4 h-4" />Restore</button>
            <button type="button" className="btn-compact-secondary text-red-600 dark:text-red-400" onClick={() => setPurge(f)}><Trash2 className="w-4 h-4" />Delete</button>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={purge !== null}
        title="Delete this file for good?"
        message={`"${purge?.file_name ?? ''}" will be removed from Pulse. This cannot be undone.`}
        confirmLabel="Delete Permanently"
        destructive
        onConfirm={async () => {
          if (purge) {
            const r = await safeInvoke(IPC.ATTACHMENT_PURGE, purge.id)
            if (r.ok) void load(); else toast.error(friendlyError(r.error))
          }
          setPurge(null)
        }}
        onCancel={() => setPurge(null)}
      />
    </section>
  )
}
