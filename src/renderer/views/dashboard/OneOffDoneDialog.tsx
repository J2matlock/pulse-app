import React, { useEffect, useRef, useState } from 'react'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { formatDue } from '../../../shared/deadlineEngine'

export type OneOffChoice = { kind: 'renewed'; newDate: string } | { kind: 'finished' }

/**
 * Done on a date that doesn't repeat (Decision E1): was it renewed (a new
 * expiry date, the usual case) or finished for good (the date stays, marked
 * done)?
 */
export function OneOffDoneDialog({ title, currentDue, onSave, onClose }: {
  title: string
  currentDue: string | null
  onSave: (choice: OneOffChoice) => void
  onClose: () => void
}): React.ReactElement {
  const trapRef = useRef<HTMLDivElement>(null)
  useFocusTrap(trapRef, true)
  const [mode, setMode] = useState<'renewed' | 'finished'>('renewed')
  const [date, setDate] = useState('')
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date)
  const valid = mode === 'finished' || validDate

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function save() {
    if (!valid) return
    onSave(mode === 'finished' ? { kind: 'finished' } : { kind: 'renewed', newDate: date })
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div ref={trapRef} role="dialog" aria-modal="true" aria-labelledby="oneoff-title" onClick={e => e.stopPropagation()}
        className="w-full max-w-md rounded-xl bg-white dark:bg-slate-800 shadow-xl border border-slate-200 dark:border-slate-700 p-6 space-y-4">
        <h2 id="oneoff-title" className="text-lg font-semibold text-slate-900 dark:text-slate-100">Done: {title}</h2>
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
            Finished: nothing more is due (the date stays, marked done)
          </label>
        </fieldset>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={!valid} onClick={save}>Mark done</button>
        </div>
      </div>
    </div>
  )
}
