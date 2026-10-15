/**
 * New or edit appointment (W07 §6): who it's with, when, where, what kind
 * of note it becomes when done, and (for new ones) how it repeats.
 */
import React, { useEffect, useRef, useState } from 'react'
import { CalendarClock, Trash2 } from 'lucide-react'
import { IPC } from '../../../shared/ipc-channels'
import type { Column } from '../../../shared/types'
import { apptInputSchema, addMinutes, minutesBetween, seriesRuleSchema, type Appointment, type ApptInput, type SeriesRule } from '../../../shared/appointments'
import { safeInvoke } from '../../utils/safeInvoke'
import { createAppointment, deleteAppointment, updateAppointment } from '../../utils/appointmentActions'
import { Dialog } from '../ui/Dialog'
import { PrimaryButton, SecondaryButton } from '../ui/Button'
import { useVocab } from '../../hooks/useVocab'
import { useActivityTypes } from '../../hooks/useActivityTypes'
import { useFeature } from '../../hooks/useFeature'
import { ScopeDialog } from './ScopeDialog'
import { RecordSearchField } from './RecordSearchField'
import { useClosedByLock, useLockSafeDraft, type DraftUpdate } from '../../hooks/useLockSafeDraft'
import { setOpenAfterUnlock } from '../../utils/formDrafts'

const label = 'block text-base font-semibold text-slate-800 dark:text-slate-100 mb-1'
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

type Repeat = 'none' | 'daily' | 'weekly' | 'monthly'
type Ends = 'never' | 'date' | 'count' | 'column'

/** A repeating appointment's stored rule */
function ruleOf(a: Appointment | undefined): SeriesRule | null {
  if (!a || a.series_id === null || !a.series_rule) return null
  try { const r = seriesRuleSchema.safeParse(JSON.parse(a.series_rule)); return r.success ? r.data : null } catch { return null }
}

/** Two rules that make the same dates compare equal */
function ruleKey(r: SeriesRule | null): string {
  if (!r) return ''
  return JSON.stringify([r.freq, r.interval, r.freq === 'weekly' ? [...(r.byDay ?? [])].sort() : [], r.until ?? null, r.count ?? null, r.untilColumnId ?? null])
}

interface ApptFields {
  title: string
  who: { rowId: number; gridId: number; name: string } | null
  date: string
  allDay: boolean
  time: string
  duration: string
  location: string
  kind: string
  notes: string
  repeat: Repeat
  every: string
  byDay: number[]
  ends: Ends
  until: string
  count: string
  untilCol: number | null
}

export interface AppointmentDialogProps {
  /** Editing this one; otherwise a new appointment */
  appointment?: Appointment
  /** New: the day (and time) to start from */
  start?: string
  /** New: who it's with */
  record?: { rowId: number; gridId: number; name: string }
  /**
   * New: an event, a plain calendar entry with no record (it shows in the
   * Calendar's Events layer). Editing one with no record is an event too.
   */
  event?: boolean
  /** Opened again after a lock closed it: says the details were kept */
  restored?: boolean
  onClose: () => void
}

export function AppointmentDialog({ appointment, start, record, event = false, restored = false, onClose }: AppointmentDialogProps): React.ReactElement {
  const { t } = useVocab(null)
  const { active: noteTypes } = useActivityTypes()
  const a = appointment
  const apptsOn = useFeature('appointments')
  const isEvent = a ? a.row_id === null : event
  const startAt = a?.start_at ?? start ?? ''
  // Every field in one draft, so a lock doesn't throw the form away (R2): it opens again on unlock
  const initialRule = ruleOf(a)
  const draftKey = a ? `appointment:edit:${a.id}` : `appointment:new:${record?.rowId ?? 'none'}:${startAt}${event ? ':event' : ''}`
  const [fields, setFields] = useLockSafeDraft<ApptFields>(draftKey, () => ({
    title: a?.title ?? '',
    who: a?.row_id ? { rowId: a.row_id, gridId: a.grid_id ?? 0, name: a.record_name ?? '' } : record ?? null,
    date: startAt.slice(0, 10),
    allDay: a ? !!a.all_day : false,
    time: startAt.length > 10 ? startAt.slice(11, 16) : '09:00',
    duration: a?.end_at && a.start_at.length > 10 ? String(minutesBetween(a.start_at, a.end_at)) : '60',
    location: a?.location ?? '',
    kind: a?.activity_type_key ?? '',
    notes: a?.notes ?? '',
    // Editing a repeating one shows its pattern, which can be changed from this one on (audit S-18)
    repeat: initialRule?.freq ?? 'none',
    every: String(initialRule?.interval ?? 1),
    byDay: initialRule?.byDay ?? [],
    ends: initialRule?.count ? 'count' : initialRule?.until ? 'date' : initialRule?.untilColumnId ? 'column' : 'never',
    until: initialRule?.until ?? '',
    count: String(initialRule?.count ?? 10),
    untilCol: initialRule?.untilColumnId ?? null,
  }))
  const { title, who, date, allDay, time, duration, location, kind, notes, repeat, every, byDay, ends, until, count, untilCol } = fields
  const setter = <K extends keyof ApptFields>(k: K) => (v: DraftUpdate<ApptFields[K]>) =>
    setFields(f => ({ ...f, [k]: v instanceof Function ? v(f[k]) : v }))
  const setTitle = setter('title')
  const setWho = setter('who')
  const setDate = setter('date')
  const setAllDay = setter('allDay')
  const setTime = setter('time')
  const setDuration = setter('duration')
  const setLocation = setter('location')
  const setKind = setter('kind')
  const setNotes = setter('notes')
  const setRepeat = setter('repeat')
  const setEvery = setter('every')
  const setByDay = setter('byDay')
  const setEnds = setter('ends')
  const setUntil = setter('until')
  const setCount = setter('count')
  const setUntilCol = setter('untilCol')
  // Closed by the lock: its host opens it again, as it was, on unlock
  const reopenRef = useRef({ appointment, start, record, event })
  reopenRef.current = { appointment, start, record, event }
  const closedByLock = useClosedByLock()
  useEffect(() => () => {
    if (closedByLock()) setOpenAfterUnlock({ key: draftKey, props: reopenRef.current })
  }, [draftKey, closedByLock])
  const [dateColumns, setDateColumns] = useState<Column[]>([])
  const [error, setError] = useState<string | null>(null)
  // The date/time boxes point at the error when it's about them (audit A06-14)
  const [whenError, setWhenError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [askScope, setAskScope] = useState<ApptInput | null>(null)
  const [askDelete, setAskDelete] = useState(false)
  // An event with someone chosen becomes an appointment, and says so
  const asEvent = isEvent && !who
  const noun = asEvent ? 'event' : t('appointment')

  // "Until the date in a column": the record's own date columns
  useEffect(() => {
    if (!who?.gridId) { setDateColumns([]); return }
    void safeInvoke<{ columns: Column[] } | null>(IPC.GRID_GET, who.gridId, false).then(r => setDateColumns(r.ok && r.data ? (r.data.columns ?? []).filter(c => c.column_type === 'date') : []))
  }, [who?.gridId])

  const whenErrorProps = whenError && error ? { 'aria-invalid': true, 'aria-describedby': 'appt-dialog-error' } as const : {}

  function build(): ApptInput | null {
    const mins = Math.max(0, parseInt(duration, 10) || 0)
    const s = allDay ? date : `${date}T${time}`
    const input: ApptInput = {
      row_id: who?.rowId ?? null, title: title.trim(), start_at: s,
      end_at: allDay ? null : mins > 0 ? addMinutes(s, mins) : null, all_day: allDay,
      location: location || null, activity_type_key: kind || null, notes: notes || null,
    }
    const check = apptInputSchema.safeParse(input)
    if (!check.success) { setError(check.error.issues[0]?.message ?? 'Some details are missing.'); setWhenError(true); return null }
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

  async function remove(scope: 'one' | 'following' | 'all') {
    if (!a) return
    setAskDelete(false)
    if (await deleteAppointment(a, scope)) onClose()
  }

  async function save(scope?: 'one' | 'following' | 'all', prepared?: ApptInput) {
    setError(null)
    setWhenError(false)
    const input = prepared ?? build()
    if (!input) return
    // A changed pattern applies from this one on, so there's nothing to ask
    const newRule = a && initialRule ? rule() : null
    const ruleChanged = !!newRule && ruleKey(newRule) !== ruleKey(initialRule)
    if (a && a.series_id !== null && !scope && !ruleChanged) { setAskScope(input); return }
    setSaving(true)
    try {
      const ok = a
        ? ruleChanged ? await updateAppointment(a, input, 'following', newRule) : await updateAppointment(a, input, scope ?? 'one')
        : (await createAppointment(input, rule())) !== null
      if (ok) onClose()
    } finally { setSaving(false); setAskScope(null) }
  }

  return (
    <>
    <Dialog open onClose={onClose} size="lg" title={a ? `Edit ${noun}` : `New ${noun}`}
      description={restored ? `We kept the ${noun} you were ${a ? 'changing' : 'adding'}.` : undefined}
      icon={<CalendarClock className="w-5 h-5 mt-3 text-slate-700 dark:text-slate-200" aria-hidden="true" />}
      footer={<>
        {/* Events open straight into this dialog, so it's where they're deleted */}
        {a && isEvent && (
          <SecondaryButton className="mr-auto" icon={<Trash2 className="w-4 h-4" />} onClick={() => (a.series_id !== null ? setAskDelete(true) : void remove('one'))}>
            Delete
          </SecondaryButton>
        )}
        <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
        <PrimaryButton disabled={saving || !title.trim() || !date} onClick={() => void save()}>{a ? 'Save' : asEvent ? 'Add event' : 'Schedule'}</PrimaryButton>
      </>}>
      <div className="space-y-4">
        <label className="block">
          <span className={label}>What</span>
          <input className="input w-full" autoFocus maxLength={200} value={title} onChange={e => setTitle(e.target.value)} placeholder={isEvent ? 'e.g. Staff meeting, Training, Day off' : 'e.g. Session, Drop-off, Home visit'} />
        </label>

        {/* An event can be about someone (then it's an appointment), but only while appointments are switched on; the field says so (UX D-13) */}
        {(!isEvent || apptsOn || who) && <div>
          <span className={label}>With{isEvent && <span className="font-normal text-slate-500 dark:text-slate-400"> (optional — usually nobody; with {t('record', { article: true })} it becomes {t('appointment', { article: true })})</span>}</span>
          <RecordSearchField value={who} onChange={setWho} placeholder={isEvent ? 'Leave empty for a plain event' : `Search ${t('record', { many: true })}, or leave empty`} />
        </div>}

        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className={label}>Date</span>
            <input type="date" className="input w-auto" value={date} onChange={e => setDate(e.target.value)} {...whenErrorProps} />
          </label>
          {!allDay && (
            <>
              <label className="block">
                <span className={label}>Time</span>
                <input type="time" className="input w-auto" value={time} onChange={e => setTime(e.target.value)} {...whenErrorProps} />
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

        {/* Only a record gets a note when it's done; said in her words, not "log it as" (UX D-13, C-24) */}
        {!asEvent && <label className="block">
          <span className={label}>When you mark it done, add {t('activity', { article: true })} of this kind</span>
          <select className="input w-full" value={kind} onChange={e => setKind(e.target.value)}>
            <option value="">{(noteTypes.find(nt => nt.key === 'visit') ?? noteTypes[0])?.label ?? 'A note'} (the usual)</option>
            {noteTypes.map(nt => <option key={nt.key} value={nt.key}>{nt.label}</option>)}
          </select>
        </label>}

        {(!a || initialRule) && (
          <fieldset className="space-y-2">
            <legend className={label}>Repeats</legend>
            {initialRule && <p className="text-base text-slate-600 dark:text-slate-300">Changing how it repeats applies from this one on.</p>}
            <div className="flex flex-wrap items-center gap-2">
              <select className="input w-auto" aria-label="Repeats" value={repeat} onChange={e => setRepeat(e.target.value as Repeat)}>
                {!initialRule && <option value="none">Doesn't repeat</option>}
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

        {error && <p id="appt-dialog-error" role="alert" className="text-base text-red-700 dark:text-red-400">{error}</p>}
      </div>
    </Dialog>
      {/* Beside the dialog, not inside it, so they cover the whole window on top of it */}
      {askDelete && <ScopeDialog verb="Delete" onChoose={scope => void remove(scope)} onCancel={() => setAskDelete(false)} />}
      {askScope && <ScopeDialog verb="Change" onChoose={scope => void save(scope, askScope)} onCancel={() => setAskScope(null)}
        dateChanged={!!a && askScope.start_at.slice(0, 10) !== a.start_at.slice(0, 10)} />}
    </>
  )
}
