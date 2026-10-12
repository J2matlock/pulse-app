import { DAYS_THIS_WEEK, DAYS_THIS_MONTH } from './constants'
import { isUsedUp, type DeadlineState } from './deadlineEngine'

/** Late, or a used-up quota (due "now" whatever its end date): what the Overdue tile and tab count. */
export function isLateDeadline(d: { daysUntil: number; state?: DeadlineState }): boolean {
  return d.daysUntil < 0 || isUsedUp({ state: d.state, daysUntil: d.daysUntil })
}

/**
 * The fixed "how soon" tiers (D-028) the dashboard rows, the deadline tiles
 * and Focus Mode use: late, today, the next 7 days, the next 30 days, later.
 * They are separate from a rule's own color thresholds, which color the grid
 * cell and the dashboard row background.
 */
export type DueTier = 'overdue' | 'today' | 'this-week' | 'this-month' | 'future'

export function classifyDeadline(daysUntil: number): DueTier {
  if (daysUntil < 0) return 'overdue'
  if (daysUntil === 0) return 'today'
  if (daysUntil <= DAYS_THIS_WEEK) return 'this-week'
  if (daysUntil <= DAYS_THIS_MONTH) return 'this-month'
  return 'future'
}

/** "3 days overdue" (the sign of `days` is ignored) */
export function daysOverdueLabel(days: number): string {
  const n = Math.abs(days)
  return `${n} day${n === 1 ? '' : 's'} overdue`
}

/** "3 days overdue", "Due today", "5 days" */
export function daysAwayLabel(daysUntil: number): string {
  if (daysUntil < 0) return daysOverdueLabel(daysUntil)
  if (daysUntil === 0) return 'Due today'
  return `${daysUntil} day${daysUntil === 1 ? '' : 's'}`
}

export interface DeadlineTileCounts { overdue: number; dueThisWeek: number; dueThisMonth: number }

/**
 * The dashboard's deadline tiles, counted like the morning briefing and the
 * desktop reminder (D-19, D-20): overdue = late or a used-up quota; the
 * rolling "next 7 / 30 days" include today. Main counts the full list with this
 * too, for when the list it sends is cut at its cap (F-024).
 */
export function countDeadlineTiles(deadlines: Array<{ daysUntil: number; state?: DeadlineState }>): DeadlineTileCounts {
  let overdue = 0, dueThisWeek = 0, dueThisMonth = 0
  for (const d of deadlines) {
    if (isLateDeadline(d)) { overdue++; continue }
    if (d.daysUntil <= DAYS_THIS_WEEK) dueThisWeek++
    if (d.daysUntil <= DAYS_THIS_MONTH) dueThisMonth++
  }
  return { overdue, dueThisWeek, dueThisMonth }
}
