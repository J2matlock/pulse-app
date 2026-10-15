/**
 * "You have an unsent visit note for Odette Guidry · Open", once after each
 * unlock (at launch too) when a draft is waiting in the database (R2). Several:
 * "…for 2 clients · Show", which lists them. Mounted once in App.tsx, inside
 * the unlocked app, so it mounts again after every unlock.
 */
import React, { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Pencil } from 'lucide-react'
import { IPC } from '../../../shared/ipc-channels'
import type { NoteDraftSummary } from '../../../shared/noteDraft'
import { safeInvoke } from '../../utils/safeInvoke'
import { useVocab, useVocabByList } from '../../hooks/useVocab'
import { pulseEvents } from '../../events'
import { Dialog } from '../ui/Dialog'
import { PrimaryButton, SecondaryButton } from '../ui/Button'

export const UNSENT_TOAST_ID = 'unsent-notes'
const SHOW_FOR_MS = 30_000

/** The record's page; its note box opens with the draft in it */
export function openDraftRecord(d: Pick<NoteDraftSummary, 'rowId' | 'gridId'>): void {
  window.location.hash = `#/profile/${d.rowId}?gridId=${d.gridId}`
}

function NoticeText({ drafts }: { drafts: NoteDraftSummary[] }): React.ReactElement {
  const tFor = useVocabByList()
  const { t } = useVocab(null)
  const one = drafts.length === 1 ? drafts[0]! : null
  return (
    <span data-testid="unsent-notes-text">
      {one
        ? `You have an unsent ${tFor(one.gridId)('activity')} for ${one.name}`
        : `You have unsent ${t('activity', { many: true })} for ${drafts.length} ${t('record', { many: true })}`}
    </span>
  )
}

function UnsentToast({ id, drafts, onShow }: { id: string; drafts: NoteDraftSummary[]; onShow: () => void }): React.ReactElement {
  const one = drafts.length === 1 ? drafts[0]! : null
  return (
    <div className="flex flex-col gap-3 text-base">
      <NoticeText drafts={drafts} />
      <div className="flex justify-end gap-2">
        <SecondaryButton onClick={() => toast.dismiss(id)}>Later</SecondaryButton>
        <PrimaryButton onClick={() => { toast.dismiss(id); if (one) openDraftRecord(one); else onShow() }}>
          {one ? 'Open' : 'Show'}
        </PrimaryButton>
      </div>
    </div>
  )
}

function savedWhen(savedAt: string): string {
  // Main writes it as ISO 8601 with a Z, so the Date reads it as UTC
  const d = new Date(savedAt)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function DraftList({ drafts, onClose }: { drafts: NoteDraftSummary[]; onClose: () => void }): React.ReactElement {
  const { t } = useVocab(null)
  return (
    <Dialog open onClose={onClose} title={`Unsent ${t('activity', { many: true })}`}
      description={`Each one is kept until you save it. Open the ${t('record')} to finish it.`}
      footer={<SecondaryButton onClick={onClose}>Close</SecondaryButton>}>
      <ul className="divide-y divide-slate-200 dark:divide-slate-700" data-testid="unsent-notes-list">
        {drafts.map(d => (
          <li key={d.rowId}>
            <button type="button" onClick={() => { onClose(); openDraftRecord(d) }}
              className="w-full flex items-center gap-3 px-2 py-3 text-left text-base rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/50 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
              <Pencil className="w-4 h-4 text-slate-500 dark:text-slate-400 flex-shrink-0" aria-hidden="true" />
              <span className="flex-1 font-medium text-slate-900 dark:text-slate-100">{d.name}</span>
              <span className="text-slate-500 dark:text-slate-400">{savedWhen(d.savedAt)}</span>
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  )
}

export function UnsentNotesNotice(): React.ReactElement | null {
  const [listed, setListed] = useState<NoteDraftSummary[] | null>(null)
  useEffect(() => {
    let live = true
    void safeInvoke(IPC.NOTE_DRAFT_LIST).then(res => {
      if (!live || !res.ok || !Array.isArray(res.data) || res.data.length === 0) return
      const drafts = res.data
      toast(tt => <UnsentToast id={tt.id} drafts={drafts} onShow={() => setListed(drafts)} />, { id: UNSENT_TOAST_ID, duration: SHOW_FOR_MS })
    })
    // Never left on the lock screen
    const off = pulseEvents.on('app:locked', () => toast.dismiss(UNSENT_TOAST_ID))
    return () => { live = false; off() }
  }, [])
  return listed ? <DraftList drafts={listed} onClose={() => setListed(null)} /> : null
}
