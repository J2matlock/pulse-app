import React, { useEffect, useRef, useState } from 'react'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { localDateString } from '../../../shared/dates'
import { isPastOrToday } from './DoneOnDayDialog'

/** "Current reading?" when marking a by-usage deadline done (W05 §3.4), and the day it was done when that wasn't today. */
export function MeterReadingDialog({ title, onSave, onClose }: {
  title: string
  /** doneOn is left out when it was done today */
  onSave: (reading: number, doneOn?: string) => void
  onClose: () => void
}): React.ReactElement {
  const trapRef = useRef<HTMLDivElement>(null)
  useFocusTrap(trapRef, true)
  const [text, setText] = useState('')
  const [otherDay, setOtherDay] = useState(false)
  const [day, setDay] = useState(localDateString())
  const value = Number(text.replace(/,/g, ''))
  const valid = text.trim() !== '' && Number.isFinite(value) && value >= 0 && (!otherDay || isPastOrToday(day))
  const save = () => onSave(value, otherDay && day !== localDateString() ? day : undefined)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div ref={trapRef} role="dialog" aria-modal="true" aria-labelledby="meter-title" onClick={e => e.stopPropagation()}
        className="w-full max-w-sm rounded-xl bg-white dark:bg-slate-800 shadow-xl border border-slate-200 dark:border-slate-700 p-6 space-y-4">
        <h2 id="meter-title" className="text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
        <label className="block text-base text-slate-700 dark:text-slate-200">
          Current reading
          <input className="input w-full mt-1" inputMode="decimal" autoFocus value={text} onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && valid) save() }} />
        </label>
        {otherDay ? (
          <label className="block text-base text-slate-700 dark:text-slate-200">
            Day it was done
            <input type="date" className="input w-full mt-1" max={localDateString()} value={day} onChange={e => setDay(e.target.value)} />
          </label>
        ) : (
          <button type="button" onClick={() => setOtherDay(true)}
            className="min-h-[44px] text-base text-blue-700 dark:text-blue-300 hover:underline rounded-sm focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
            Done on another day…
          </button>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={!valid} onClick={save}>Mark done</button>
        </div>
      </div>
    </div>
  )
}
