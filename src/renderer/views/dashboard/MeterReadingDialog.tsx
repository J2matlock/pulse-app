import React, { useEffect, useRef, useState } from 'react'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { implausibleReading, type MeterInfo } from '../../../shared/deadlineEngine'

/**
 * "Current reading?" when marking a by-usage deadline done (W05 §3.4).
 * Starts from the reading on file, shows the unit, and checks a reading
 * that looks like a typo before saving it (D-31).
 */
export function MeterReadingDialog({ title, info, onSave, onClose }: {
  title: string
  /** Unit and readings on file, when known */
  info?: MeterInfo | null
  onSave: (reading: number) => void
  onClose: () => void
}): React.ReactElement {
  const trapRef = useRef<HTMLDivElement>(null)
  useFocusTrap(trapRef, true)
  const [text, setText] = useState(info?.current != null ? String(info.current) : '')
  const value = Number(text.replace(/,/g, ''))
  const valid = text.trim() !== '' && Number.isFinite(value) && value >= 0
  const warning = valid && info ? implausibleReading(value, info) : null
  // A reading that looks wrong needs a second click
  const [confirmed, setConfirmed] = useState<number | null>(null)
  const needsConfirm = !!warning && confirmed !== value
  const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 1 })

  function save() {
    if (!valid) return
    if (needsConfirm) { setConfirmed(value); return }
    onSave(value)
  }

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
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={!valid} onClick={save}>{warning && confirmed === value ? 'Mark done anyway' : 'Mark done'}</button>
        </div>
      </div>
    </div>
  )
}
