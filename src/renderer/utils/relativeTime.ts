import { MS_PER_DAY } from '../../shared/constants'
import { parseDbTimestamp } from '../../shared/dates'

/**
 * Shared relative-time formatter.
 * Accepts an ISO date string, a SQLite UTC timestamp, a numeric timestamp (ms since epoch), or null/undefined.
 */
export function relativeTime(input: string | number | null | undefined): string {
  if (input == null) return ''
  const diff = Date.now() - (typeof input === 'number' ? input : parseDbTimestamp(input).getTime())
  if (diff < 0) return 'just now'
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(diff / 3_600_000)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(diff / MS_PER_DAY)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks}w ago`
  const months = Math.floor(days / 30)
  if (months < 13) return `${months}mo ago`
  return `${Math.floor(days / 365)}y ago`
}
