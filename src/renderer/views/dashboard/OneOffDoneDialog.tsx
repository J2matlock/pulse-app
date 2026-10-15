import React, { useState } from 'react'
import { Dialog } from '../../components/ui/Dialog'
import { PrimaryButton, SecondaryButton } from '../../components/ui/Button'
import { formatDue } from '../../../shared/deadlineEngine'

export type OneOffChoice = { kind: 'renewed'; newDate: string } | { kind: 'finished' }

/**
 * Done on a date that doesn't repeat (Decision E1): was it renewed (a new
 * expiry date, the usual case) or finished for good (the date stays, and
 * it's recorded as done)?
 */
export function OneOffDoneDialog({ title, currentDue, onSave, onClose }: {
  title: string
  currentDue: string | null
  onSave: (choice: OneOffChoice) => void
  onClose: () => void
}): React.ReactElement {
  const [mode, setMode] = useState<'renewed' | 'finished'>('renewed')
  const [date, setDate] = useState('')
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date)
  const valid = mode === 'finished' || validDate

  function save() {
    if (!valid) return
    onSave(mode === 'finished' ? { kind: 'finished' } : { kind: 'renewed', newDate: date })
  }

  return (
    <Dialog open onClose={onClose} title={`Done: ${title}`} size="md"
      footer={<>
        <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
        <PrimaryButton disabled={!valid} onClick={save}>Mark done</PrimaryButton>
      </>}>
      <div className="space-y-4">
        {currentDue && <p className="text-base text-slate-600 dark:text-slate-300">Was due {formatDue(currentDue)}.</p>}
        <fieldset className="space-y-1">
          <legend className="sr-only">What happened?</legend>
          <label className="flex items-center gap-2 text-base text-slate-800 dark:text-slate-100 cursor-pointer" style={{ minHeight: 44 }}>
            <input type="radio" name="oneoff" className="w-5 h-5" checked={mode === 'renewed'} onChange={() => setMode('renewed')} />
            Renewed: it has a new date
          </label>
          {mode === 'renewed' && (
            <label className="block pl-7 text-base text-slate-700 dark:text-slate-200">
              New date
              <input type="date" className="input w-full mt-1" autoFocus value={date} onChange={e => setDate(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') save() }} />
            </label>
          )}
          <label className="flex items-center gap-2 text-base text-slate-800 dark:text-slate-100 cursor-pointer" style={{ minHeight: 44 }}>
            <input type="radio" name="oneoff" className="w-5 h-5" checked={mode === 'finished'} onChange={() => setMode('finished')} />
            Finished — nothing more is due for this
          </label>
        </fieldset>
      </div>
    </Dialog>
  )
}
