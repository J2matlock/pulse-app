/** Dashboard "Today" card (W07 §7): today's appointments in order, with quick Done / No-show. */
import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarClock, Check, UserX, X } from 'lucide-react'
import { IPC } from '../../../../shared/ipc-channels'
import type { Appointment } from '../../../../shared/appointments'
import { formatTime } from '../../../../shared/calendar'
import { localDateString, localDateFromToday } from '../../../../shared/dates'
import { formatDue } from '../../../../shared/deadlineEngine'

/** Same window as the briefing's count (main: OUTCOME_LOOKBACK_DAYS) */
const OUTCOME_DAYS = 14
import { safeInvoke } from '../../../utils/safeInvoke'
import { setAppointmentStatus } from '../../../utils/appointmentActions'
import { useSettingsStore } from '../../../stores/settingsStore'
import { useVocab } from '../../../hooks/useVocab'

export function TodayCard(): React.ReactElement {
  const navigate = useNavigate()
  const clock = useSettingsStore(s => s.clockFormat)
  const { t } = useVocab(null)
  const [appts, setAppts] = useState<Appointment[] | null>(null)
  // Past ones nobody said happened or not (S-09)
  const [pending, setPending] = useState<Appointment[]>([])
  const today = localDateString()
  const load = useCallback(async () => {
    const [r, past] = await Promise.all([
      safeInvoke<Appointment[]>(IPC.APPT_LIST, { from: today, to: today }),
      safeInvoke<Appointment[]>(IPC.APPT_LIST, { from: localDateFromToday(-OUTCOME_DAYS), to: localDateFromToday(-1) }),
    ])
    setAppts(r.ok ? r.data.filter(a => a.status !== 'cancelled') : [])
    setPending(past.ok ? past.data.filter(a => a.status === 'scheduled' && a.start_at.slice(0, 10) < today) : [])
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
      {pending.length > 0 && (
        <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-3">
          <h3 className="text-base font-semibold text-amber-900 dark:text-amber-100">Needs an outcome</h3>
          <p className="text-sm text-amber-900 dark:text-amber-200">Did these happen? Marking them writes the note and counts the contact.</p>
          <ul className="divide-y divide-amber-200 dark:divide-amber-800" aria-label="Needs an outcome">
            {pending.map(a => (
              <li key={a.id} className="flex flex-wrap items-center gap-2 py-2" style={{ minHeight: 44 }}>
                <span className="w-28 text-base tabular-nums text-slate-700 dark:text-slate-200">{formatDue(a.start_at.slice(0, 10))}</span>
                <span className="flex-1 min-w-0 text-base text-slate-800 dark:text-slate-100">
                  {a.title}
                  {a.record_name && (
                    <> · <button type="button" className="text-blue-700 dark:text-blue-300 hover:underline" onClick={() => navigate(`/profile/${a.row_id}?gridId=${a.grid_id}`)}>{a.record_name}</button></>
                  )}
                </span>
                <button type="button" className="btn-compact-secondary" aria-label={`${a.title}: done`} onClick={() => void setAppointmentStatus(a, 'done')}><Check className="w-4 h-4" />Done</button>
                <button type="button" className="btn-compact-secondary" aria-label={`${a.title}: no-show`} onClick={() => void setAppointmentStatus(a, 'no_show')}><UserX className="w-4 h-4" />No-show</button>
                <button type="button" className="btn-compact-secondary" aria-label={`${a.title}: cancelled`} onClick={() => void setAppointmentStatus(a, 'cancelled')}><X className="w-4 h-4" />Cancelled</button>
              </li>
            ))}
          </ul>
        </div>
      )}
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
