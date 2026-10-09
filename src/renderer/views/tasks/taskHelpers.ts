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

export function isSnoozed(task: CaseloadTask): boolean {
  if (!task.snoozed_until) return false
  return task.snoozed_until >= localDateString()
}

export function dueDateLabel(dateStr: string | null): { text: string; className: string } | null {
  if (!dateStr) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = new Date(dateStr + 'T00:00:00')
  const diffDays = Math.round((due.getTime() - today.getTime()) / MS_PER_DAY)
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  if (due.getFullYear() !== today.getFullYear()) opts.year = 'numeric'
  const text = due.toLocaleDateString(undefined, opts)
  let className = 'text-slate-500'
  if (diffDays < 0) className = 'text-red-600 dark:text-red-400'
  else if (diffDays === 0) className = 'text-amber-600 dark:text-amber-400'
  else if (diffDays <= 7) className = 'text-yellow-600 dark:text-yellow-500'
  return { text, className }
}
