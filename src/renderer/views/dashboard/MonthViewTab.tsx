import React, { useMemo } from 'react'
import { Calendar } from 'lucide-react'
import { LoadingOverlay } from '../../components/shared/LoadingSpinner'
import type { ExtendedDeadlineInfo } from './types'
import { getEffectiveDate } from './getEffectiveDate'
import { DeadlineRow } from './DeadlineRow'

export function MonthViewTab({ deadlines, isLoading, onMarkDone, onUndone }: {
  deadlines: ExtendedDeadlineInfo[]; isLoading: boolean
  /** After Done: drop the row and reload */
  onMarkDone?: (rowId: number, columnId: number) => void
  onUndone?: () => Promise<void>
}): React.ReactElement {
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
                  {items.map((d, i) => (
                    // The same row as the Priority List: Done, Extend, Renew (D-22)
                    <div key={`${d.rowId}-${d.columnId}-${i}`} role="list" className="rounded-lg bg-slate-50 dark:bg-slate-700/40 overflow-hidden">
                      <DeadlineRow deadline={d} onMarkDone={onMarkDone ?? (() => {})} onUndoneMarkDone={onUndone} />
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
