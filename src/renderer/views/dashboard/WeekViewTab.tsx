import React, { useMemo } from 'react'
import { Clock } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { CaseloadTask, ChecklistDueItem } from '../../../shared/types'
import { LoadingOverlay } from '../../components/shared/LoadingSpinner'
import type { ExtendedDeadlineInfo, FollowUpRow } from './types'
import { getEffectiveDate } from './getEffectiveDate'
import { DeadlineRow } from './DeadlineRow'
import { useSettingsStore } from '../../stores/settingsStore'
import { isUsedUp } from '../../../shared/deadlineEngine'

const OVERDUE = 'overdue'

/** Days from today to the last day of this calendar week (0 on that day). */
export function daysLeftInWeek(today: Date, weekStart: 'sunday' | 'monday'): number {
  const dayOfWeek = weekStart === 'monday' ? (today.getDay() + 6) % 7 : today.getDay()
  return 6 - dayOfWeek
}

type WeekItem =
  | { kind: 'deadline'; data: ExtendedDeadlineInfo; dateKey: string }
  | { kind: 'task'; data: CaseloadTask; daysUntil: number; dateKey: string }
  | { kind: 'checklist'; data: ChecklistDueItem; daysUntil: number; dateKey: string }
  | { kind: 'followup'; data: FollowUpRow; daysUntil: number; dateKey: string }

export function WeekViewTab({
  deadlines, tasksWithDays, checklistWithDays, followUpsWithDays, isLoading, onMarkDone, onUndone,
}: {
  /** After Done: drop the row and reload */
  onMarkDone?: (rowId: number, columnId: number) => void
  onUndone?: () => Promise<void>
  deadlines: ExtendedDeadlineInfo[]
  tasksWithDays: Array<{ task: CaseloadTask; daysUntil: number }>
  checklistWithDays: Array<{ item: ChecklistDueItem; daysUntil: number }>
  followUpsWithDays: Array<{ followUp: FollowUpRow; daysUntil: number }>
  isLoading: boolean
}): React.ReactElement {
  const navigate = useNavigate()
  const weekStart = useSettingsStore(s => s.weekStart)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayStr = today.toDateString()
  // The calendar week (Settings → week starts on), from today to its last day
  const daysLeft = daysLeftInWeek(today, weekStart)

  const weekItems = useMemo(() => {
    const items: WeekItem[] = []
    // Anything late goes at the top, however late; the rest by day
    const keyFor = (daysUntil: number, date: Date | null) => daysUntil < 0 ? OVERDUE : (date ?? today).toDateString()
    const inWeek = (daysUntil: number) => daysUntil <= daysLeft

    for (const d of deadlines) {
      const late = d.daysUntil < 0 || isUsedUp({ state: d.state, daysUntil: d.daysUntil })
      if (late || inWeek(d.daysUntil)) items.push({ kind: 'deadline', data: d, dateKey: late ? OVERDUE : keyFor(d.daysUntil, getEffectiveDate(d)) })
    }

    for (const { task, daysUntil } of tasksWithDays) {
      if (inWeek(daysUntil) && task.due_date) {
        items.push({ kind: 'task', data: task, daysUntil, dateKey: keyFor(daysUntil, new Date(task.due_date + 'T00:00:00')) })
      }
    }

    for (const { item: ci, daysUntil } of checklistWithDays) {
      if (inWeek(daysUntil)) {
        items.push({ kind: 'checklist', data: ci, daysUntil, dateKey: keyFor(daysUntil, new Date(ci.due_date! + 'T00:00:00')) })
      }
    }

    for (const { followUp, daysUntil } of followUpsWithDays) {
      if (inWeek(daysUntil)) {
        items.push({ kind: 'followup', data: followUp, daysUntil, dateKey: keyFor(daysUntil, new Date(followUp.follow_up_date + 'T00:00:00')) })
      }
    }

    return items
  }, [deadlines, tasksWithDays, checklistWithDays, followUpsWithDays, daysLeft]) // eslint-disable-line react-hooks/exhaustive-deps -- today only changes with the day, and the lists change with it

  const dayGroups = useMemo(() => {
    const map = new Map<string, WeekItem[]>()
    for (const item of weekItems) {
      const list = map.get(item.dateKey) || []
      list.push(item)
      map.set(item.dateKey, list)
    }
    const at = (k: string) => k === OVERDUE ? -Infinity : new Date(k).getTime()
    return [...map.entries()].sort(([a], [b]) => at(a) - at(b))
  }, [weekItems])

  if (isLoading) return <LoadingOverlay label="Loading week view…" />

  return (
    <div className="p-4">
      <h2 className="text-base font-semibold text-slate-700 dark:text-slate-200 mb-4 flex items-center gap-2">
        <Clock className="w-5 h-5 text-blue-500" />
        This Week
      </h2>
      {dayGroups.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-2 text-slate-500 dark:text-slate-400">
          <Clock className="w-10 h-10 opacity-40" />
          <p className="text-base">Nothing late, and nothing else due this week.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {dayGroups.map(([dateKey, items]) => {
            const isOverdue = dateKey === OVERDUE
            const isToday = dateKey === todayStr
            const dayLabel = isOverdue ? 'Overdue' : new Date(dateKey).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
            return (
              <div key={dateKey}>
                <div className={`text-sm font-semibold mb-2 uppercase tracking-wide ${
                  isOverdue ? 'text-red-700 dark:text-red-300' : isToday ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400'
                }`}>
                  {isToday ? `Today \u00b7 ${dayLabel}` : dayLabel}
                </div>
                <div className="space-y-1">
                  {items.map((item, i) => {
                    if (item.kind === 'deadline') {
                      const d = item.data
                      // The same row as the Priority List: Done, Extend, Renew (D-22)
                      return (
                        <div key={`dl-${d.rowId}-${d.columnId}-${i}`} role="list" className="rounded-lg bg-slate-50 dark:bg-slate-700/40 overflow-hidden">
                          <DeadlineRow deadline={d} onMarkDone={onMarkDone ?? (() => {})} onUndoneMarkDone={onUndone} />
                        </div>
                      )
                    }
                    if (item.kind === 'task') {
                      const t = item.data
                      return (
                        // Buttons, so the keyboard can open them too (Q-053)
                        <button key={`task-${t.id}`}
                          type="button"
                          className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-700/40 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-600/40 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
                          onClick={() => navigate('/tasks')}
                        >
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 bg-purple-400" />
                          <span className="flex-1 min-w-0">
                            <span className="font-medium text-slate-800 dark:text-slate-100">{t.title}</span>
                            <span className="text-sm bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 px-1.5 py-0.5 rounded-sm ml-2">task</span>
                          </span>
                          {t.category && <span className="text-sm text-slate-500 dark:text-slate-400 flex-shrink-0">{t.category}</span>}
                        </button>
                      )
                    }
                    if (item.kind === 'checklist') {
                      const ci = item.data
                      return (
                        <button key={`cl-${ci.id}`}
                          type="button"
                          className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-700/40 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-600/40 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
                          onClick={() => navigate(`/profile/${ci.row_id}?gridId=${ci.grid_id}`)}
                        >
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 bg-teal-400" />
                          <span className="flex-1 min-w-0">
                            <span className="font-medium text-slate-800 dark:text-slate-100">{ci.title}</span>
                            <span className="text-sm bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 px-1.5 py-0.5 rounded-sm ml-2">checklist</span>
                          </span>
                          <span className="text-sm text-slate-500 dark:text-slate-400 flex-shrink-0">{ci.client_name} &middot; {ci.grid_name}</span>
                        </button>
                      )
                    }
                    // followup
                    const f = item.data
                    return (
                      <button key={`fu-${f.id}`}
                        type="button"
                        className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-700/40 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-600/40 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
                        onClick={() => navigate(`/profile/${f.row_id}?gridId=${f.grid_id}`)}
                      >
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 bg-amber-400" />
                        <span className="flex-1 min-w-0">
                          <span className="font-medium text-slate-800 dark:text-slate-100">{f.client_name}</span>
                          <span className="text-sm bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded-sm ml-2">follow-up</span>
                        </span>
                        <span className="text-sm text-slate-500 dark:text-slate-400 flex-shrink-0">{f.grid_name}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
