/**
 * New or edit appointment (W07 §6): who it's with, when, where, what kind
 * of note it becomes when done, and (for new ones) how it repeats.
 */
import React, { useEffect, useRef, useState } from 'react'
import { CalendarClock, X } from 'lucide-react'
import { IPC } from '../../../shared/ipc-channels'
import type { CrossGridSearchResult } from '../../../shared/ipc-contract'
import type { Column } from '../../../shared/types'
import { apptInputSchema, addMinutes, minutesBetween, type Appointment, type ApptInput, type SeriesRule } from '../../../shared/appointments'
import { safeInvoke } from '../../utils/safeInvoke'
import { createAppointment, updateAppointment } from '../../utils/appointmentActions'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useVocab } from '../../hooks/useVocab'
import { useActivityTypes } from '../../hooks/useActivityTypes'
import { ScopeDialog } from './ScopeDialog'

const label = 'block text-base font-semibold text-slate-800 dark:text-slate-100 mb-1'
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

type Repeat = 'none' | 'daily' | 'weekly' | 'monthly'
type Ends = 'never' | 'date' | 'count' | 'column'

export interface AppointmentDialogProps {
  /** Editing this one; otherwise a new appointment */
  appointment?: Appointment
  /** New: the day (and time) to start from */
  start?: string
  /** New: who it's with */
  record?: { rowId: number; gridId: number; name: string }
  onClose: () => void
}

export function AppointmentDialog({ appointment, start, record, onClose }: AppointmentDialogProps): React.ReactElement {
  const trapRef = useRef<HTMLDivElement>(null)
  useFocusTrap(trapRef, true)
  const { t } = useVocab(null)
  const { active: noteTypes } = useActivityTypes()
  const a = appointment
  const startAt = a?.start_at ?? start ?? ''
  const [title, setTitle] = useState(a?.title ?? '')
  const [who, setWho] = useState<{ rowId: number; gridId: number; name: string } | null>(
    a?.row_id ? { rowId: a.row_id, gridId: a.grid_id ?? 0, name: a.record_name ?? '' } : record ?? null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CrossGridSearchResult[]>([])
  const [date, setDate] = useState(startAt.slice(0, 10))
  const [allDay, setAllDay] = useState(a ? !!a.all_day : false)
  const [time, setTime] = useState(startAt.length > 10 ? startAt.slice(11, 16) : '09:00')
  const [duration, setDuration] = useState(a?.end_at && a.start_at.length > 10 ? String(minutesBetween(a.start_at, a.end_at)) : '60')
  const [location, setLocation] = useState(a?.location ?? '')
  const [kind, setKind] = useState(a?.activity_type_key ?? '')
  const [notes, setNotes] = useState(a?.notes ?? '')
  const [repeat, setRepeat] = useState<Repeat>('none')
  const [every, setEvery] = useState('1')
  const [byDay, setByDay] = useState<number[]>([])
  const [ends, setEnds] = useState<Ends>('never')
  const [until, setUntil] = useState('')
  const [count, setCount] = useState('10')
  const [untilCol, setUntilCol] = useState<number | null>(null)
  const [dateColumns, setDateColumns] = useState<Column[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [askScope, setAskScope] = useState<ApptInput | null>(null)

  useEffect(() => {
    if (!query.trim()) { setResults([]); return }
    const timer = setTimeout(() => {
      void safeInvoke<CrossGridSearchResult[]>(IPC.SEARCH_CLIENTS_CROSS_GRID, query.trim()).then(r => setResults(r.ok ? r.data.slice(0, 8) : []))
    }, 150)
    return () => clearTimeout(timer)
  }, [query])

  // "Until the date in a column": the record's own date columns
  useEffect(() => {
    if (!who?.gridId) { setDateColumns([]); return }
    void safeInvoke<{ columns: Column[] } | null>(IPC.GRID_GET, who.gridId, false).then(r => setDateColumns(r.ok && r.data ? r.data.columns.filter(c => c.column_type === 'date') : []))
  }, [who?.gridId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !askScope) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, askScope])

  function build(): ApptInput | null {
    const mins = Math.max(0, parseInt(duration, 10) || 0)
    const s = allDay ? date : `${date}T${time}`
    const input: ApptInput = {
      row_id: who?.rowId ?? null, title: title.trim(), start_at: s,
      end_at: allDay ? null : mins > 0 ? addMinutes(s, mins) : null, all_day: allDay,
      location: location || null, activity_type_key: kind || null, notes: notes || null,
    }
    const check = apptInputSchema.safeParse(input)
    if (!check.success) { setError(check.error.issues[0]?.message ?? 'Some details are missing.'); return null }
    return input
  }

  function rule(): SeriesRule | null {
    if (repeat === 'none') return null
    const r: SeriesRule = { freq: repeat, interval: Math.max(1, Math.min(12, parseInt(every, 10) || 1)) }
    if (repeat === 'weekly' && byDay.length) r.byDay = [...byDay].sort()
    if (ends === 'date' && until) r.until = until
    if (ends === 'count') r.count = Math.max(1, Math.min(500, parseInt(count, 10) || 1))
    if (ends === 'column' && untilCol) r.untilColumnId = untilCol
    return r
  }

  async function save(scope?: 'one' | 'following' | 'all', prepared?: ApptInput) {
    setError(null)
    const input = prepared ?? build()
    if (!input) return
    if (a && a.series_id !== null && !scope) { setAskScope(input); return }
    setSaving(true)
    try {
      const ok = a
        ? await updateAppointment(a, input, scope ?? 'one')
        : (await createAppointment(input, rule())) !== null
      if (ok) onClose()
    } finally { setSaving(false); setAskScope(null) }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div ref={trapRef} role="dialog" aria-modal="true" aria-labelledby="appt-dialog-title" onClick={e => e.stopPropagation()}
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white dark:bg-slate-800 shadow-xl border border-slate-200 dark:border-slate-700 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 id="appt-dialog-title" className="text-lg font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <CalendarClock className="w-5 h-5" aria-hidden="true" />{a ? `Edit ${t('appointment')}` : `New ${t('appointment')}`}
          </h2>
          <button type="button" aria-label="Close" onClick={onClose}
            className="hit-44 p-1.5 rounded-sm hover:bg-slate-100 dark:hover:bg-slate-700 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <label className="block">
          <span className={label}>What</span>
          <input className="input w-full" autoFocus maxLength={200} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Session, Drop-off, Home visit" />
        </label>

        <div>
          <span className={label}>With</span>
          {who ? (
            <div className="flex items-center gap-2">
              <span className="text-base text-slate-800 dark:text-slate-100">{who.name || '(unnamed)'}</span>
              <button type="button" className="btn-compact-secondary" onClick={() => setWho(null)}>Change</button>
            </div>
          ) : (
            <div>
              <input type="search" className="input w-full" aria-label={`Find ${t('record', { article: true })}`} value={query}
                onChange={e => setQuery(e.target.value)} placeholder={`Search ${t('record', { many: true })}, or leave empty`} />
              {results.length > 0 && (
                <ul className="mt-1 rounded-lg border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700" aria-label="Matches">
                  {results.map(r => (
                    <li key={r.rowId}>
                      <button type="button" className="w-full text-left px-3 text-base hover:bg-slate-50 dark:hover:bg-slate-700" style={{ minHeight: 44 }}
                        onClick={() => { setWho({ rowId: r.rowId, gridId: r.gridId, name: r.clientName }); setQuery('') }}>
                        {r.clientName} <span className="text-sm text-slate-500 dark:text-slate-400">{r.gridName}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className={label}>Date</span>
            <input type="date" className="input w-auto" value={date} onChange={e => setDate(e.target.value)} />
          </label>
          {!allDay && (
            <>
              <label className="block">
                <span className={label}>Time</span>
                <input type="time" className="input w-auto" value={time} onChange={e => setTime(e.target.value)} />
              </label>
              <label className="block">
                <span className={label}>Minutes</span>
                <input type="number" min={0} max={1440} className="input w-24" value={duration} onChange={e => setDuration(e.target.value)} />
              </label>
            </>
          )}
          <label className="flex items-center gap-2 text-base text-slate-700 dark:text-slate-200 cursor-pointer" style={{ minHeight: 44 }}>
            <input type="checkbox" className="w-5 h-5" checked={allDay} onChange={e => setAllDay(e.target.checked)} />
            All day
          </label>
        </div>

        <label className="block">
          <span className={label}>Where <span className="font-normal text-slate-500 dark:text-slate-400">(optional)</span></span>
          <input className="input w-full" maxLength={300} value={location} onChange={e => setLocation(e.target.value)} />
        </label>

        <label className="block">
          <span className={label}>When it's done, log it as</span>
          <select className="input w-full" value={kind} onChange={e => setKind(e.target.value)}>
            <option value="">The usual kind (a visit)</option>
            {noteTypes.map(nt => <option key={nt.key} value={nt.key}>{nt.label}</option>)}
          </select>
        </label>

        {!a && (
          <fieldset className="space-y-2">
            <legend className={label}>Repeats</legend>
            <div className="flex flex-wrap items-center gap-2">
              <select className="input w-auto" aria-label="Repeats" value={repeat} onChange={e => setRepeat(e.target.value as Repeat)}>
                <option value="none">Doesn't repeat</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
              {repeat !== 'none' && (
                <label className="flex items-center gap-2 text-base text-slate-700 dark:text-slate-200">
                  every
                  <input type="number" min={1} max={12} className="input w-20" aria-label="Every how many" value={every} onChange={e => setEvery(e.target.value)} />
                  {repeat === 'daily' ? 'days' : repeat === 'weekly' ? 'weeks' : 'months'}
                </label>
              )}
            </div>
            {repeat === 'weekly' && (
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="On">
                {DAYS.map((d, i) => (
                  <button key={d} type="button" aria-pressed={byDay.includes(i)} onClick={() => setByDay(b => b.includes(i) ? b.filter(x => x !== i) : [...b, i])}
                    className={`hit-44 w-14 py-1.5 rounded-lg border text-base ${byDay.includes(i) ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200'}`}>
                    {d}
                  </button>
                ))}
              </div>
            )}
            {repeat !== 'none' && (
              <div className="flex flex-wrap items-center gap-2">
                <select className="input w-auto" aria-label="Ends" value={ends} onChange={e => setEnds(e.target.value as Ends)}>
                  <option value="never">No end date</option>
                  <option value="date">Ends on</option>
                  <option value="count">Ends after</option>
                  {dateColumns.length > 0 && <option value="column">Ends on the date in</option>}
                </select>
                {ends === 'date' && <input type="date" className="input w-auto" aria-label="End date" value={until} min={date} onChange={e => setUntil(e.target.value)} />}
                {ends === 'count' && <label className="flex items-center gap-2 text-base text-slate-700 dark:text-slate-200"><input type="number" min={1} max={500} className="input w-24" aria-label="How many times" value={count} onChange={e => setCount(e.target.value)} />times</label>}
                {ends === 'column' && (
                  <select className="input w-auto" aria-label="End date column" value={untilCol ?? ''} onChange={e => setUntilCol(Number(e.target.value) || null)}>
                    <option value="">Choose…</option>
                    {dateColumns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                )}
              </div>
            )}
          </fieldset>
        )}

        <label className="block">
          <span className={label}>Notes <span className="font-normal text-slate-500 dark:text-slate-400">(optional)</span></span>
          <textarea className="input w-full" rows={2} maxLength={5000} value={notes} onChange={e => setNotes(e.target.value)} />
        </label>

        {error && <p role="alert" className="text-base text-red-700 dark:text-red-400">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={saving || !title.trim() || !date} onClick={() => void save()}>{a ? 'Save' : 'Schedule'}</button>
        </div>
      </div>
      {askScope && <ScopeDialog verb="Change" onChoose={scope => void save(scope, askScope)} onCancel={() => setAskScope(null)}
        dateChanged={!!a && askScope.start_at.slice(0, 10) !== a.start_at.slice(0, 10)} />}
    </div>
  )
}
