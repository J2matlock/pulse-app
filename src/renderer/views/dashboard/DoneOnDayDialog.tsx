import React, { useState } from 'react'
import { Dialog } from '../../components/ui/Dialog'
import { PrimaryButton, SecondaryButton } from '../../components/ui/Button'
import { localDateFromToday, localDateString } from '../../../shared/dates'

/** A real YYYY-MM-DD that isn't in the future */
export function isPastOrToday(day: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && day >= '1900-01-01' && day <= localDateString()
}

/**
 * "Done on…": the visit was Friday, it's being marked done on Monday (audit
 * 1.22). The title names the deed ("Mark Annual review done for Pat", UX D-23).
 */
export function DoneOnDayDialog({ title, onSave, onClose }: {
  title: string
  onSave: (day: string) => void
  onClose: () => void
}): React.ReactElement {
  const [day, setDay] = useState(localDateFromToday(-1))
  const valid = isPastOrToday(day)

  return (
    <Dialog open onClose={onClose} title={title} size="sm"
      footer={<>
        <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
        <PrimaryButton disabled={!valid} onClick={() => onSave(day)}>Mark done</PrimaryButton>
      </>}>
      <div className="space-y-4">
        <label className="block text-base text-slate-700 dark:text-slate-200">
          Day it was done
          <input type="date" className="input w-full mt-1" autoFocus max={localDateString()} value={day} onChange={e => setDay(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && valid) onSave(day) }} />
        </label>
        <p className="text-base text-slate-600 dark:text-slate-300">The next one is counted from this day.</p>
        {!valid && day !== '' && <p className="text-base text-red-600 dark:text-red-400">Choose today or an earlier day.</p>}
      </div>
    </Dialog>
  )
}
