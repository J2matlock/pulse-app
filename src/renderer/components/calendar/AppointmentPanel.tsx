/**
 * An appointment's details (W07 §6): who, when, where, how it repeats, and
 * the shared actions (Done…, No-show, Mark cancelled, Edit, Delete).
 */
import React from 'react'
import { useNavigate } from 'react-router-dom'
import { seriesRuleText, type Appointment } from '../../../shared/appointments'
import { formatTime, longDay } from '../../../shared/calendar'
import { useSettingsStore } from '../../stores/settingsStore'
import { AppointmentActions } from './AppointmentActions'
import { CalendarPanel } from './CalendarPanel'

const STATUS_TEXT: Record<Appointment['status'], string> = { scheduled: 'Scheduled', done: 'Done', no_show: 'No-show', cancelled: 'Cancelled' }

export function AppointmentPanel({ appointment: a, onClose }: { appointment: Appointment; onClose: () => void }): React.ReactElement {
  const navigate = useNavigate()
  const clock = useSettingsStore(s => s.clockFormat)

  const when = a.all_day ? `${longDay(a.start_at)}, all day` : `${longDay(a.start_at)}, ${formatTime(a.start_at, clock)}${a.end_at ? ` to ${formatTime(a.end_at, clock)}` : ''}`

  return (
    <CalendarPanel title={a.title} onClose={onClose}>
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
    </CalendarPanel>
  )
}
