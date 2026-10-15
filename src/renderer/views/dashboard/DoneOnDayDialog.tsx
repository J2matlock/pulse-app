import React, { useEffect, useRef, useState } from 'react'
import { useFocusTrap } from '../../hooks/useFocusTrap'
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
  const trapRef = useRef<HTMLDivElement>(null)
  useFocusTrap(trapRef, true)
  const [day, setDay] = useState(localDateFromToday(-1))
  const valid = isPastOrToday(day)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div ref={trapRef} role="dialog" aria-modal="true" aria-labelledby="done-on-title" onClick={e => e.stopPropagation()}
        className="w-full max-w-sm rounded-xl bg-white dark:bg-slate-800 shadow-xl border border-slate-200 dark:border-slate-700 p-6 space-y-4">
        <h2 id="done-on-title" className="text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
        <label className="block text-base text-slate-700 dark:text-slate-200">
          Day it was done
          <input type="date" className="input w-full mt-1" autoFocus max={localDateString()} value={day} onChange={e => setDay(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && valid) onSave(day) }} />
        </label>
        <p className="text-base text-slate-600 dark:text-slate-300">The next one is counted from this day.</p>
        {!valid && day !== '' && <p className="text-base text-red-600 dark:text-red-400">Choose today or an earlier day.</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={!valid} onClick={() => onSave(day)}>Mark done</button>
        </div>
      </div>
    </div>
  )
}
