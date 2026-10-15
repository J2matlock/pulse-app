import React, { useState } from 'react'
import { Dialog } from '../../components/ui/Dialog'
import { PrimaryButton, SecondaryButton } from '../../components/ui/Button'
import { formatDue } from '../../../shared/deadlineEngine'
import { addDays } from '../../../shared/ymd'
import { useVocab } from '../../hooks/useVocab'

/** "Extend…": a new due date and the reason, which is kept with the record's history (W05 §4). */
export function ExtendDeadlineDialog({ title, currentDue, gridId = null, onSave, onClose }: {
  title: string
  currentDue: string | null
  /** The record's list, for its own words; the workspace's when left out */
  gridId?: number | null
  onSave: (newDue: string, reason: string) => void
  onClose: () => void
}): React.ReactElement {
  const { t } = useVocab(gridId)
  const [date, setDate] = useState('')
  const [reason, setReason] = useState('')
  // An extension moves the date later; an earlier one isn't an extension (D-36)
  const minDate = currentDue ? addDays(currentDue, 1) : undefined
  const tooEarly = !!minDate && /^\d{4}-\d{2}-\d{2}$/.test(date) && date < minDate
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && reason.trim().length > 0 && !tooEarly

  return (
    <Dialog open onClose={onClose} title={`Extend: ${title}`} size="md"
      footer={<>
        <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
        <PrimaryButton disabled={!valid} onClick={() => onSave(date, reason.trim())}>Extend</PrimaryButton>
      </>}>
      <div className="space-y-4">
        {currentDue && <p className="text-base text-slate-600 dark:text-slate-300">Due now: {formatDue(currentDue)}</p>}
        <label className="block text-base text-slate-700 dark:text-slate-200">
          New due date
          <input type="date" className="input w-full mt-1" autoFocus value={date} min={minDate} onChange={e => setDate(e.target.value)}
            aria-invalid={tooEarly || undefined} aria-describedby={tooEarly ? 'extend-too-early' : undefined} />
        </label>
        {tooEarly && <p id="extend-too-early" role="alert" className="text-base text-red-700 dark:text-red-300">Choose a date after {formatDue(currentDue!)}.</p>}
        <label className="block text-base text-slate-700 dark:text-slate-200">
          Reason <span className="text-slate-500 dark:text-slate-400">(kept with the {t('record')}'s history)</span>
          <textarea className="input w-full mt-1" rows={3} maxLength={500} value={reason} onChange={e => setReason(e.target.value)}
            placeholder="e.g. Waiting on the doctor's report" />
        </label>
        {/* What the row does next: it stops showing as late (UX D-22) */}
        <p className="text-base text-slate-600 dark:text-slate-300">Until the new date this deadline counts as on time. You can remove the extension later.</p>
      </div>
    </Dialog>
  )
}
