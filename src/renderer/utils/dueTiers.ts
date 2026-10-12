import type { DueTier } from '../../shared/deadlineTiles'

/**
 * Colors for the fixed "how soon" tiers on the dashboard rows
 * (src/shared/deadlineTiles.ts, D-028). Each row kind keeps its own color
 * for dates further out than 30 days.
 */
export const TIER_TEXT: Record<DueTier, string> = {
  overdue: 'text-red-600 dark:text-red-400 font-semibold',
  today: 'text-red-600 dark:text-red-400 font-semibold',
  'this-week': 'text-orange-700 dark:text-orange-400',
  'this-month': 'text-yellow-700 dark:text-yellow-400',
  future: 'text-slate-500 dark:text-slate-400',
}

/** The colored bar at the start of a row */
export const TIER_BAR: Record<Exclude<DueTier, 'future'>, string> = {
  overdue: 'bg-red-500',
  today: 'bg-red-400',
  'this-week': 'bg-orange-400',
  'this-month': 'bg-yellow-400',
}
