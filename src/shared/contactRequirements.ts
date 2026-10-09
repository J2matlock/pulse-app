import type { ContactRequirement } from './types'

/** True when a client has met every monthly contact requirement. */
export function contactsComplete(counts: number[], reqs: ContactRequirement[]): boolean {
  return reqs.every((r, i) => (counts[i] ?? 0) >= r.per_month)
}

/** What's still missing, e.g. ["Face-to-face (0 of 1)", "Check-ins (1 of 2 per week)"]. Months, the usual case, go unsaid. */
export function contactsMissing(counts: number[], reqs: ContactRequirement[]): string[] {
  return reqs.flatMap((r, i) => {
    if ((counts[i] ?? 0) >= r.per_month) return []
    const per = r.period && r.period !== 'month' ? ` per ${r.period}` : ''
    return [`${r.label} (${counts[i] ?? 0} of ${r.per_month}${per})`]
  })
}

/** 'YYYY-MM' for a local date. */
export function monthKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
