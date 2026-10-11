import { DAYS_THIS_WEEK, DAYS_THIS_MONTH } from '../../../shared/constants'
import { isUsedUp, type DeadlineState } from '../../../shared/deadlineEngine'

/** Late, or a used-up quota (due "now" whatever its end date): what the Overdue tile and tab count. */
export function isLateDeadline(d: { daysUntil: number; state?: DeadlineState }): boolean {
  return d.daysUntil < 0 || isUsedUp({ state: d.state, daysUntil: d.daysUntil })
}

/**
 * The dashboard's deadline tiles, counted like the morning briefing and the
 * desktop reminder (D-19, D-20): overdue = late or a used-up quota; the
 * rolling "next 7 / 30 days" include today.
 */
export function countDeadlineTiles(deadlines: Array<{ daysUntil: number; state?: DeadlineState }>): { overdue: number; dueThisWeek: number; dueThisMonth: number } {
  let overdue = 0, dueThisWeek = 0, dueThisMonth = 0
  for (const d of deadlines) {
    if (isLateDeadline(d)) { overdue++; continue }
    if (d.daysUntil <= DAYS_THIS_WEEK) dueThisWeek++
    if (d.daysUntil <= DAYS_THIS_MONTH) dueThisMonth++
  }
  return { overdue, dueThisWeek, dueThisMonth }
}
