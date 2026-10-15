/**
 * The reason for archiving, asked after the fact (Q4): archiving happens at
 * once and the Undo toast offers "Add a reason…", which opens this. Mounted
 * once, beside the Undo toast; opened through archiveReasonStore.
 */
import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import toast from 'react-hot-toast'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'
import { friendlyError } from '../../utils/friendlyError'
import { useArchiveReasonStore, closeArchiveReason } from '../../stores/archiveReasonStore'
import { Dialog } from '../ui/Dialog'
import { PrimaryButton, SecondaryButton } from '../ui/Button'
import { useVocab } from '../../hooks/useVocab'

export const ARCHIVE_REASON_MAX = 1000

export function ArchiveReasonDialog(): React.ReactElement | null {
  const { t } = useVocab(null)
  const request = useArchiveReasonStore(s => s.request)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setReason(request?.step.reason ?? ''); setError(''); setBusy(false) }, [request])

  if (!request) return null

  async function save() {
    if (!request) return
    const text = reason.trim()
    if (!text) { setError('Type a reason, or choose Cancel.'); return }
    setBusy(true)
    const res = await safeInvoke(IPC.ROW_ARCHIVE_REASON, request.rowIds, text)
    setBusy(false)
    if (!res.ok) { setError(friendlyError(res.error)); return }
    request.step.reason = text
    request.step.noteIds.push(...res.data.noteIds)
    closeArchiveReason()
    toast.success('Reason saved')
  }

  return createPortal(
    <Dialog
      open
      onClose={closeArchiveReason}
      title={`Reason for archiving ${request.label}`}
      size="md"
      initialFocus={inputRef}
      footer={<>
        <SecondaryButton onClick={closeArchiveReason}>Cancel</SecondaryButton>
        <PrimaryButton busy={busy} onClick={() => void save()}>Save reason</PrimaryButton>
      </>}
    >
      <label htmlFor="archive-reason-after" className="block text-base font-medium text-slate-700 dark:text-slate-200 mb-1">Reason</label>
      <input
        id="archive-reason-after"
        ref={inputRef}
        className="input w-full"
        style={{ minHeight: 44 }}
        value={reason}
        maxLength={ARCHIVE_REASON_MAX}
        onChange={e => { setReason(e.target.value); setError('') }}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void save() } }}
        placeholder="e.g. Discharged, Moved away, Job finished"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'archive-reason-error' : 'archive-reason-hint'}
      />
      {error
        ? <p id="archive-reason-error" role="alert" className="mt-2 text-base text-red-700 dark:text-red-400">{error}</p>
        : <p id="archive-reason-hint" className="mt-2 text-base text-slate-600 dark:text-slate-300">It's saved with the archive and added as {t('activity', { article: true })}.</p>}
    </Dialog>,
    document.body,
  )
}
