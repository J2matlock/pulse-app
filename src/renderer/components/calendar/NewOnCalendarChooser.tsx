/**
 * What to add on a day of the Calendar: an event, an appointment, a
 * deadline for a record, or a task. Opened by clicking an empty part of a
 * day in the month view, or the "New…" button.
 */
import React, { useRef } from 'react'
import { CalendarCheck, CalendarClock, CalendarDays, ListTodo, X } from 'lucide-react'
import { longDay } from '../../../shared/calendar'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useVocab } from '../../hooks/useVocab'

export type NewOnCalendar = 'event' | 'appointment' | 'deadline' | 'task'

export interface NewOnCalendarChooserProps {
  date: string
  apptsOn: boolean
  tasksOn: boolean
  onChoose: (kind: NewOnCalendar) => void
  onClose: () => void
}

export function NewOnCalendarChooser({ date, apptsOn, tasksOn, onChoose, onClose }: NewOnCalendarChooserProps): React.ReactElement {
  const { t } = useVocab(null)
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref, true, { onEscape: onClose })
  const options: Array<{ kind: NewOnCalendar; label: string; hint: string; icon: React.ReactNode }> = [
    { kind: 'event', label: 'Event', hint: `A meeting, training or day off, not about one ${t('record')}`, icon: <CalendarDays className="w-5 h-5" aria-hidden="true" /> },
    ...(apptsOn ? [{ kind: 'appointment' as const, label: t('appointment', { cap: true }), hint: `With ${t('record', { article: true })}`, icon: <CalendarClock className="w-5 h-5" aria-hidden="true" /> }] : []),
    { kind: 'deadline', label: `Deadline for ${t('record', { article: true })}`, hint: 'Make one of their deadlines due this day', icon: <CalendarCheck className="w-5 h-5" aria-hidden="true" /> },
    ...(tasksOn ? [{ kind: 'task' as const, label: 'Task', hint: 'Something to do by this day', icon: <ListTodo className="w-5 h-5" aria-hidden="true" /> }] : []),
  ]
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="new-on-calendar-title" onClick={e => e.stopPropagation()}
        className="w-full max-w-sm rounded-xl bg-white dark:bg-slate-800 shadow-xl border border-slate-200 dark:border-slate-700 p-5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 id="new-on-calendar-title" className="text-lg font-semibold text-slate-900 dark:text-slate-100">Add to {longDay(date)}</h2>
          <button type="button" aria-label="Close" onClick={onClose}
            className="hit-44 p-1.5 rounded-sm hover:bg-slate-100 dark:hover:bg-slate-700 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>
        <ul className="space-y-2">
          {options.map(o => (
            <li key={o.kind}>
              <button type="button" onClick={() => onChoose(o.kind)} aria-labelledby={`new-on-calendar-${o.kind}-label`} aria-describedby={`new-on-calendar-${o.kind}`}
                className="w-full flex items-start gap-3 text-left rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 text-slate-800 dark:text-slate-100"
                style={{ minHeight: 44 }}>
                <span className="mt-0.5 text-blue-600 dark:text-blue-400">{o.icon}</span>
                <span className="flex-1">
                  <span id={`new-on-calendar-${o.kind}-label`} className="block text-base font-medium">{o.label}</span>
                  <span id={`new-on-calendar-${o.kind}`} className="block text-sm text-slate-600 dark:text-slate-300">{o.hint}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
