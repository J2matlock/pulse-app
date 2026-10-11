/**
 * An appointment's details (W07 §6): who, when, where, how it repeats, and
 * the shared actions (Done…, No-show, Mark cancelled, Edit, Delete).
 */
import React from 'react'
import { useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'
import { seriesRuleText, type Appointment } from '../../../shared/appointments'
import { formatTime, longDay } from '../../../shared/calendar'
import { useSettingsStore } from '../../stores/settingsStore'
import { AppointmentActions } from './AppointmentActions'

const STATUS_TEXT: Record<Appointment['status'], string> = { scheduled: 'Scheduled', done: 'Done', no_show: 'No-show', cancelled: 'Cancelled' }

export function AppointmentPanel({ appointment: a, onClose }: { appointment: Appointment; onClose: () => void }): React.ReactElement {
  const navigate = useNavigate()
  const clock = useSettingsStore(s => s.clockFormat)

  const when = a.all_day ? `${longDay(a.start_at)}, all day` : `${longDay(a.start_at)}, ${formatTime(a.start_at, clock)}${a.end_at ? ` to ${formatTime(a.end_at, clock)}` : ''}`

  return (
    <aside aria-labelledby="appt-panel-title" className="w-full sm:w-80 flex-shrink-0 border-l border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 space-y-3 overflow-y-auto">
      <div className="flex items-start gap-2">
        <h2 id="appt-panel-title" className="flex-1 text-lg font-semibold text-slate-900 dark:text-slate-100 break-words">{a.title}</h2>
        <button type="button" aria-label="Close" onClick={onClose}
          className="hit-44 p-1.5 rounded-sm hover:bg-slate-100 dark:hover:bg-slate-700 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"><X className="w-5 h-5 text-slate-500" /></button>
      </div>
      <p className="text-base text-slate-700 dark:text-slate-200">{when}</p>
      {a.record_name && (
        <button type="button" className="text-base text-blue-700 dark:text-blue-300 hover:underline focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 rounded-sm"
          onClick={() => navigate(`/profile/${a.row_id}?gridId=${a.grid_id}`)}>{a.record_name}</button>
      )}
      {a.location && <p className="text-base text-slate-600 dark:text-slate-300">{a.location}</p>}
      {a.notes && <p className="text-base text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{a.notes}</p>}
      <p className="text-sm text-slate-500 dark:text-slate-400">{STATUS_TEXT[a.status]}</p>
      {seriesRuleText(a) && <p className="text-base text-slate-600 dark:text-slate-300">{seriesRuleText(a)}</p>}

      <AppointmentActions appointment={a} onChanged={onClose} showEndSeries />
    </aside>
  )
}
