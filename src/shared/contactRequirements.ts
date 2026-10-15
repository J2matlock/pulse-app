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

/** Plurals that don't just add -s (or that shouldn't change at all) */
const IRREGULAR_PLURALS: Record<string, string> = {
  child: 'children', person: 'people', 'face-to-face': 'face-to-face', 'in-person': 'in-person', staff: 'staff',
}

/** "visit" → "visits", "family" → "families", "class" → "classes"; a word already plural stays */
export function pluralWord(w: string): string {
  const lower = w.toLowerCase()
  const irregular = IRREGULAR_PLURALS[lower]
  if (irregular) return w === w.toUpperCase() && w !== lower ? irregular.toUpperCase() : irregular
  if (/[^aeiou]y$/i.test(w)) return `${w.slice(0, -1)}ies`
  if (/(s|x|z|ch|sh)$/i.test(w)) return /[^s]s$/i.test(w) && !/(ss|us|is)$/i.test(w) ? w : `${w}es`
  return `${w}s`
}

/**
 * How a requirement reads (persona study R7): "4 counseling sessions a month",
 * "1 face-to-face visit a month", "2 contacts (any kind) a week". The last word
 * before any brackets is made plural when the number isn't 1; words in capitals
 * (IEP) keep them.
 */
export function requirementPhrase(r: Pick<ContactRequirement, 'per_month' | 'label'> & { period?: string | null }): string {
  const label = r.label.trim().split(/\s+/).map(w => (w.length > 1 && w === w.toUpperCase() ? w : w.toLowerCase())).join(' ')
  const cut = label.indexOf('(')
  const head = (cut === -1 ? label : label.slice(0, cut)).trimEnd()
  const tail = cut === -1 ? '' : ` ${label.slice(cut)}`
  const words = head.split(' ')
  if (r.per_month !== 1 && words.length > 0) {
    const last = words.pop()!
    // "check-in" → "check-ins": the plural goes on the last part of a hyphenated word, unless it's a set phrase
    const parts = last.split('-')
    words.push(IRREGULAR_PLURALS[last.toLowerCase()] !== undefined || parts.length === 1 ? pluralWord(last) : [...parts.slice(0, -1), pluralWord(parts[parts.length - 1]!)].join('-'))
  }
  return `${r.per_month} ${words.join(' ')}${tail} a ${r.period ?? 'month'}`
}

/** 'YYYY-MM' for a local date. */
export function monthKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
