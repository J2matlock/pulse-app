/** Dashboard "Today" card (W07 §7): today's appointments in order, with quick Done / No-show. */
import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarClock, Check, UserX } from 'lucide-react'
import { IPC } from '../../../../shared/ipc-channels'
import type { Appointment } from '../../../../shared/appointments'
import { formatTime } from '../../../../shared/calendar'
import { localDateString } from '../../../../shared/dates'
import { safeInvoke } from '../../../utils/safeInvoke'
import { setAppointmentStatus } from '../../../utils/appointmentActions'
import { useSettingsStore } from '../../../stores/settingsStore'
import { useVocab } from '../../../hooks/useVocab'

export function TodayCard(): React.ReactElement {
  const navigate = useNavigate()
  const clock = useSettingsStore(s => s.clockFormat)
  const { t } = useVocab(null)
  const [appts, setAppts] = useState<Appointment[] | null>(null)
  const today = localDateString()
  const load = useCallback(async () => {
    const r = await safeInvoke<Appointment[]>(IPC.APPT_LIST, { from: today, to: today })
    setAppts(r.ok ? r.data.filter(a => a.status !== 'cancelled') : [])
  }, [today])
  useEffect(() => { void load() }, [load])
  useEffect(() => window.api.on(IPC.APPOINTMENTS_CHANGED, () => { void load() }), [load])

  return (
    <section aria-labelledby="today-card-title" className="mb-6 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 space-y-2">
      <div className="flex items-center gap-2">
        <h2 id="today-card-title" className="flex-1 text-lg font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <CalendarClock className="w-5 h-5" aria-hidden="true" />Today
        </h2>
        <button type="button" className="btn-compact-secondary" onClick={() => navigate('/calendar')}>Open calendar</button>
      </div>
      {appts && appts.length === 0 && <p className="text-base text-slate-500 dark:text-slate-400">No {t('appointment', { many: true })} today.</p>}
      <ul className="divide-y divide-slate-100 dark:divide-slate-700">
        {(appts ?? []).map(a => (
          <li key={a.id} className="flex flex-wrap items-center gap-2 py-2" style={{ minHeight: 44 }}>
            <span className="w-20 text-base tabular-nums text-slate-600 dark:text-slate-300">{formatTime(a.start_at, clock)}</span>
            <span className={`flex-1 min-w-0 text-base ${a.status === 'scheduled' ? 'text-slate-800 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400 line-through'}`}>
              {a.title}
              {a.record_name && (
                <> · <button type="button" className="text-blue-700 dark:text-blue-300 hover:underline" onClick={() => navigate(`/profile/${a.row_id}?gridId=${a.grid_id}`)}>{a.record_name}</button></>
              )}
            </span>
            {a.status === 'scheduled' && (
              <>
                <button type="button" className="btn-compact-secondary" aria-label={`${a.title}: done`} onClick={() => void setAppointmentStatus(a, 'done')}><Check className="w-4 h-4" />Done</button>
                <button type="button" className="btn-compact-secondary" aria-label={`${a.title}: no-show`} onClick={() => void setAppointmentStatus(a, 'no_show')}><UserX className="w-4 h-4" />No-show</button>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
