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

/** Snoozed until a date: hidden before it, due again on it (the dashboard and briefing agree) */
export function isSnoozed(task: CaseloadTask): boolean {
  if (!task.snoozed_until) return false
  return task.snoozed_until > localDateString()
}

/** "Oct 14" (with the year when it isn't this one) and how many days away it is */
function dueDateParts(dateStr: string): { date: string; diffDays: number } {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = new Date(dateStr + 'T00:00:00')
  const diffDays = Math.round((due.getTime() - today.getTime()) / MS_PER_DAY)
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  if (due.getFullYear() !== today.getFullYear()) opts.year = 'numeric'
  return { date: due.toLocaleDateString(undefined, opts), diffDays }
}

export type DueUrgency = 'overdue' | 'today' | 'soon' | 'later'

export interface DueDateDisplay {
  /** What to show and read out: the urgency in words as well as the date */
  text: string
  /** Just the date, "Oct 14" */
  date: string
  urgency: DueUrgency
  className: string
}

/**
 * Urgency in words, not just color (audit A06-12): "Overdue · Oct 8",
 * "Due today", "Tomorrow · Oct 11", "In 4 days · Oct 14"; later dates are
 * just the date. Matches the grid's "Due today" / "overdue" wording.
 */
function dueDateDisplay(dateStr: string): Omit<DueDateDisplay, 'className'> {
  const { date, diffDays } = dueDateParts(dateStr)
  if (diffDays < 0) return { text: `Overdue · ${date}`, date, urgency: 'overdue' }
  if (diffDays === 0) return { text: 'Due today', date, urgency: 'today' }
  if (diffDays === 1) return { text: `Tomorrow · ${date}`, date, urgency: 'soon' }
  if (diffDays <= 7) return { text: `In ${diffDays} days · ${date}`, date, urgency: 'soon' }
  return { text: date, date, urgency: 'later' }
}

// Light-theme text is -700 so it reads at 4.5:1 on white and on the pill tints (A06-3)
const LABEL_CLASS: Record<DueUrgency, string> = {
  overdue: 'text-red-700 dark:text-red-400',
  today: 'text-amber-700 dark:text-amber-400',
  soon: 'text-yellow-800 dark:text-yellow-400',
  later: 'text-slate-500 dark:text-slate-400',
}

const BADGE_CLASS: Record<DueUrgency, string> = {
  overdue: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  today: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  soon: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  later: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
}

/** A due date as colored text: late, today, this week, later */
export function dueDateLabel(dateStr: string | null): DueDateDisplay | null {
  if (!dateStr) return null
  const d = dueDateDisplay(dateStr)
  return { ...d, className: LABEL_CLASS[d.urgency] }
}

/** The same due date as a pill, for task and checklist rows */
export function dueDateBadge(dateStr: string | null): DueDateDisplay | null {
  if (!dateStr) return null
  const d = dueDateDisplay(dateStr)
  return { ...d, className: BADGE_CLASS[d.urgency] }
}
