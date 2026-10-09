import { useRef, useState } from 'react'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { localDateString, localDateFromToday } from '../../../shared/dates'

export function SnoozeDialog({ onClose, onSnooze }: { onClose: () => void; onSnooze: (date: string) => void }) {
  const tomorrow  = localDateFromToday(1)
  const in3Days   = localDateFromToday(3)
  const nextWeek  = localDateFromToday(7)
  const [custom, setCustom] = useState('')
  const today = localDateString()
  const trapRef = useRef<HTMLDivElement>(null)

  useFocusTrap(trapRef, true)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
         onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={trapRef} className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-64 p-4 space-y-2">
        <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100 mb-3">Snooze until...</h3>
        {[
          { label: '1 day',  date: tomorrow },
          { label: '3 days', date: in3Days },
          { label: '1 week', date: nextWeek },
        ].map(opt => (
          <button
            key={opt.date}
            onClick={() => { onSnooze(opt.date); onClose() }}
            className="hit-44 w-full text-left px-3 py-2 rounded-sm hover:bg-slate-100 dark:hover:bg-slate-700
                       text-base text-slate-700 dark:text-slate-300 transition-colors"
          >
            {opt.label} <span className="text-sm text-slate-500 dark:text-slate-400">({opt.date})</span>
          </button>
        ))}
        <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
          <label htmlFor="task-snooze-custom" className="block text-base text-slate-500 mb-1">Custom date</label>
          <input
            id="task-snooze-custom"
            type="date"
            min={today}
            value={custom}
            onChange={e => setCustom(e.target.value)}
            className="input w-full text-base"
          />
          <button
            onClick={() => { if (custom) { onSnooze(custom); onClose() } }}
            disabled={!custom}
            className="btn-primary w-full mt-2 disabled:opacity-40"
          >
            Snooze
          </button>
        </div>
      </div>
    </div>
  )
}
