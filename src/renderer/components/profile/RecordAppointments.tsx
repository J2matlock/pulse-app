/**
 * Profile "Appointments" (W07 §7): the next five and the last five, with
 * the same actions as the calendar, and "Schedule…".
 */
import React, { useCallback, useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { IPC } from '../../../shared/ipc-channels'
import { seriesRuleText, type Appointment } from '../../../shared/appointments'
import { formatTime, longDay } from '../../../shared/calendar'
import { localDateString } from '../../../shared/dates'
import { safeInvoke } from '../../utils/safeInvoke'
import { AppointmentActions } from '../calendar/AppointmentActions'
import { useSettingsStore } from '../../stores/settingsStore'
import { AppointmentDialog } from '../calendar/AppointmentDialog'
import { useVocab } from '../../hooks/useVocab'

interface RecordAppts { upcoming: Appointment[]; past: Appointment[]; upcomingTotal: number; pastTotal: number }

const STATUS: Record<Appointment['status'], string> = { scheduled: 'Scheduled', done: 'Done', no_show: 'No-show', cancelled: 'Cancelled' }

export function RecordAppointments({ rowId, gridId, name, onCount }: {
  rowId: number; gridId: number; name: string
  /** How many there are, and how many are still to come */
  onCount?: (total: number, upcoming: number) => void
}): React.ReactElement {
  const clock = useSettingsStore(s => s.clockFormat)
  const { t } = useVocab(gridId)
  const [data, setData] = useState<RecordAppts>({ upcoming: [], past: [], upcomingTotal: 0, pastTotal: 0 })
  const [editing, setEditing] = useState<Appointment | 'new' | null>(null)
  const today = localDateString()

  const load = useCallback(async () => {
    const r = await safeInvoke<RecordAppts>(IPC.APPT_FOR_RECORD, rowId)
    if (r.ok) setData(r.data)
  }, [rowId])
  useEffect(() => { void load() }, [load])
  // The lists show five each; the counts are the real totals
  useEffect(() => { onCount?.(data.upcomingTotal + data.pastTotal, data.upcomingTotal) }, [data, onCount])
  useEffect(() => window.api.on(IPC.APPOINTMENTS_CHANGED, () => { void load() }), [load])

  const when = (a: Appointment) => `${longDay(a.start_at)}${a.all_day ? '' : `, ${formatTime(a.start_at, clock)}`}`
  const row = (a: Appointment, past: boolean) => (
    <li key={a.id} className="flex flex-wrap items-center gap-2 py-2" style={{ minHeight: 44 }}>
      <button type="button" onClick={() => setEditing(a)} className="flex-1 min-w-0 text-left focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 rounded-sm">
        <span className="block text-base font-medium text-slate-800 dark:text-slate-100 truncate">{a.title}</span>
        <span className="block text-sm text-slate-500 dark:text-slate-400">{when(a)}{past || a.status !== 'scheduled' ? ` · ${STATUS[a.status]}` : ''}</span>
        {!past && seriesRuleText(a) && <span className="block text-sm text-slate-500 dark:text-slate-400">{seriesRuleText(a)}</span>}
      </button>
      <AppointmentActions appointment={a} />
    </li>
  )

  return (
    <div className="space-y-3">
      {/* One left-aligned line when nothing is coming up, not a button floating over an empty list (C-37) */}
      {data.upcoming.length ? (
        <div>
          <h3 className="text-base font-semibold text-slate-700 dark:text-slate-200">Coming up</h3>
          <ul className="divide-y divide-slate-100 dark:divide-slate-700">{data.upcoming.map(a => row(a, false))}</ul>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {!data.upcoming.length && <p className="text-base text-slate-500 dark:text-slate-400">Nothing scheduled.</p>}
        <button type="button" className="btn-compact-secondary" onClick={() => setEditing('new')}>
          <Plus className="w-4 h-4" />Schedule {t('appointment', { article: true })}
        </button>
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
