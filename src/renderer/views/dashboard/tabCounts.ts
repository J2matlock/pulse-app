/**
 * Which items the This week and This month tabs show, so the tab labels can
 * count exactly what's behind them (D-20). The tabs filter with these too.
 */
import type { CaseloadTask, ChecklistDueItem } from '../../../shared/types'
import { isUsedUp } from '../../../shared/deadlineEngine'
import type { ExtendedDeadlineInfo, FollowUpRow } from './types'
import { getEffectiveDate } from './getEffectiveDate'

/** Days from today to the last day of this calendar week (0 on that day). */
export function daysLeftInWeek(today: Date, weekStart: 'sunday' | 'monday'): number {
  const dayOfWeek = weekStart === 'monday' ? (today.getDay() + 6) % 7 : today.getDay()
  return 6 - dayOfWeek
}

/** Late (however late), a used-up allowance, or due by the end of this week */
export function deadlineInWeekTab(d: ExtendedDeadlineInfo, daysLeft: number): boolean {
  return d.daysUntil < 0 || isUsedUp({ state: d.state, daysUntil: d.daysUntil }) || d.daysUntil <= daysLeft
}

/** Due this calendar month */
export function deadlineInMonthTab(d: ExtendedDeadlineInfo, year: number, month: number): boolean {
  const eff = getEffectiveDate(d)
  return eff !== null && eff.getFullYear() === year && eff.getMonth() === month
}

export function weekTabCount(input: {
  deadlines: ExtendedDeadlineInfo[]
  tasksWithDays: Array<{ task: CaseloadTask; daysUntil: number }>
  checklistWithDays: Array<{ item: ChecklistDueItem; daysUntil: number }>
  followUpsWithDays: Array<{ followUp: FollowUpRow; daysUntil: number }>
  daysLeft: number
}): number {
  const inWeek = (daysUntil: number) => daysUntil <= input.daysLeft
  return input.deadlines.filter(d => deadlineInWeekTab(d, input.daysLeft)).length
    + input.tasksWithDays.filter(t => inWeek(t.daysUntil) && !!t.task.due_date).length
    + input.checklistWithDays.filter(c => inWeek(c.daysUntil)).length
    + input.followUpsWithDays.filter(f => inWeek(f.daysUntil)).length
}

export function monthTabCount(deadlines: ExtendedDeadlineInfo[], now: Date): number {
  return deadlines.filter(d => deadlineInMonthTab(d, now.getFullYear(), now.getMonth())).length
}
