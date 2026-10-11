/**
 * One line for a deadline in printouts and PDFs, worked out by the deadline
 * engine so paper never disagrees with the app (1.19).
 */
import { formatDue, type DeadlineResult } from './deadlineEngine'

/** "Next due Oct 17, 2026 · Due in 7 days", plus a step label and any extension with its reason. */
export function deadlineSummary(d: Pick<DeadlineResult, 'due' | 'state' | 'daysUntil' | 'estimated' | 'label' | 'extended'>): string {
  if (!d.due) return '\u2014'
  const n = d.daysUntil ?? 0
  const days = (k: number) => `${k} day${k === 1 ? '' : 's'}`
  const when = d.state === 'overdue' ? `OVERDUE by ${days(-n)}`
    : d.state === 'due' ? 'Due today'
    : n === 1 ? 'Due tomorrow'
    : `Due in ${days(n)}`
  const parts = [`Next due ${formatDue(d.due)}${d.estimated ? ' (estimated)' : ''}`, when]
  if (d.label) parts.push(d.label)
  if (d.extended) parts.push(`Extended from ${formatDue(d.extended.from)}: ${d.extended.reason}`)
  return parts.join('  \u00b7  ')
}
