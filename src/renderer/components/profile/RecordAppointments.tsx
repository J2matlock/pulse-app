/**
 * Profile "Appointments" (W07 §7): the next five and the last five, with
 * Done / No-show for ones that have come, and "Schedule…".
 */
import React, { useCallback, useEffect, useState } from 'react'
import { Plus, Check, UserX } from 'lucide-react'
import { IPC } from '../../../shared/ipc-channels'
import type { Appointment } from '../../../shared/appointments'
import { formatTime, longDay } from '../../../shared/calendar'
import { localDateString } from '../../../shared/dates'
import { safeInvoke } from '../../utils/safeInvoke'
import { setAppointmentStatus } from '../../utils/appointmentActions'
import { useSettingsStore } from '../../stores/settingsStore'
import { AppointmentDialog } from '../calendar/AppointmentDialog'

const STATUS: Record<Appointment['status'], string> = { scheduled: 'Scheduled', done: 'Done', no_show: 'No-show', cancelled: 'Cancelled' }

export function RecordAppointments({ rowId, gridId, name }: { rowId: number; gridId: number; name: string }): React.ReactElement {
  const clock = useSettingsStore(s => s.clockFormat)
  const [data, setData] = useState<{ upcoming: Appointment[]; past: Appointment[] }>({ upcoming: [], past: [] })
  const [editing, setEditing] = useState<Appointment | 'new' | null>(null)
  const today = localDateString()

  const load = useCallback(async () => {
    const r = await safeInvoke<{ upcoming: Appointment[]; past: Appointment[] }>(IPC.APPT_FOR_RECORD, rowId)
    if (r.ok) setData(r.data)
  }, [rowId])
  useEffect(() => { void load() }, [load])
  useEffect(() => window.api.on(IPC.APPOINTMENTS_CHANGED, () => { void load() }), [load])

  const when = (a: Appointment) => `${longDay(a.start_at)}${a.all_day ? '' : `, ${formatTime(a.start_at, clock)}`}`
  const row = (a: Appointment, past: boolean) => (
    <li key={a.id} className="flex flex-wrap items-center gap-2 py-2" style={{ minHeight: 44 }}>
      <button type="button" onClick={() => setEditing(a)} className="flex-1 min-w-0 text-left focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 rounded-sm">
        <span className="block text-base font-medium text-slate-800 dark:text-slate-100 truncate">{a.title}</span>
        <span className="block text-sm text-slate-500 dark:text-slate-400">{when(a)}{past || a.status !== 'scheduled' ? ` · ${STATUS[a.status]}` : ''}</span>
      </button>
      {a.status === 'scheduled' && a.start_at.slice(0, 10) <= today && (
        <>
          <button type="button" className="btn-compact-secondary" onClick={() => void setAppointmentStatus(a, 'done')}><Check className="w-4 h-4" />Done</button>
          <button type="button" className="btn-compact-secondary" onClick={() => void setAppointmentStatus(a, 'no_show')}><UserX className="w-4 h-4" />No-show</button>
        </>
      )}
    </li>
  )

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button type="button" className="btn-compact-secondary" onClick={() => setEditing('new')}><Plus className="w-4 h-4" />Schedule…</button>
      </div>
      <div>
        <h3 className="text-base font-semibold text-slate-700 dark:text-slate-200">Coming up</h3>
        {data.upcoming.length ? <ul className="divide-y divide-slate-100 dark:divide-slate-700">{data.upcoming.map(a => row(a, false))}</ul>
          : <p className="text-sm text-slate-500 dark:text-slate-400">Nothing scheduled.</p>}
      </div>
      {data.past.length > 0 && (
        <div>
          <h3 className="text-base font-semibold text-slate-700 dark:text-slate-200">Earlier</h3>
          <ul className="divide-y divide-slate-100 dark:divide-slate-700">{data.past.map(a => row(a, true))}</ul>
        </div>
      )}
      {editing && (
        <AppointmentDialog appointment={editing === 'new' ? undefined : editing} start={editing === 'new' ? `${today}T09:00` : undefined}
          record={{ rowId, gridId, name }} onClose={() => setEditing(null)} />
      )}
    </div>
  )
}
