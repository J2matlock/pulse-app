/**
 * An appointment's details (W07 §6): who, when, where, and Mark done /
 * No-show / Cancel, Edit, Delete. Done asks for the note first.
 */
import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, Check, UserX, Ban, Pencil, Trash2, RotateCcw } from 'lucide-react'
import type { Appointment } from '../../../shared/appointments'
import { formatTime, longDay } from '../../../shared/calendar'
import { setAppointmentStatus, deleteAppointment } from '../../utils/appointmentActions'
import { useSettingsStore } from '../../stores/settingsStore'
import { AppointmentDialog } from './AppointmentDialog'
import { ScopeDialog } from './ScopeDialog'
import { useVocab } from '../../hooks/useVocab'

const STATUS_TEXT: Record<Appointment['status'], string> = { scheduled: 'Scheduled', done: 'Done', no_show: 'No-show', cancelled: 'Cancelled' }

export function AppointmentPanel({ appointment: a, onClose }: { appointment: Appointment; onClose: () => void }): React.ReactElement {
  const navigate = useNavigate()
  const clock = useSettingsStore(s => s.clockFormat)
  const { t } = useVocab(null)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [doneNote, setDoneNote] = useState<string | null>(null)

  const when = a.all_day ? `${longDay(a.start_at)}, all day` : `${longDay(a.start_at)}, ${formatTime(a.start_at, clock)}${a.end_at ? ` to ${formatTime(a.end_at, clock)}` : ''}`

  async function remove(scope: 'one' | 'following' | 'all') {
    setDeleting(false)
    if (await deleteAppointment(a, scope)) onClose()
  }

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
      <p className="text-sm text-slate-500 dark:text-slate-400">{STATUS_TEXT[a.status]}{a.series_id !== null ? ' · repeats' : ''}</p>

      {doneNote !== null ? (
        <div className="space-y-2">
          <label className="block text-base text-slate-700 dark:text-slate-200">
            Note for the record <span className="text-slate-500 dark:text-slate-400">(optional)</span>
            <textarea className="input w-full mt-1" rows={3} autoFocus value={doneNote} onChange={e => setDoneNote(e.target.value)} placeholder={`${t('appointment', { cap: true })}: ${a.title}`} />
          </label>
          <div className="flex gap-2">
            <button type="button" className="btn-primary" onClick={() => void setAppointmentStatus(a, 'done', { noteContent: doneNote }).then(ok => { if (ok) onClose() })}>Mark done</button>
            <button type="button" className="btn-secondary" onClick={() => setDoneNote(null)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {a.status === 'scheduled' ? (
            <>
              <button type="button" className="btn-compact-primary" onClick={() => setDoneNote('')}><Check className="w-4 h-4" />Done</button>
              <button type="button" className="btn-compact-secondary" onClick={() => void setAppointmentStatus(a, 'no_show').then(ok => { if (ok) onClose() })}><UserX className="w-4 h-4" />No-show</button>
              <button type="button" className="btn-compact-secondary" onClick={() => void setAppointmentStatus(a, 'cancelled').then(ok => { if (ok) onClose() })}><Ban className="w-4 h-4" />Cancel it</button>
            </>
          ) : (
            <button type="button" className="btn-compact-secondary" onClick={() => void setAppointmentStatus(a, 'scheduled').then(ok => { if (ok) onClose() })}><RotateCcw className="w-4 h-4" />Back to scheduled</button>
          )}
          <button type="button" className="btn-compact-secondary" onClick={() => setEditing(true)}><Pencil className="w-4 h-4" />Edit</button>
          <button type="button" className="btn-compact-secondary" onClick={() => (a.series_id !== null ? setDeleting(true) : void remove('one'))}><Trash2 className="w-4 h-4" />Delete</button>
        </div>
      )}
      {editing && <AppointmentDialog appointment={a} onClose={() => { setEditing(false); onClose() }} />}
      {deleting && <ScopeDialog verb="Delete" onChoose={scope => void remove(scope)} onCancel={() => setDeleting(false)} />}
    </aside>
  )
}
