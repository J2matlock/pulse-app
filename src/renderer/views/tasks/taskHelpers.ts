import type { CaseloadTask } from '../../../shared/types'
import { MS_PER_DAY } from '../../../shared/constants'
import { localDateString } from '../../../shared/dates'

export const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 }

export function isOverdue(task: CaseloadTask): boolean {
  if (!task.due_date || task.is_completed) return false
  return task.due_date < localDateString()
}

export function isDueToday(task: CaseloadTask): boolean {
  if (!task.due_date || task.is_completed) return false
  return task.due_date === localDateString()
}

export function isDueThisWeek(task: CaseloadTask): boolean {
  if (!task.due_date || task.is_completed) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = new Date(task.due_date + 'T00:00:00')
  const diffDays = Math.round((due.getTime() - today.getTime()) / MS_PER_DAY)
  return diffDays > 0 && diffDays <= 7
}

/** Snoozed until a date: hidden before it, due again on it (the dashboard and briefing agree) */
export function isSnoozed(task: CaseloadTask): boolean {
  if (!task.snoozed_until) return false
  return task.snoozed_until > localDateString()
}

/** "Oct 14" (with the year when it isn't this one) and how many days away it is */
function dueDateParts(dateStr: string): { text: string; diffDays: number } {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = new Date(dateStr + 'T00:00:00')
  const diffDays = Math.round((due.getTime() - today.getTime()) / MS_PER_DAY)
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  if (due.getFullYear() !== today.getFullYear()) opts.year = 'numeric'
  return { text: due.toLocaleDateString(undefined, opts), diffDays }
}

/** A due date as colored text: late, today, this week, later */
export function dueDateLabel(dateStr: string | null): { text: string; className: string } | null {
  if (!dateStr) return null
  const { text, diffDays } = dueDateParts(dateStr)
  let className = 'text-slate-500'
  if (diffDays < 0) className = 'text-red-600 dark:text-red-400'
  else if (diffDays === 0) className = 'text-amber-600 dark:text-amber-400'
  else if (diffDays <= 7) className = 'text-yellow-600 dark:text-yellow-500'
  return { text, className }
}

/** The same due date as a pill, for task and checklist rows */
export function dueDateBadge(dateStr: string | null): { text: string; className: string } | null {
  if (!dateStr) return null
  const { text, diffDays } = dueDateParts(dateStr)
  let className = 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
  if (diffDays < 0) className = 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
  else if (diffDays === 0) className = 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300'
  else if (diffDays <= 7) className = 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-600'
  return { text, className }
}
