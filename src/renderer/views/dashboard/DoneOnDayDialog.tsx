import React, { useId, useState } from 'react'
import { Dialog } from '../../components/ui/Dialog'
import { PrimaryButton, SecondaryButton } from '../../components/ui/Button'
import { DateField } from '../../components/ui/DateField'
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
  // A half-typed date keeps Mark done off; the box says why (persona study D1)
  const [partial, setPartial] = useState(false)
  const valid = !partial && isPastOrToday(day)
  const id = useId()

  return (
    <Dialog open onClose={onClose} title={title} size="sm"
      footer={<>
        <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
        <PrimaryButton disabled={!valid} onClick={() => onSave(day)}>Mark done</PrimaryButton>
      </>}>
      <div className="space-y-4">
        <div>
          <label htmlFor={id} className="block text-base text-slate-700 dark:text-slate-200">Day it was done</label>
          <DateField id={id} className="input w-full mt-1" autoFocus max={localDateString()} value={day}
            onChange={(v, p) => { setDay(v ?? ''); setPartial(p) }}
            onCommit={(v, how) => { if (how === 'enter' && v && isPastOrToday(v)) onSave(v) }} />
        </div>
        <p className="text-base text-slate-600 dark:text-slate-300">The next one is counted from this day.</p>
        {!valid && !partial && day !== '' && <p className="text-base text-red-600 dark:text-red-400">Choose today or an earlier day.</p>}
      </div>
    </Dialog>
  )
}
