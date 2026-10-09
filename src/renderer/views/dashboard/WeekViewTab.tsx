import React, { useMemo } from 'react'
import { Clock } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { CaseloadTask, ChecklistDueItem } from '../../../shared/types'
import { classifyDeadline } from '../../utils/deadlineCalc'
import { LoadingOverlay } from '../../components/shared/LoadingSpinner'
import type { ExtendedDeadlineInfo, FollowUpRow } from './types'
import { getEffectiveDate } from './getEffectiveDate'

type WeekItem =
  | { kind: 'deadline'; data: ExtendedDeadlineInfo; dateKey: string }
  | { kind: 'task'; data: CaseloadTask; daysUntil: number; dateKey: string }
  | { kind: 'checklist'; data: ChecklistDueItem; daysUntil: number; dateKey: string }
  | { kind: 'followup'; data: FollowUpRow; daysUntil: number; dateKey: string }

export function WeekViewTab({
  deadlines, tasksWithDays, checklistWithDays, followUpsWithDays, isLoading,
}: {
  deadlines: ExtendedDeadlineInfo[]
  tasksWithDays: Array<{ task: CaseloadTask; daysUntil: number }>
  checklistWithDays: Array<{ item: ChecklistDueItem; daysUntil: number }>
  followUpsWithDays: Array<{ followUp: FollowUpRow; daysUntil: number }>
  isLoading: boolean
}): React.ReactElement {
  const navigate = useNavigate()
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayStr = today.toDateString()

  const weekItems = useMemo(() => {
    const items: WeekItem[] = []

    for (const d of deadlines) {
      if (d.daysUntil >= -1 && d.daysUntil <= 7) {
        const effDate = getEffectiveDate(d)
        const dateKey = effDate ? effDate.toDateString() : today.toDateString()
        items.push({ kind: 'deadline', data: d, dateKey })
      }
    }

    for (const { task, daysUntil } of tasksWithDays) {
      if (daysUntil >= -1 && daysUntil <= 7 && task.due_date) {
        const d = new Date(task.due_date + 'T00:00:00')
        items.push({ kind: 'task', data: task, daysUntil, dateKey: d.toDateString() })
      }
    }

    for (const { item: ci, daysUntil } of checklistWithDays) {
      if (daysUntil >= -1 && daysUntil <= 7) {
        const d = new Date(ci.due_date! + 'T00:00:00')
        items.push({ kind: 'checklist', data: ci, daysUntil, dateKey: d.toDateString() })
      }
    }

    for (const { followUp, daysUntil } of followUpsWithDays) {
      if (daysUntil >= -1 && daysUntil <= 7) {
        const d = new Date(followUp.follow_up_date + 'T00:00:00')
        items.push({ kind: 'followup', data: followUp, daysUntil, dateKey: d.toDateString() })
      }
    }

    return items
  }, [deadlines, tasksWithDays, checklistWithDays, followUpsWithDays]) // eslint-disable-next-line react-hooks/exhaustive-deps

  const dayGroups = useMemo(() => {
    const map = new Map<string, WeekItem[]>()
    for (const item of weekItems) {
      const list = map.get(item.dateKey) || []
      list.push(item)
      map.set(item.dateKey, list)
    }
    const sorted = [...map.entries()].sort(([a], [b]) => new Date(a).getTime() - new Date(b).getTime())
    return sorted
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
          <p className="text-base">No deadlines this week.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {dayGroups.map(([dateKey, items]) => {
            const date = new Date(dateKey)
            const isToday = dateKey === todayStr
            const dayLabel = date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
            return (
              <div key={dateKey}>
                <div className={`text-sm font-semibold mb-2 uppercase tracking-wide ${
                  isToday ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400'
                }`}>
                  {isToday ? `Today \u00b7 ${dayLabel}` : dayLabel}
                </div>
                <div className="space-y-1">
                  {items.map((item, i) => {
                    if (item.kind === 'deadline') {
                      const d = item.data
                      const bucket = classifyDeadline(d.daysUntil)
                      const dotColor =
                        bucket === 'overdue' || bucket === 'today' ? 'bg-red-500' :
                        bucket === 'this-week' ? 'bg-orange-400' : 'bg-yellow-400'
                      return (
                        <div key={`dl-${d.rowId}-${d.columnId}-${i}`}
                          className="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-700/40 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-600/40"
                          onClick={() => navigate(`/profile/${d.rowId}?gridId=${d.gridId}`)}
                        >
                          <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${dotColor}`} />
                          <div className="flex-1 min-w-0">
                            <span className="font-medium text-slate-800 dark:text-slate-100">{d.clientName}</span>
                            <span className="text-slate-500 dark:text-slate-400 text-sm ml-2">{d.columnName}</span>
                          </div>
                          <span className="text-sm text-slate-500 dark:text-slate-400 flex-shrink-0">{d.gridName}</span>
                        </div>
                      )
                    }
                    if (item.kind === 'task') {
                      const t = item.data
                      return (
                        <div key={`task-${t.id}`}
                          className="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-700/40 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-600/40"
                          onClick={() => navigate('/tasks')}
                        >
                          <div className="w-2.5 h-2.5 rounded-full flex-shrink-0 bg-purple-400" />
                          <div className="flex-1 min-w-0">
                            <span className="font-medium text-slate-800 dark:text-slate-100">{t.title}</span>
                            <span className="text-sm bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 px-1.5 py-0.5 rounded-sm ml-2">task</span>
                          </div>
                          {t.category && <span className="text-sm text-slate-500 dark:text-slate-400 flex-shrink-0">{t.category}</span>}
                        </div>
                      )
                    }
                    if (item.kind === 'checklist') {
                      const ci = item.data
                      return (
                        <div key={`cl-${ci.id}`}
                          className="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-700/40 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-600/40"
                          onClick={() => navigate(`/profile/${ci.row_id}?gridId=${ci.grid_id}`)}
                        >
                          <div className="w-2.5 h-2.5 rounded-full flex-shrink-0 bg-teal-400" />
                          <div className="flex-1 min-w-0">
                            <span className="font-medium text-slate-800 dark:text-slate-100">{ci.title}</span>
                            <span className="text-sm bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 px-1.5 py-0.5 rounded-sm ml-2">checklist</span>
                          </div>
                          <span className="text-sm text-slate-500 dark:text-slate-400 flex-shrink-0">{ci.client_name} &middot; {ci.grid_name}</span>
                        </div>
                      )
                    }
                    // followup
                    const f = item.data
                    return (
                      <div key={`fu-${f.id}`}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-700/40 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-600/40"
                        onClick={() => navigate(`/profile/${f.row_id}?gridId=${f.grid_id}`)}
                      >
                        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0 bg-amber-400" />
                        <div className="flex-1 min-w-0">
                          <span className="font-medium text-slate-800 dark:text-slate-100">{f.client_name}</span>
                          <span className="text-sm bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded-sm ml-2">follow-up</span>
                        </div>
                        <span className="text-sm text-slate-500 dark:text-slate-400 flex-shrink-0">{f.grid_name}</span>
                      </div>
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
