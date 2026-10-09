import React, { useMemo } from 'react'
import { Calendar } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { classifyDeadline } from '../../utils/deadlineCalc'
import { LoadingOverlay } from '../../components/shared/LoadingSpinner'
import type { ExtendedDeadlineInfo } from './types'
import { getEffectiveDate } from './getEffectiveDate'

export function MonthViewTab({ deadlines, isLoading }: { deadlines: ExtendedDeadlineInfo[]; isLoading: boolean }): React.ReactElement {
  const navigate = useNavigate()
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()

  const monthDeadlines = useMemo(() => {
    return deadlines.filter(d => {
      const effDate = getEffectiveDate(d)
      return effDate !== null && effDate.getFullYear() === year && effDate.getMonth() === month
    }).sort((a, b) => a.daysUntil - b.daysUntil)
  }, [deadlines, year, month]) // eslint-disable-next-line react-hooks/exhaustive-deps

  const monthName = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  const byWeek = useMemo(() => {
    const weeks: Record<number, ExtendedDeadlineInfo[]> = {}
    monthDeadlines.forEach(d => {
      const effDate = getEffectiveDate(d)
      if (!effDate) return
      const week = Math.ceil(effDate.getDate() / 7)
      if (!weeks[week]) weeks[week] = []
      weeks[week].push(d)
    })
    return weeks
  }, [monthDeadlines])

  if (isLoading) return <LoadingOverlay label="Loading month view…" />

  return (
    <div className="p-4">
      <h2 className="text-base font-semibold text-slate-700 dark:text-slate-200 mb-4 flex items-center gap-2">
        <Calendar className="w-5 h-5 text-blue-500" />
        {monthName}
      </h2>
      {monthDeadlines.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-2 text-slate-500 dark:text-slate-400">
          <Calendar className="w-10 h-10 opacity-40" />
          <p className="text-base">No deadlines this month.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {[1, 2, 3, 4, 5].map(week => {
            const items = byWeek[week]
            if (!items || items.length === 0) return null
            const startDay = (week - 1) * 7 + 1
            const endDay = Math.min(week * 7, new Date(year, month + 1, 0).getDate())
            return (
              <div key={week}>
                <div className="text-sm font-semibold text-slate-500 dark:text-slate-400 mb-2 uppercase tracking-wide">
                  Week {week} &nbsp;·&nbsp; {monthName.split(' ')[0]} {startDay}–{endDay}
                </div>
                <div className="space-y-1">
                  {items.map((d, i) => {
                    const effDate = getEffectiveDate(d)
                    const dayLabel = effDate ? effDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : ''
                    const bucket = classifyDeadline(d.daysUntil)
                    const dotColor =
                      bucket === 'overdue' || bucket === 'today' ? 'bg-red-500' :
                      bucket === 'this-week' ? 'bg-orange-400' : 'bg-yellow-400'
                    return (
                      <div key={`${d.rowId}-${d.columnId}-${i}`}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-700/40 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-600/40"
                        onClick={() => navigate(`/profile/${d.rowId}?gridId=${d.gridId}`)}
                      >
                        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${dotColor}`} />
                        <div className="flex-1 min-w-0">
                          <span className="font-medium text-slate-800 dark:text-slate-100 hover:underline">{d.clientName}</span>
                          <span className="text-slate-500 dark:text-slate-400 text-sm ml-2">{d.columnName}</span>
                        </div>
                        <span className="text-sm text-slate-500 dark:text-slate-400 flex-shrink-0 tabular-nums">{dayLabel}</span>
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
