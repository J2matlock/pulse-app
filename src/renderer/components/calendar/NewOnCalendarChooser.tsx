/**
 * What to add on a day of the Calendar: an event, an appointment, a
 * deadline for a record, or a task. Opened by clicking an empty part of a
 * day in the month view, or the "New…" button.
 */
import React from 'react'
import { CalendarCheck, CalendarClock, CalendarDays, ListTodo } from 'lucide-react'
import { longDay } from '../../../shared/calendar'
import { Dialog } from '../ui/Dialog'
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
  const options: Array<{ kind: NewOnCalendar; label: string; hint: string; icon: React.ReactNode }> = [
    { kind: 'event', label: 'Event', hint: `A meeting, training or day off, usually not about one ${t('record')}`, icon: <CalendarDays className="w-5 h-5" aria-hidden="true" /> },
    ...(apptsOn ? [{ kind: 'appointment' as const, label: t('appointment', { cap: true }), hint: `With ${t('record', { article: true })}`, icon: <CalendarClock className="w-5 h-5" aria-hidden="true" /> }] : []),
    { kind: 'deadline', label: `Deadline for ${t('record', { article: true })}`, hint: 'Make one of their deadlines due this day', icon: <CalendarCheck className="w-5 h-5" aria-hidden="true" /> },
    ...(tasksOn ? [{ kind: 'task' as const, label: 'Task', hint: 'Something to do by this day', icon: <ListTodo className="w-5 h-5" aria-hidden="true" /> }] : []),
  ]
  return (
    <Dialog open onClose={onClose} size="sm" title={<>Add to {longDay(date)}</>}>
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
    </Dialog>
  )
}
