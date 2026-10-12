import { QUERY_LIMITS } from '../../../shared/query-limits'
import { countDeadlineTiles, isLateDeadline, type DeadlineTileCounts } from '../../../shared/deadlineTiles'
import type { DeadlineState } from '../../../shared/deadlineEngine'

export { countDeadlineTiles, isLateDeadline }

/** Main sends at most this many deadlines / open follow-ups; a list this long may have been cut. */
export const deadlinesMayBeCut = (n: number): boolean => n >= QUERY_LIMITS.DASHBOARD_PRIORITY
export const followUpsMayBeCut = (n: number): boolean => n >= QUERY_LIMITS.DASHBOARD_FOLLOWUPS

/**
 * The tile numbers. Counted from the lists on screen (so a Done shows at once),
 * except when a list came back at main's cap: then the rest are missing from it,
 * and main's own counts over everything are used (F-024).
 */
export function dashboardTileCounts(input: {
  deadlines: Array<{ daysUntil: number; state?: DeadlineState }>
  deadlinesCut: boolean
  followUpDays: number[]
  followUpsCut: boolean
  otherDueDays: number[]
  server?: { deadlineTiles?: DeadlineTileCounts; followUpsPending?: number } | null
}): DeadlineTileCounts & { otherDue: number } {
  const tiles = input.deadlinesCut && input.server?.deadlineTiles ? input.server.deadlineTiles : countDeadlineTiles(input.deadlines)
  const followUpsDue = input.followUpsCut && input.server?.followUpsPending !== undefined
    ? input.server.followUpsPending
    : input.followUpDays.filter(d => d <= 0).length
  return { ...tiles, otherDue: input.otherDueDays.filter(d => d <= 0).length + followUpsDue }
}
