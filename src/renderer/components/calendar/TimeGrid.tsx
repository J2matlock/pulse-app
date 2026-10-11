/**
 * Week and day views (W07 §6): a column per day with hours down the side.
 * Click an empty slot for a new appointment; drag an appointment to move it,
 * or its bottom edge to change its length, snapping to 15 minutes. Events
 * are at least 44px tall so they're easy to hit.
 */
import React, { useEffect, useRef, useState } from 'react'
import type { Appointment } from '../../../shared/appointments'
import { addMinutes, minutesBetween } from '../../../shared/appointments'
import { longDay } from '../../../shared/calendar'
import { localDateString } from '../../../shared/dates'

export const HOUR_PX = 48
export const SNAP_MIN = 15
const MIN_EVENT_PX = 44
const DEFAULT_MINUTES = 60

const minutesOf = (wall: string) => {
  const [h, m] = wall.slice(11, 16).split(':').map(Number) as [number, number]
  return h * 60 + m
}

export const snap = (minutes: number) => Math.max(0, Math.min(24 * 60 - SNAP_MIN, Math.round(minutes / SNAP_MIN) * SNAP_MIN))

/** Side-by-side lanes for overlapping appointments in one day */
export function layoutDay(appts: Appointment[]): Array<{ appt: Appointment; lane: number; lanes: number }> {
  const timed = appts.filter(a => !a.all_day).sort((a, b) => a.start_at.localeCompare(b.start_at))
  const end = (a: Appointment) => minutesOf(a.start_at) + Math.max(a.end_at ? minutesBetween(a.start_at, a.end_at) : DEFAULT_MINUTES, MIN_EVENT_PX * 60 / HOUR_PX)
  const out: Array<{ appt: Appointment; lane: number; lanes: number }> = []
  let group: Array<{ appt: Appointment; lane: number; lanes: number }> = []
  let groupEnd = -1
  let laneEnds: number[] = []
  const close = () => { for (const g of group) g.lanes = laneEnds.length; out.push(...group); group = []; laneEnds = [] }
  for (const a of timed) {
    const s = minutesOf(a.start_at)
    if (group.length && s >= groupEnd) close()
    let lane = laneEnds.findIndex(e => e <= s)
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(0) }
    laneEnds[lane] = end(a)
    groupEnd = Math.max(groupEnd, end(a))
    group.push({ appt: a, lane, lanes: 0 })
  }
  close()
  return out
}

/** Where a drag lands: the new start and end, moved by days and snapped minutes */
export function dropTimes(a: Appointment, deltaDays: number, deltaMinutes: number, mode: 'move' | 'resize'): { start_at: string; end_at: string | null } {
  const length = a.end_at ? minutesBetween(a.start_at, a.end_at) : DEFAULT_MINUTES
  if (mode === 'resize') {
    const newLength = Math.max(SNAP_MIN, snap(length + deltaMinutes))
    return { start_at: a.start_at, end_at: addMinutes(a.start_at, newLength) }
  }
  const day = addMinutes(`${a.start_at.slice(0, 10)}T00:00`, deltaDays * 1440).slice(0, 10)
  const start = `${day}T00:00`
  const startAt = addMinutes(start, snap(minutesOf(a.start_at) + deltaMinutes))
  return { start_at: startAt, end_at: a.end_at ? addMinutes(startAt, length) : null }
}

interface Props {
  days: string[]
  appointments: Appointment[]
  /** Everything else for a day (all-day appointments, deadlines…), already made into buttons */
  allDay: (date: string) => React.ReactNode
  label: (a: Appointment) => { short: string; full: string }
  colorOf: (a: Appointment) => string
  onOpen: (a: Appointment) => void
  onNew: (startAt: string) => void
  onDrop: (a: Appointment, times: { start_at: string; end_at: string | null }) => void
  clock: '12h' | '24h'
}

export function TimeGrid({ days, appointments, allDay, label, colorOf, onOpen, onNew, onDrop, clock }: Props): React.ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null)
  const colsRef = useRef<HTMLDivElement>(null)
  const today = localDateString()
  type Drag = { appt: Appointment; mode: 'move' | 'resize'; x0: number; y0: number; dx: number; dy: number }
  const [drag, setDragState] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const setDrag = (v: Drag | null | ((d: Drag | null) => Drag | null)) => {
    setDragState(prev => {
      const next = typeof v === 'function' ? v(prev) : v
      if (typeof v !== 'function') dragRef.current = next
      return next
    })
  }

  // Start the day at 7:00 rather than midnight
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 7 * HOUR_PX }, [])

  useEffect(() => {
    if (!drag) return
    const move = (e: PointerEvent) => setDrag(d => {
      const next = d && { ...d, dx: e.clientX - d.x0, dy: e.clientY - d.y0 }
      dragRef.current = next
      return next
    })
    // Read from the ref, not a state updater, so the drop is saved exactly once
    const up = () => {
      const d = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (!d) return
      if (Math.abs(d.dx) > 4 || Math.abs(d.dy) > 4) {
        const colW = (colsRef.current?.getBoundingClientRect().width ?? 0) / days.length || 1
        const deltaDays = d.mode === 'move' ? Math.round(d.dx / colW) : 0
        const times = dropTimes(d.appt, deltaDays, (d.dy / HOUR_PX) * 60, d.mode)
        if (times.start_at !== d.appt.start_at || times.end_at !== d.appt.end_at) onDrop(d.appt, times)
      } else onOpen(d.appt)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
  }, [drag?.appt.id, drag?.mode]) // eslint-disable-line react-hooks/exhaustive-deps

  const byDay = new Map(days.map(d => [d, layoutDay(appointments.filter(a => a.start_at.slice(0, 10) === d))]))

  function slotClick(e: React.MouseEvent<HTMLDivElement>, day: string) {
    if (e.target !== e.currentTarget) return
    const rect = e.currentTarget.getBoundingClientRect()
    const minutes = snap(((e.clientY - rect.top) / HOUR_PX) * 60)
    onNew(addMinutes(`${day}T00:00`, minutes))
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Day headers and the all-day row */}
      <div className="flex border-b-2 border-slate-300 dark:border-slate-600">
        <div className="w-16 flex-shrink-0" />
        <div className="flex-1 grid" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
          {days.map(d => (
            <div key={d} className="border-l border-slate-300 dark:border-slate-600 px-1 pb-1">
              <div className={`text-sm font-semibold py-1 ${d === today ? 'text-blue-700 dark:text-blue-300' : 'text-slate-700 dark:text-slate-200'}`}>{longDay(d)}</div>
              <div className="space-y-1">{allDay(d)}</div>
            </div>
          ))}
        </div>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="flex relative" style={{ height: 24 * HOUR_PX }}>
          <div className="w-16 flex-shrink-0 relative" aria-hidden="true">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="absolute right-2 text-sm text-slate-500 dark:text-slate-400" style={{ top: h * HOUR_PX - 9 }}>
                {h === 0 ? '' : clock === '24h' ? `${String(h).padStart(2, '0')}:00` : `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'am' : 'pm'}`}
              </div>
            ))}
          </div>
          <div ref={colsRef} className="flex-1 grid relative" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
            {days.map((d, di) => (
              <div key={d} role="group" aria-label={longDay(d)} onClick={e => slotClick(e, d)}
                className="relative border-l border-slate-300 dark:border-slate-600 cursor-cell"
                style={{ backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR_PX - 1}px, rgb(203 213 225 / 0.7) ${HOUR_PX - 1}px, rgb(203 213 225 / 0.7) ${HOUR_PX}px)` }}>
                {byDay.get(d)!.map(({ appt, lane, lanes }) => {
                  const length = appt.end_at ? minutesBetween(appt.start_at, appt.end_at) : DEFAULT_MINUTES
                  const dragging = drag?.appt.id === appt.id ? drag : null
                  const top = (minutesOf(appt.start_at) / 60) * HOUR_PX + (dragging?.mode === 'move' ? dragging.dy : 0)
                  const height = Math.max(MIN_EVENT_PX, (length / 60) * HOUR_PX + (dragging?.mode === 'resize' ? dragging.dy : 0))
                  const text = label(appt)
                  const colW = 100 / lanes
                  return (
                    <div key={appt.id} className={`absolute rounded-md border-2 px-1.5 py-0.5 overflow-hidden text-[15px] ${colorOf(appt)} ${dragging ? 'shadow-xl z-20 opacity-90' : 'z-10'}`}
                      style={{ top, height, left: `calc(${lane * colW}% + 2px)`, width: `calc(${colW}% - 4px)`, transform: dragging?.mode === 'move' ? `translateX(${dragging.dx}px)` : undefined }}>
                      <button type="button" aria-label={text.full} title={text.full} data-day-index={di}
                        onPointerDown={e => {
                          if (e.button !== 0) return
                          // Only scheduled ones move; done and missed ones just open
                          if (appt.status !== 'scheduled') return
                          e.preventDefault()
                          setDrag({ appt, mode: 'move', x0: e.clientX, y0: e.clientY, dx: 0, dy: 0 })
                        }}
                        onClick={() => { if (appt.status !== 'scheduled') onOpen(appt) }}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(appt) } }}
                        className="block w-full h-full text-left cursor-grab focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 rounded-sm">
                        {/* Tall enough for two lines: who it's with goes on the second (audit S-29) */}
                        {height >= 44 && appt.record_name ? (
                          <>
                            <span className="block truncate font-medium">{text.short.replace(` with ${appt.record_name}`, '')}</span>
                            <span className="block truncate">{appt.record_name}</span>
                          </>
                        ) : <span className="block truncate font-medium">{text.short}</span>}
                      </button>
                      {appt.status === 'scheduled' && (
                        <div aria-hidden="true" className="absolute left-0 right-0 bottom-0 h-2 cursor-ns-resize"
                          onPointerDown={e => { e.preventDefault(); e.stopPropagation(); setDrag({ appt, mode: 'resize', x0: e.clientX, y0: e.clientY, dx: 0, dy: 0 }) }} />
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
