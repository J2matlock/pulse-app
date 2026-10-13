/**
 * The calendar (W07 §6): month and agenda views of appointments, deadlines,
 * follow-ups and tasks, with layers you can turn on and off. Built in-house
 * (CSS grid and date math), no calendar library.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { IPC } from '../../shared/ipc-channels'
import type { Appointment } from '../../shared/appointments'
import type { DeadlineState } from '../../shared/deadlineEngine'
import { addDays, addMonths } from '../../shared/appointments'
import { CALENDAR_LAYERS, formatTime, longDay, monthGrid, monthTitle, sameMonth, startOfWeek, type CalendarItem, type CalendarLayer } from '../../shared/calendar'
import { useToday } from '../hooks/useToday'
import { safeInvoke } from '../utils/safeInvoke'
import { useSettingsStore } from '../stores/settingsStore'
import { useFeature } from '../hooks/useFeature'
import { useVocab } from '../hooks/useVocab'
import { AppointmentPanel } from '../components/calendar/AppointmentPanel'
import { AppointmentDialog } from '../components/calendar/AppointmentDialog'
import { TimeGrid } from '../components/calendar/TimeGrid'
import { ScopeDialog } from '../components/calendar/ScopeDialog'
import { updateAppointment } from '../utils/appointmentActions'
import { useGridStore } from '../stores/gridStore'
import { useShallow } from 'zustand/react/shallow'
import { CalendarExportDialog } from '../components/reports/CalendarExportDialog'
import { DeadlineColumnsMenu } from '../components/calendar/DeadlineColumnsMenu'
import { readHiddenDeadlineColumns, saveHiddenDeadlineColumns } from '../utils/calendarDeadlineColumns'

export type CalendarMode = 'month' | 'week' | 'day' | 'agenda'
const MODES: readonly CalendarMode[] = ['month', 'week', 'day', 'agenda']
const MODE_LABELS: Record<CalendarMode, string> = { month: 'Month', week: 'Week', day: 'Day', agenda: 'Agenda' }
const AGENDA_DAYS = 31
const MAX_IN_CELL = 3

const LAYER_LABELS: Record<CalendarLayer, string> = { appointments: '{Appointment:many}', deadlines: 'Deadlines', followups: 'Follow-ups', tasks: 'Tasks' }
const OK_CLASS = 'bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-100 border-green-300 dark:border-green-700'
const STATE_CLASS: Record<DeadlineState, string> = {
  overdue: 'bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100 border-red-300 dark:border-red-700',
  due: 'bg-orange-100 text-orange-900 dark:bg-orange-900/40 dark:text-orange-100 border-orange-300 dark:border-orange-700',
  soon: 'bg-yellow-100 text-yellow-900 dark:bg-yellow-900/40 dark:text-yellow-100 border-yellow-300 dark:border-yellow-700',
  ok: OK_CLASS,
  // Not shown on the calendar today; listed so a new state has to pick a colour
  none: OK_CLASS, paused: OK_CLASS, done: OK_CLASS,
}
const APPT_CLASS: Record<Appointment['status'], string> = {
  scheduled: 'bg-blue-100 text-blue-900 dark:bg-blue-900/50 dark:text-blue-100 border-blue-300 dark:border-blue-700',
  // Done shows a check; only what didn't happen is struck through (audit S-28)
  done: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-600',
  no_show: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-600 line-through',
  cancelled: 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400 border-slate-300 dark:border-slate-600 line-through',
}

export type CalEvent =
  | { type: 'appointment'; date: string; sortKey: string; appt: Appointment }
  | { type: 'item'; date: string; sortKey: string; item: CalendarItem }

/** Everything on the calendar for a range, by day, appointments first in time order */
export function eventsByDay(appts: Appointment[], items: CalendarItem[], layers: Set<CalendarLayer>): Map<string, CalEvent[]> {
  const out = new Map<string, CalEvent[]>()
  const add = (e: CalEvent) => out.set(e.date, [...(out.get(e.date) ?? []), e])
  if (layers.has('appointments')) for (const a of appts) add({ type: 'appointment', date: a.start_at.slice(0, 10), sortKey: `0${a.all_day ? '00:00' : a.start_at.slice(11, 16)}`, appt: a })
  const layerOf: Record<CalendarItem['kind'], CalendarLayer> = { deadline: 'deadlines', followup: 'followups', task: 'tasks' }
  for (const i of items) if (layers.has(layerOf[i.kind])) add({ type: 'item', date: i.date, sortKey: `1${i.kind}${i.title}`, item: i })
  for (const list of out.values()) list.sort((a, b) => a.sortKey.localeCompare(b.sortKey))
  return out
}

/** Words for one event, for its label and screen readers */
export function eventText(e: CalEvent, clock: '12h' | '24h'): { short: string; full: string } {
  if (e.type === 'appointment') {
    const a = e.appt
    const time = a.all_day ? 'All day' : `${formatTime(a.start_at, clock)}${a.end_at ? ` to ${formatTime(a.end_at, clock)}` : ''}`
    const who = a.record_name ? ` with ${a.record_name}` : ''
    const status = a.status === 'scheduled' ? 'scheduled' : a.status === 'no_show' ? 'no-show' : a.status
    return { short: `${a.status === 'done' ? '✓ ' : ''}${a.all_day ? '' : `${formatTime(a.start_at, clock)} `}${a.title}${who}`, full: `${longDay(a.start_at)}, ${time}, ${a.title}${who}, ${status}` }
  }
  const i = e.item
  // A follow-up shows the first words of its note
  const label = i.kind === 'deadline' ? `${i.recordName}: ${i.title}` : i.kind === 'followup' ? `${i.recordName}: follow up${i.title && i.title !== 'Follow-up' ? ` – ${i.title}` : ''}` : `Task: ${i.title}`
  return { short: label, full: `${longDay(i.date)}, ${label}${i.kind === 'deadline' && i.state === 'overdue' ? ', overdue' : ''}` }
}

function readLayers(raw: string | null | undefined): Set<CalendarLayer> {
  try {
    const v = raw ? JSON.parse(raw) as unknown : null
    if (Array.isArray(v)) return new Set(v.filter((x): x is CalendarLayer => CALENDAR_LAYERS.includes(x as CalendarLayer)))
  } catch { /* defaults */ }
  return new Set(CALENDAR_LAYERS)
}

export default function CalendarView(): React.ReactElement {
  const navigate = useNavigate()
  const apptsOn = useFeature('appointments')
  const tasksOn = useFeature('tasks')
  const weekStart = useSettingsStore(s => s.weekStart)
  const clock = useSettingsStore(s => s.clockFormat)
  const { t, f } = useVocab(null)
  // Moves on at midnight, so the today marker does too
  const today = useToday()
  const [mode, setMode] = useState<CalendarMode>(apptsOn ? 'week' : 'month')
  const [pendingDrop, setPendingDrop] = useState<{ appt: Appointment; times: { start_at: string; end_at: string | null } } | null>(null)
  const [anchor, setAnchor] = useState(today)
  const [focusDay, setFocusDay] = useState(today)
  const [layers, setLayers] = useState<Set<CalendarLayer>>(new Set(CALENDAR_LAYERS))
  const [appts, setAppts] = useState<Appointment[]>([])
  const [items, setItems] = useState<CalendarItem[]>([])
  const [selected, setSelected] = useState<Appointment | null>(null)
  const [newAt, setNewAt] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  // Deadline columns turned off here (main leaves them out of calendar:items)
  const [hiddenCols, setHiddenCols] = useState<Set<number>>(new Set())
  // One list, or all of them (audit S-32), remembered like the layers
  const grids = useGridStore(useShallow(s => s.grids))
  const [listId, setListId] = useState<number | null>(null)
  const shownList = listId != null && grids.some(g => g.id === listId) ? listId : null
  const gridRef = useRef<HTMLDivElement>(null)

  // An appointment reminder was clicked (W11): open on that day
  const [params] = useSearchParams()
  const openDate = params.get('date')
  const datedOpen = openDate !== null && /^\d{4}-\d{2}-\d{2}$/.test(openDate)
  useEffect(() => {
    if (!datedOpen) return
    setAnchor(openDate); setFocusDay(openDate); setMode('day')
  }, [datedOpen, openDate])

  useEffect(() => {
    void safeInvoke<string | null>(IPC.SETTINGS_GET, 'calendar_layers').then(r => { if (r.ok && r.data) setLayers(readLayers(r.data)) })
    void readHiddenDeadlineColumns().then(setHiddenCols)
    void safeInvoke<string | null>(IPC.SETTINGS_GET, 'calendar_list').then(r => { if (r.ok && r.data && Number(r.data) > 0) setListId(Number(r.data)) })
    if (!datedOpen) void safeInvoke<string | null>(IPC.SETTINGS_GET, 'calendar_mode').then(r => { if (r.ok && MODES.includes(r.data as CalendarMode)) setMode(r.data as CalendarMode) })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- once on open; a dated open keeps the day view

  const weeks = useMemo(() => monthGrid(anchor, weekStart), [anchor, weekStart])
  // A month shows only the weeks it needs (often five), so the last row isn't cut off
  const monthWeeks = useMemo(() => weeks.filter(w => w.some(d => sameMonth(d, anchor))), [weeks, anchor])
  const weekFrom = startOfWeek(anchor, weekStart)
  const range = mode === 'month' ? { from: weeks[0]![0]!, to: weeks[5]![6]! }
    : mode === 'week' ? { from: weekFrom, to: addDays(weekFrom, 6) }
    : mode === 'day' ? { from: anchor, to: anchor }
    : { from: anchor, to: addDays(anchor, AGENDA_DAYS - 1) }

  const load = useCallback(async () => {
    const [a, i] = await Promise.all([
      apptsOn ? safeInvoke<Appointment[]>(IPC.APPT_LIST, range, shownList != null ? { gridId: shownList } : undefined) : Promise.resolve({ ok: true as const, data: [] as Appointment[] }),
      safeInvoke<CalendarItem[]>(IPC.CALENDAR_ITEMS, range.from, range.to, shownList ?? undefined),
    ])
    if (a.ok) setAppts(a.data)
    if (i.ok) setItems(i.data)
  }, [range.from, range.to, apptsOn, shownList]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const off1 = window.api.on(IPC.APPOINTMENTS_CHANGED, () => { void load() })
    const off2 = window.api.on(IPC.CASE_LOG_CHANGED, () => { void load() })
    return () => { off1(); off2() }
  }, [load])

  // The open panel shows the appointment as it is now
  useEffect(() => { if (selected) setSelected(appts.find(a => a.id === selected.id) ?? null) }, [appts]) // eslint-disable-line react-hooks/exhaustive-deps

  const offered = CALENDAR_LAYERS.filter(l => (l !== 'appointments' || apptsOn) && (l !== 'tasks' || tasksOn))
  // A switched-off feature's layer stays off even when it was saved as on
  const shownLayers = useMemo(() => new Set([...layers].filter(l => (l !== 'appointments' || apptsOn) && (l !== 'tasks' || tasksOn))), [layers, apptsOn, tasksOn])
  const byDay = useMemo(() => eventsByDay(appts, items, shownLayers), [appts, items, shownLayers])

  function toggleLayer(l: CalendarLayer) {
    const next = new Set(layers)
    if (next.has(l)) next.delete(l); else next.add(l)
    setLayers(next)
    void safeInvoke(IPC.SETTINGS_UPDATE, 'calendar_layers', JSON.stringify([...next]))
  }
  async function chooseDeadlineColumns(next: Set<number>) {
    const before = hiddenCols
    setHiddenCols(next)
    if (await saveHiddenDeadlineColumns(next)) void load()
    else setHiddenCols(before)
  }
  function chooseList(id: number | null) {
    setListId(id)
    void safeInvoke(IPC.SETTINGS_UPDATE, 'calendar_list', id == null ? '' : String(id))
  }
  function switchMode(m: CalendarMode) {
    setMode(m)
    void safeInvoke(IPC.SETTINGS_UPDATE, 'calendar_mode', m)
  }
  function step(by: -1 | 1) {
    const next = mode === 'month' ? addMonths(anchor.slice(0, 8) + '01', by) : addDays(anchor, by * (mode === 'week' ? 7 : mode === 'day' ? 1 : AGENDA_DAYS))
    setAnchor(next); setFocusDay(next)
  }
  function openDay(d: string) { setAnchor(d); setFocusDay(d); switchMode('day') }
  function dropped(a: Appointment, times: { start_at: string; end_at: string | null }) {
    if (a.series_id !== null) setPendingDrop({ appt: a, times })
    else void updateAppointment(a, times, 'one')
  }
  function openEvent(e: CalEvent) {
    if (e.type === 'appointment') { setSelected(e.appt); return }
    if (e.item.kind === 'task') navigate(e.item.taskId ? `/tasks?task=${e.item.taskId}` : '/tasks')
    else if (e.item.rowId) navigate(`/profile/${e.item.rowId}?gridId=${e.item.gridId}`)
  }

  // Keyboard (W07 §6): arrows move the day, Enter opens it, N new, T today, M/A switch views
  function onKeyDown(e: React.KeyboardEvent) {
    const target = e.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || e.ctrlKey || e.metaKey || e.altKey) return
    const k = e.key.toLowerCase()
    if (k === 't') { setAnchor(today); setFocusDay(today); e.preventDefault() }
    else if (k === 'n' && apptsOn) { setNewAt(`${focusDay}T09:00`); e.preventDefault() }
    else if (k === 'm') switchMode('month')
    else if (k === 'w') switchMode('week')
    else if (k === 'd') switchMode('day')
    else if (k === 'a') switchMode('agenda')
    else if (mode === 'month' && target.dataset.day) {
      const moves: Record<string, number> = { arrowleft: -1, arrowright: 1, arrowup: -7, arrowdown: 7 }
      if (k in moves) {
        e.preventDefault()
        const next = addDays(focusDay, moves[k]!)
        setFocusDay(next)
        if (!sameMonth(next, anchor)) setAnchor(next)
        setTimeout(() => gridRef.current?.querySelector<HTMLElement>(`[data-day="${next}"]`)?.focus(), 0)
      } else if (k === 'enter') { e.preventDefault(); openDay(focusDay) }
    }
  }

  const eventButton = (e: CalEvent, compact: boolean) => {
    const text = eventText(e, clock)
    const cls = e.type === 'appointment' ? APPT_CLASS[e.appt.status] : e.item.kind === 'deadline' ? STATE_CLASS[e.item.state ?? 'ok'] ?? STATE_CLASS.ok : 'bg-purple-100 text-purple-900 dark:bg-purple-900/40 dark:text-purple-100 border-purple-300 dark:border-purple-700'
    return (
      <button key={e.type === 'appointment' ? `a${e.appt.id}` : e.item.key} type="button" aria-label={text.full} title={text.full}
        onClick={ev => { ev.stopPropagation(); openEvent(e) }}
        className={`w-full text-left rounded-md border px-1.5 ${compact ? 'py-0.5 truncate' : 'py-2'} text-[15px] focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 ${cls}`}
        style={compact ? undefined : { minHeight: 44 }}>
        {text.short}
      </button>
    )
  }

  const dayNames = weeks[0]!.map(d => new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(new Date(`${d}T12:00`)))

  return (
    <div className="h-full flex bg-white dark:bg-slate-900" onKeyDown={onKeyDown}>
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-700">
          <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2 mr-2">
            <CalendarDays className="w-5 h-5" aria-hidden="true" />{mode === 'month' ? monthTitle(anchor) : mode === 'week' ? `Week of ${longDay(weekFrom)}` : mode === 'day' ? longDay(anchor) : `From ${longDay(anchor)}`}
          </h1>
          <button type="button" aria-label={mode === 'month' ? 'Previous month' : mode === 'week' ? 'Previous week' : mode === 'day' ? 'Previous day' : 'Earlier'} onClick={() => step(-1)} className="btn-compact-secondary"><ChevronLeft className="w-4 h-4" /></button>
          <button type="button" onClick={() => { setAnchor(today); setFocusDay(today) }} className="btn-compact-secondary">Today</button>
          <button type="button" aria-label={mode === 'month' ? 'Next month' : mode === 'week' ? 'Next week' : mode === 'day' ? 'Next day' : 'Later'} onClick={() => step(1)} className="btn-compact-secondary"><ChevronRight className="w-4 h-4" /></button>
          <div role="group" aria-label="View" className="flex rounded-lg border border-slate-300 dark:border-slate-600 overflow-hidden">
            {MODES.map(m => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => switchMode(m)}
                className={`hit-44 px-3 text-base ${mode === m ? 'bg-blue-600 text-white font-medium' : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200'}`} style={{ minHeight: 36 }}>
                {MODE_LABELS[m]}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 ml-auto">
            {/* Outlook or Google Calendar (audit S-30) */}
            <button type="button" className="btn-compact-secondary" onClick={() => setExporting(true)}><CalendarPlus className="w-4 h-4" aria-hidden="true" />Add to my calendar…</button>
            {apptsOn && (
              <button type="button" className="btn-compact-primary" onClick={() => setNewAt(`${focusDay}T09:00`)}><Plus className="w-4 h-4" />New {t('appointment')}</button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 w-full">
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-labelledby="calendar-show-label">
              <span id="calendar-show-label" className="text-base text-slate-600 dark:text-slate-300">Show:</span>
              {offered.map(l => (
                <React.Fragment key={l}>
                  <button type="button" aria-pressed={layers.has(l)} onClick={() => toggleLayer(l)}
                    className={`hit-44 px-3 rounded-full border text-sm ${layers.has(l) ? 'bg-slate-800 text-white border-slate-800 dark:bg-slate-100 dark:text-slate-900' : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300'}`} style={{ minHeight: 32 }}>
                    {f(LAYER_LABELS[l])}
                  </button>
                  {l === 'deadlines' && layers.has('deadlines') && <DeadlineColumnsMenu hidden={hiddenCols} onChange={next => void chooseDeadlineColumns(next)} />}
                </React.Fragment>
              ))}
            </div>
            {grids.length > 1 && (
              <label className="flex items-center gap-1.5 text-base text-slate-600 dark:text-slate-300">
                {t('list', { cap: true })}:
                <select className="input" style={{ minHeight: 36 }} value={shownList ?? ''} onChange={e => chooseList(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">All</option>
                  {grids.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </label>
            )}
          </div>
        </div>

        {mode === 'week' || mode === 'day' ? (
          <TimeGrid days={mode === 'week' ? Array.from({ length: 7 }, (_, i) => addDays(weekFrom, i)) : [anchor]} clock={clock}
            appointments={layers.has('appointments') ? appts.filter(a => !a.all_day) : []}
            allDay={d => (byDay.get(d) ?? []).filter(e => e.type === 'item' || e.appt.all_day).map(e => eventButton(e, true))}
            label={a => eventText({ type: 'appointment', date: a.start_at.slice(0, 10), sortKey: '', appt: a }, clock)}
            colorOf={a => APPT_CLASS[a.status]}
            onOpen={setSelected}
            onNew={startAt => apptsOn && setNewAt(startAt)}
            onDrop={dropped} />
        ) : mode === 'month' ? (
          <div ref={gridRef} role="grid" aria-label={monthTitle(anchor)} className="flex-1 grid overflow-auto"
            style={{ gridTemplateRows: `auto repeat(${monthWeeks.length}, minmax(6.5rem, 1fr))` }}>
            <div role="row" className="grid grid-cols-7 border-b-2 border-slate-300 dark:border-slate-600">
              {dayNames.map(n => <div key={n} role="columnheader" className="px-2 py-1 text-sm font-semibold text-slate-600 dark:text-slate-300">{n}</div>)}
            </div>
            {monthWeeks.map(week => (
              <div key={week[0]} role="row" className="grid grid-cols-7 min-h-[6.5rem]">
                {week.map(d => {
                  const events = byDay.get(d) ?? []
                  const extra = events.length - MAX_IN_CELL
                  return (
                    <div key={d} role="gridcell" tabIndex={d === focusDay ? 0 : -1} data-day={d} aria-label={`${longDay(d)}, ${events.length ? `${events.length} item${events.length === 1 ? '' : 's'}` : 'nothing'}`}
                      onFocus={() => setFocusDay(d)}
                      onDoubleClick={() => apptsOn && setNewAt(`${d}T09:00`)}
                      className={`border-r border-b border-slate-300 dark:border-slate-600 p-1 space-y-1 overflow-hidden focus:outline-hidden focus:ring-3 focus:ring-inset focus:ring-blue-500 ${sameMonth(d, anchor) ? '' : 'bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400'}`}>
                      <button type="button" tabIndex={-1} onClick={() => openDay(d)} aria-label={`Open ${longDay(d)}`}
                        className={`text-sm font-medium w-7 h-7 rounded-full ${d === today ? 'bg-blue-600 text-white' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'}`}>
                        {Number(d.slice(8))}
                      </button>
                      {events.slice(0, extra > 0 ? MAX_IN_CELL - 1 : MAX_IN_CELL).map(e => eventButton(e, true))}
                      {extra > 0 && (
                        <button type="button" onClick={() => openDay(d)} className="w-full text-left text-sm text-blue-700 dark:text-blue-300 hover:underline px-1.5">
                          +{extra + 1} more
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-4 py-3">
            {Array.from({ length: AGENDA_DAYS }, (_, i) => addDays(anchor, i)).filter(d => byDay.has(d)).map(d => (
              <section key={d} aria-label={longDay(d)} className="mb-4">
                <h2 className={`text-base font-semibold mb-1 ${d === today ? 'text-blue-700 dark:text-blue-300' : 'text-slate-700 dark:text-slate-200'}`}>{longDay(d)}{d === today ? ' (today)' : ''}</h2>
                <div className="space-y-1.5 max-w-2xl">{byDay.get(d)!.map(e => eventButton(e, false))}</div>
              </section>
            ))}
            {![...byDay.keys()].some(d => d >= anchor && d <= range.to) && <p className="text-base text-slate-500 dark:text-slate-400">Nothing in the next {AGENDA_DAYS} days.</p>}
          </div>
        )}
      </div>
      {selected && <AppointmentPanel appointment={selected} onClose={() => setSelected(null)} />}
      {newAt && <AppointmentDialog start={newAt} onClose={() => setNewAt(null)} />}
      {exporting && <CalendarExportDialog onClose={() => setExporting(false)} />}
      {pendingDrop && (
        <ScopeDialog verb="Change" onCancel={() => setPendingDrop(null)} dateChanged={pendingDrop.times.start_at.slice(0, 10) !== pendingDrop.appt.start_at.slice(0, 10)}
          onChoose={scope => { const p = pendingDrop; setPendingDrop(null); void updateAppointment(p.appt, p.times, scope) }} />
      )}
    </div>
  )
}
