import { useState } from 'react'
import { Dialog } from '../../components/ui/Dialog'
import { PrimaryButton } from '../../components/ui/Button'
import { localDateString, localDateFromToday } from '../../../shared/dates'

/** "Sun, Oct 11" */
export function snoozeDay(ymd: string): string {
  return new Date(`${ymd}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export function SnoozeDialog({ onClose, onSnooze }: { onClose: () => void; onSnooze: (date: string) => void }) {
  const tomorrow  = localDateFromToday(1)
  const in3Days   = localDateFromToday(3)
  const nextWeek  = localDateFromToday(7)
  const [custom, setCustom] = useState('')
  const today = localDateString()

  return (
    // The description says where it goes meanwhile (UX D-34)
    <Dialog open onClose={onClose} size="sm" title="Snooze until…"
      description="It's hidden until then; find it under Snoozed below.">
      <div className="space-y-2">
        {[
          { label: 'Tomorrow', date: tomorrow },
          { label: 'In 3 days', date: in3Days },
          { label: 'In a week', date: nextWeek },
        ].map(opt => (
          <button
            key={opt.date}
            onClick={() => { onSnooze(opt.date); onClose() }}
            className="hit-44 w-full text-left px-3 py-2 rounded-sm hover:bg-slate-100 dark:hover:bg-slate-700
                       text-base text-slate-700 dark:text-slate-300 transition-colors"
          >
            {opt.label} <span className="text-base text-slate-500 dark:text-slate-400">({snoozeDay(opt.date)})</span>
          </button>
        ))}
        <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
          <label htmlFor="task-snooze-custom" className="block text-base text-slate-500 mb-1">Custom date</label>
          <input
            id="task-snooze-custom"
            type="date"
            min={tomorrow}
            value={custom}
            onChange={e => setCustom(e.target.value)}
            className="input w-full text-base"
          />
          <PrimaryButton
            onClick={() => { if (custom && custom > today) { onSnooze(custom); onClose() } }}
            disabled={!custom || custom <= today}
            className="w-full mt-2"
          >
            Snooze
          </PrimaryButton>
        </div>
      </div>
    </Dialog>
  )
}
