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

/** Anything with a days-until: a deadline (with its engine state), a task, a checklist item, a follow-up */
export interface DueLike { daysUntil: number; state?: DeadlineState }

/** The dashboard's rolling windows, from today: "Next 7 days" and "Next 30 days" */
export const NEXT_DAYS = { next7: DAYS_THIS_WEEK, next30: DAYS_THIS_MONTH } as const
export type DueWindow = keyof typeof NEXT_DAYS

/** Due from today through `days` days from now, and not late: the "Next 7 / 30 days" test */
export function dueWithin(d: DueLike, days: number): boolean {
  return !isLateDeadline(d) && d.daysUntil <= days
}

export interface DueCounts { overdue: number; next7: number; next30: number }

/**
 * The one way the dashboard counts (persona study R6): the tiles and the
 * Overdue / Next 7 days / Next 30 days tabs all count with this, over every
 * kind of item the What's due list shows. Overdue = late or a used-up quota;
 * the next 7 and 30 days start today and leave out what's late.
 */
export function countDue(items: Iterable<DueLike>): DueCounts {
  let overdue = 0, next7 = 0, next30 = 0
  for (const d of items) {
    if (isLateDeadline(d)) { overdue++; continue }
    if (d.daysUntil <= NEXT_DAYS.next7) next7++
    if (d.daysUntil <= NEXT_DAYS.next30) next30++
  }
  return { overdue, next7, next30 }
}

export interface DeadlineTileCounts { overdue: number; dueThisWeek: number; dueThisMonth: number }

/**
 * The deadline part of the tiles, counted like the morning briefing and the
 * desktop reminder (D-19, D-20). Main counts the full list with this, for when
 * the list it sends is cut at its cap (F-024).
 */
export function countDeadlineTiles(deadlines: DueLike[]): DeadlineTileCounts {
  const c = countDue(deadlines)
  return { overdue: c.overdue, dueThisWeek: c.next7, dueThisMonth: c.next30 }
}
