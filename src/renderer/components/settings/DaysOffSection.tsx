/**
 * Settings → Deadlines & reminders → "Days off": the weekend and holidays that
 * business-day deadlines skip (W05 §3.7). US federal holidays are worked out
 * on this computer; nothing is downloaded.
 */
import React, { useState } from 'react'
import toast from 'react-hot-toast'
import { CalendarOff, Trash2 } from 'lucide-react'
import { IPC } from '../../../shared/ipc-channels'
import type { WorkspaceState } from '../../../shared/ipc-contract'
import { daysInRange, usFederalHolidays } from '../../../shared/businessDays'
import { formatDue } from '../../../shared/deadlineEngine'
import { safeInvoke } from '../../utils/safeInvoke'
import { useWorkspaceStore } from '../../stores/workspaceStore'

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

async function save(holidays: string[], weekend?: number[]): Promise<boolean> {
  const res = await safeInvoke<WorkspaceState>(IPC.HOLIDAYS_SET, holidays, ...(weekend ? [weekend] : []))
  if (!res.ok) { toast.error(res.error); return false }
  useWorkspaceStore.setState({ calendar: res.data.calendar })
  return true
}

export function DaysOffSection(): React.ReactElement {
  const calendar = useWorkspaceStore(s => s.calendar) ?? { holidays: [], weekend: [0, 6] }
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const year = new Date().getFullYear()

  async function addRange() {
    if (!start) return
    const last = end && end >= start ? end : start
    const days = daysInRange(start, last)
    if (await save([...calendar.holidays, ...days])) { setStart(''); setEnd('') }
  }

  async function addFederal(y: number) {
    const added = usFederalHolidays(y).map(h => h.date)
    if (await save([...calendar.holidays, ...added])) toast.success(`Added US federal holidays for ${y}`)
  }

  function toggleWeekday(d: number) {
    const next = calendar.weekend.includes(d) ? calendar.weekend.filter(x => x !== d) : [...calendar.weekend, d]
    if (next.length >= 7) { toast.error('Keep at least one working day in the week.'); return }
    void save(calendar.holidays, next)
  }

  const upcoming = calendar.holidays.filter(d => d >= `${year - 1}-01-01`)

  return (
    <section className="space-y-3 pb-4 border-b border-slate-200 dark:border-slate-700" aria-labelledby="days-off-heading">
      <h2 id="days-off-heading" className="text-xl font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
        <CalendarOff className="w-5 h-5" aria-hidden="true" />Days off
      </h2>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Deadlines that count working days, like "60 school days", skip these days. So do deadlines set to move off a day off.
      </p>

      <fieldset>
        <legend className="text-base font-medium text-slate-800 dark:text-slate-100 mb-1">Weekend</legend>
        <div className="flex flex-wrap gap-x-4">
          {WEEKDAYS.map((name, d) => (
            <label key={d} className="flex items-center gap-2 text-base text-slate-700 dark:text-slate-200 cursor-pointer" style={{ minHeight: 44 }}>
              <input type="checkbox" className="w-5 h-5" checked={calendar.weekend.includes(d)} onChange={() => toggleWeekday(d)} />
              {name}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-base text-slate-700 dark:text-slate-200">
          <span className="block mb-1">Day off, or first day of a break</span>
          <input type="date" className="input w-auto" value={start} onChange={e => setStart(e.target.value)} />
        </label>
        <label className="text-base text-slate-700 dark:text-slate-200">
          <span className="block mb-1">Last day <span className="text-slate-500 dark:text-slate-400">(optional)</span></span>
          <input type="date" className="input w-auto" value={end} min={start || undefined} onChange={e => setEnd(e.target.value)} />
        </label>
        <button type="button" className="btn-secondary" disabled={!start} onClick={() => void addRange()}>Add</button>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-compact-secondary" onClick={() => void addFederal(year)}>Add US federal holidays for {year}</button>
        <button type="button" className="btn-compact-secondary" onClick={() => void addFederal(year + 1)}>…for {year + 1}</button>
      </div>

      {upcoming.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Days off">
          {upcoming.map(d => (
            <li key={d} className="flex items-center gap-1 pl-3 rounded-full bg-slate-100 dark:bg-slate-700 text-base text-slate-700 dark:text-slate-200">
              {formatDue(d)}
              <button type="button" aria-label={`Remove ${formatDue(d)}`} onClick={() => void save(calendar.holidays.filter(x => x !== d))}
                className="hit-44 p-2 rounded-full text-slate-500 hover:text-red-600 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
                <Trash2 className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-500 dark:text-slate-400">No days off added yet.</p>
      )}
    </section>
  )
}
