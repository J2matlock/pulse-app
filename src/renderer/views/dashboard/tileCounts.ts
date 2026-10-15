import { QUERY_LIMITS } from '../../../shared/query-limits'
import { countDeadlineTiles, countDue, isLateDeadline, type DeadlineTileCounts, type DueCounts, type DueLike } from '../../../shared/deadlineTiles'

export { countDeadlineTiles, countDue, isLateDeadline }

/** Main sends at most this many deadlines / open follow-ups; a list this long may have been cut. */
export const deadlinesMayBeCut = (n: number): boolean => n >= QUERY_LIMITS.DASHBOARD_PRIORITY
export const followUpsMayBeCut = (n: number): boolean => n >= QUERY_LIMITS.DASHBOARD_FOLLOWUPS

/**
 * The tile numbers: Overdue, Next 7 days, Next 30 days, over deadlines, tasks,
 * checklist items and follow-ups, counted with `countDue` like the tabs they
 * open. Counted from the lists on screen (so a Done shows at once), except when
 * a list came back at main's cap: then the rest are missing from it, and main's
 * own counts over everything are used (F-024).
 */
export function dashboardTileCounts(input: {
  deadlines: DueLike[]
  deadlinesCut: boolean
  followUpDays: number[]
  followUpsCut: boolean
  /** Tasks with a due date and checklist items */
  otherDueDays: number[]
  server?: { deadlineTiles?: DeadlineTileCounts; followUpsPending?: number } | null
}): DueCounts {
  const server = input.server?.deadlineTiles
  const deadlines: DueCounts = input.deadlinesCut && server
    ? { overdue: server.overdue, next7: server.dueThisWeek, next30: server.dueThisMonth }
    : countDue(input.deadlines)
  const others = countDue(input.otherDueDays.map(daysUntil => ({ daysUntil })))
  const followUps = countDue(input.followUpDays.map(daysUntil => ({ daysUntil })))
  // Main counts follow-ups due today or late over all of them; take today's off for the late ones
  if (input.followUpsCut && input.server?.followUpsPending !== undefined) {
    const today = input.followUpDays.filter(d => d === 0).length
    followUps.overdue = Math.max(followUps.overdue, input.server.followUpsPending - today)
  }
  return {
    overdue: deadlines.overdue + others.overdue + followUps.overdue,
    next7: deadlines.next7 + others.next7 + followUps.next7,
    next30: deadlines.next30 + others.next30 + followUps.next30,
  }
}
