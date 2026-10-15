import React, { useState } from 'react'
import { Dialog } from '../../components/ui/Dialog'
import { PrimaryButton, SecondaryButton } from '../../components/ui/Button'
import { localDateString } from '../../../shared/dates'
import { implausibleReading, type MeterInfo } from '../../../shared/deadlineEngine'
import { isPastOrToday } from './DoneOnDayDialog'

/**
 * "Current reading?" when marking a by-usage deadline done (W05 §3.4), and
 * the day it was done when that wasn't today. Starts from the reading on
 * file, shows the unit, and checks a reading that looks like a typo before
 * saving it (D-31).
 */
export function MeterReadingDialog({ title, info, onSave, onClose }: {
  title: string
  /** Unit and readings on file, when known */
  info?: MeterInfo | null
  /** doneOn is left out when it was done today */
  onSave: (reading: number, doneOn?: string) => void
  onClose: () => void
}): React.ReactElement {
  const [text, setText] = useState(info?.current != null ? String(info.current) : '')
  const [otherDay, setOtherDay] = useState(false)
  const [day, setDay] = useState(localDateString())
  const value = Number(text.replace(/,/g, ''))
  const readingOk = text.trim() !== '' && Number.isFinite(value) && value >= 0
  const valid = readingOk && (!otherDay || isPastOrToday(day))
  const warning = readingOk && info ? implausibleReading(value, info) : null
  // A reading that looks wrong needs a second click
  const [confirmed, setConfirmed] = useState<number | null>(null)
  const needsConfirm = !!warning && confirmed !== value
  const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 1 })

  function save() {
    if (!valid) return
    if (needsConfirm) { setConfirmed(value); return }
    onSave(value, otherDay && day !== localDateString() ? day : undefined)
  }

  return (
    <Dialog open onClose={onClose} title={title} size="sm"
      footer={<>
        <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
        <PrimaryButton disabled={!valid} onClick={save}>{warning && confirmed === value ? 'Mark done anyway' : 'Mark done'}</PrimaryButton>
      </>}>
      <div className="space-y-4">
        <label className="block text-base text-slate-700 dark:text-slate-200">
          Current reading{info?.unit ? ` (${info.unit})` : ''}
          <span className="flex items-center gap-2 mt-1">
            <input className="input w-full" inputMode="decimal" autoFocus value={text} onChange={e => setText(e.target.value)}
              aria-invalid={!!warning || undefined} aria-describedby={warning ? 'meter-warning' : undefined}
              onKeyDown={e => { if (e.key === 'Enter') save() }} />
            {info?.unit && <span className="text-base text-slate-600 dark:text-slate-300">{info.unit}</span>}
          </span>
        </label>
        {info && (info.current != null || info.lastService != null) && (
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {info.current != null ? `On file now: ${fmt(info.current)} ${info.unit}` : ''}
            {info.current != null && info.lastService != null ? ' · ' : ''}
            {info.lastService != null ? `At the last service: ${fmt(info.lastService)} ${info.unit}` : ''}
          </p>
        )}
        {warning && <p id="meter-warning" role="alert" className="text-base text-amber-800 dark:text-amber-200">{warning}</p>}
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
      </div>
    </Dialog>
  )
}
