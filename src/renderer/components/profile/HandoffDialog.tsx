import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Send, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useGridStore } from '../../stores/gridStore'
import { useVocab } from '../../hooks/useVocab'
import { useHoldsPeople } from '../../hooks/useRecordKind'
import { useFeature } from '../../hooks/useFeature'
import { CancelAppointmentsCheckbox, useUpcomingAppointments } from '../grid/GridDialogs'

/**
 * Client handoff packet (transfer or discharge): cover page, full profile and
 * audit trail in one PDF, optionally archiving the client afterwards.
 */
export function HandoffDialog({ rowId, gridId, clientName, onClose }: {
  rowId: number
  gridId: number
  clientName: string
  onClose: () => void
}): React.ReactElement {
  const { t } = useVocab(gridId)
  const trapRef = useRef<HTMLDivElement>(null)
  useFocusTrap(trapRef, true)
  const navigate = useNavigate()
  const [receiving, setReceiving] = useState('')
  const [summary, setSummary] = useState('')
  const [archive, setArchive] = useState(false)
  const upcoming = useUpcomingAppointments(archive ? [rowId] : null)
  const [cancelAppts, setCancelAppts] = useState(true)
  const filesOn = useFeature('attachments')
  const [includePictures, setIncludePictures] = useState(false)
  // Scrap notes are private jottings; the packet goes to someone else
  const [includeScratchPad, setIncludeScratchPad] = useState(false)
  // "Discharged" is for people; a thing or job is closed
  const holdsPeople = useHoldsPeople(gridId)
  const reasons = holdsPeople ? ['Transferred', 'Discharged'] as const : ['Transferred', 'Closed'] as const
  // A thing or job gets a "Vehicle packet", not a handoff packet (W10 §2)
  const packet = holdsPeople ? 'handoff packet' : `${t('record')} packet`
  const Packet = holdsPeople ? 'Handoff packet' : `${t('record', { cap: true })} packet`
  const [reason, setReason] = useState<string>('Transferred')
  const [working, setWorking] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function save() {
    setWorking(true)
    try {
      const res = await safeInvoke<string | null>(IPC.EXPORT_HANDOFF_PACKET, { rowId, gridId, receiving, summary, includePictures: filesOn && includePictures, includeScratchPad })
      if (!res.ok) { toast.error(`We couldn't create the ${packet}. Try again.`); return }
      if (!res.data) return
      toast.success(`Saved the ${packet}`)
      onClose()
      if (archive) {
        await useGridStore.getState().archiveRow(rowId, reason, { cancelAppointments: upcoming > 0 && cancelAppts })
        navigate('/grid')
      }
    } finally {
      setWorking(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center-safe justify-center bg-black/50 p-4 overflow-y-auto" onClick={onClose}>
      <div ref={trapRef} role="dialog" aria-modal="true" aria-labelledby="handoff-title" onClick={e => e.stopPropagation()}
        className="w-full max-w-xl rounded-xl bg-white dark:bg-slate-800 shadow-xl border border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <Send className="w-6 h-6 text-blue-600 dark:text-blue-400" aria-hidden="true" />
          <h2 id="handoff-title" className="text-xl font-semibold text-slate-900 dark:text-slate-100 flex-1 min-w-0 truncate">{Packet}: {clientName}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="hit-44 p-2 rounded-sm text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <p className="text-base text-slate-700 dark:text-slate-200">
            For a transfer or hand-off: one PDF with a cover page, the full {t('record')} profile, and the complete audit trail.
          </p>
          <div>
            <label htmlFor="handoff-to" className="block text-base font-medium text-slate-800 dark:text-slate-100 mb-1">
              Who is taking over? <span className="font-normal text-slate-500 dark:text-slate-400">(optional)</span>
            </label>
            <input id="handoff-to" className="input w-full" value={receiving} onChange={e => setReceiving(e.target.value)} placeholder="e.g. Sam Lee, Eastside office" maxLength={500} />
          </div>
          <div>
            <label htmlFor="handoff-notes" className="block text-base font-medium text-slate-800 dark:text-slate-100 mb-1">
              Notes for the next {t('worker')} <span className="font-normal text-slate-500 dark:text-slate-400">(optional)</span>
            </label>
            <textarea id="handoff-notes" className="input w-full" rows={5} value={summary} onChange={e => setSummary(e.target.value)}
              placeholder="Current situation, what's pending, who to call…" maxLength={20000} />
          </div>
          <label className="flex items-center gap-2 min-h-[44px] text-base text-slate-700 dark:text-slate-200 cursor-pointer">
            <input type="checkbox" className="w-5 h-5" checked={includeScratchPad} onChange={e => setIncludeScratchPad(e.target.checked)} />
            Include scratch notes
          </label>
          {filesOn && (
            <label className="flex items-center gap-2 min-h-[44px] text-base text-slate-700 dark:text-slate-200 cursor-pointer">
              <input type="checkbox" className="w-5 h-5" checked={includePictures} onChange={e => setIncludePictures(e.target.checked)} />
              Add photos from Files as extra pages
            </label>
          )}
          <div className="space-y-1">
            <label className="flex items-center gap-2 min-h-[44px] text-base text-slate-700 dark:text-slate-200 cursor-pointer">
              <input type="checkbox" className="w-5 h-5" checked={archive} onChange={e => setArchive(e.target.checked)} />
              Archive this {t('record')} after saving
            </label>
            {archive && (
              <div className="flex gap-4 pl-7">
                {reasons.map(r => (
                  <label key={r} className="flex items-center gap-2 min-h-[44px] text-base text-slate-700 dark:text-slate-200 cursor-pointer">
                    <input type="radio" name="handoff-reason" className="w-5 h-5" checked={reason === r} onChange={() => setReason(r)} />
                    {r}
                  </label>
                ))}
              </div>
            )}
            {archive && <div className="pl-7"><CancelAppointmentsCheckbox count={upcoming} checked={cancelAppts} onChange={setCancelAppts} /></div>}
          </div>
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-200 dark:border-slate-700">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={working} onClick={() => void save()}>{working ? 'Creating…' : 'Save PDF…'}</button>
        </div>
      </div>
    </div>
  )
}
