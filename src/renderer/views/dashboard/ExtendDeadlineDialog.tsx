import React, { useEffect, useRef, useState } from 'react'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { formatDue, ymdToDate, dateToYmd } from '../../../shared/deadlineEngine'

function addDays(ymd: string, n: number): string {
  const d = ymdToDate(ymd)
  d.setDate(d.getDate() + n)
  return dateToYmd(d)
}

/** "Extend…": a new due date and the reason, which goes on the timeline and the audit trail (W05 §4). */
export function ExtendDeadlineDialog({ title, currentDue, onSave, onClose }: {
  title: string
  currentDue: string | null
  onSave: (newDue: string, reason: string) => void
  onClose: () => void
}): React.ReactElement {
  const trapRef = useRef<HTMLDivElement>(null)
  useFocusTrap(trapRef, true)
  const [date, setDate] = useState('')
  const [reason, setReason] = useState('')
  // An extension moves the date later; an earlier one isn't an extension (D-36)
  const minDate = currentDue ? addDays(currentDue, 1) : undefined
  const tooEarly = !!minDate && /^\d{4}-\d{2}-\d{2}$/.test(date) && date < minDate
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && reason.trim().length > 0 && !tooEarly

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div ref={trapRef} role="dialog" aria-modal="true" aria-labelledby="extend-title" onClick={e => e.stopPropagation()}
        className="w-full max-w-md rounded-xl bg-white dark:bg-slate-800 shadow-xl border border-slate-200 dark:border-slate-700 p-6 space-y-4">
        <h2 id="extend-title" className="text-lg font-semibold text-slate-900 dark:text-slate-100">Extend: {title}</h2>
        {currentDue && <p className="text-base text-slate-600 dark:text-slate-300">Due now: {formatDue(currentDue)}</p>}
        <label className="block text-base text-slate-700 dark:text-slate-200">
          New due date
          <input type="date" className="input w-full mt-1" autoFocus value={date} min={minDate} onChange={e => setDate(e.target.value)}
            aria-invalid={tooEarly || undefined} aria-describedby={tooEarly ? 'extend-too-early' : undefined} />
        </label>
        {tooEarly && <p id="extend-too-early" role="alert" className="text-base text-red-700 dark:text-red-300">Choose a date after {formatDue(currentDue!)}.</p>}
        <label className="block text-base text-slate-700 dark:text-slate-200">
          Reason <span className="text-slate-500 dark:text-slate-400">(shows in the timeline and audit trail)</span>
          <textarea className="input w-full mt-1" rows={3} maxLength={500} value={reason} onChange={e => setReason(e.target.value)}
            placeholder="e.g. Waiting on the doctor's report" />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={!valid} onClick={() => onSave(date, reason.trim())}>Extend</button>
        </div>
      </div>
    </div>
  )
}
