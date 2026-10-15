/**
 * The one set of appointment actions (audit S-19), used on the calendar
 * panel, the dashboard's Today card and a record's page: Done… (with an
 * optional note), No-show, Mark cancelled, Edit and Delete, or Back to
 * scheduled once it has an outcome. Marking a future one done says, in the
 * Done form, that it hasn't happened yet (no separate question, Q4).
 */
import React, { useState } from 'react'
import { Check, UserX, Ban, Pencil, Trash2, RotateCcw, CalendarX } from 'lucide-react'
import type { Appointment } from '../../../shared/appointments'
import { localDateString } from '../../../shared/dates'
import { setAppointmentStatus, deleteAppointment, endSeries } from '../../utils/appointmentActions'
import { useVocab } from '../../hooks/useVocab'
import { RowMenu } from '../ui/RowMenu'
import { AppointmentDialog } from './AppointmentDialog'
import { ScopeDialog } from './ScopeDialog'

export interface AppointmentActionsProps {
  appointment: Appointment
  /** After a change that finishes with this appointment (closes a panel) */
  onChanged?: () => void
  /** Show "End this series on…" (the calendar panel) */
  showEndSeries?: boolean
  /** The dashboard's short form: Done… / No-show / Cancelled, with Edit and Delete under "⋯" (UX D-26) */
  compact?: boolean
}

export function AppointmentActions({ appointment: a, onChanged, showEndSeries = false, compact = false }: AppointmentActionsProps): React.ReactElement {
  const { t } = useVocab(null)
  const [doneNote, setDoneNote] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [endOn, setEndOn] = useState<string | null>(null)
  const after = (ok: boolean) => { if (ok) onChanged?.() }
  const future = a.start_at.slice(0, 10) > localDateString()
  // Buttons name the appointment too, since a list can show several
  const named = (action: string) => `${action} (${a.title})`

  async function remove(scope: 'one' | 'following' | 'all') {
    setDeleting(false)
    after(await deleteAppointment(a, scope))
  }

  if (doneNote !== null) {
    return (
      <div className="w-full space-y-2">
        {future && (
          <p role="note" className="text-base text-amber-800 dark:text-amber-300">This {t('appointment')} is on a later day, so it hasn't happened yet.</p>
        )}
        <label className="block text-base text-slate-700 dark:text-slate-200">
          Note for the record <span className="text-slate-500 dark:text-slate-400">(optional)</span>
          <textarea className="input w-full mt-1" rows={3} autoFocus value={doneNote} onChange={e => setDoneNote(e.target.value)} placeholder={`${t('appointment', { cap: true })}: ${a.title}`} />
        </label>
        <div className="flex gap-2">
          <button type="button" className="btn-primary" onClick={() => void setAppointmentStatus(a, 'done', doneNote.trim() ? { noteContent: doneNote } : {}).then(ok => { setDoneNote(null); after(ok) })}>Mark done</button>
          <button type="button" className="btn-secondary" onClick={() => setDoneNote(null)}>Never mind</button>
        </div>
      </div>
    )
  }

  if (endOn !== null) {
    return (
      <div className="w-full flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-base text-slate-700 dark:text-slate-200">
          End this series on
          <input type="date" className="input w-auto" value={endOn} min={a.start_at.slice(0, 10)} onChange={e => setEndOn(e.target.value)} />
        </label>
        <button type="button" className="btn-compact-primary" disabled={!endOn} onClick={() => void endSeries(a, endOn).then(ok => { setEndOn(null); after(ok) })}>End series</button>
        <button type="button" className="btn-compact-secondary" onClick={() => setEndOn(null)}>Never mind</button>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap gap-2">
      {a.status === 'scheduled' ? (
        <>
          <button type="button" className="btn-compact-primary" aria-label={named('Done…')} onClick={() => setDoneNote('')}><Check className="w-4 h-4" />Done…</button>
          <button type="button" className="btn-compact-secondary" aria-label={named('No-show')} onClick={() => void setAppointmentStatus(a, 'no_show').then(after)}><UserX className="w-4 h-4" />No-show</button>
          <button type="button" className="btn-compact-secondary" aria-label={named(compact ? 'Cancelled' : 'Mark cancelled')} onClick={() => void setAppointmentStatus(a, 'cancelled').then(after)}><Ban className="w-4 h-4" />{compact ? 'Cancelled' : 'Mark cancelled'}</button>
        </>
      ) : (
        <button type="button" className="btn-compact-secondary" aria-label={named('Back to scheduled')} onClick={() => void setAppointmentStatus(a, 'scheduled').then(after)}><RotateCcw className="w-4 h-4" />Back to scheduled</button>
      )}
      {compact ? (
        <RowMenu label={named('More')} variant="secondary" items={[
          { label: 'Edit', onSelect: () => setEditing(true) },
          { label: 'Delete', danger: true, onSelect: () => { if (a.series_id !== null) setDeleting(true); else void remove('one') } },
        ]} />
      ) : (
        <>
          <button type="button" className="btn-compact-secondary" aria-label={named('Edit')} onClick={() => setEditing(true)}><Pencil className="w-4 h-4" />Edit</button>
          <button type="button" className="btn-compact-secondary" aria-label={named('Delete')} onClick={() => (a.series_id !== null ? setDeleting(true) : void remove('one'))}><Trash2 className="w-4 h-4" />Delete</button>
        </>
      )}
      {showEndSeries && a.series_id !== null && (
        <button type="button" className="btn-compact-secondary" onClick={() => setEndOn(a.start_at.slice(0, 10))}><CalendarX className="w-4 h-4" />End series…</button>
      )}
      {editing && <AppointmentDialog appointment={a} onClose={() => { setEditing(false); onChanged?.() }} />}
      {deleting && <ScopeDialog verb="Delete" onChoose={scope => void remove(scope)} onCancel={() => setDeleting(false)} />}
    </div>
  )
}
