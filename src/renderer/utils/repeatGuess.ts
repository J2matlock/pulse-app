/**
 * Which dates come due again, guessed from a column's name. Shared by setup's
 * "Which of these dates repeat?" and the import summary (UX Q1a).
 */

export type DateAnswer = { repeat: 'no' } | { repeat: 'due' } | { repeat: 'every'; n: number; unit: 'days' | 'months' | 'years' }

/**
 * The likely answer from a column's name, so most people can just click on:
 * "Due date", "Expires", "Renewal" → it's the due date; "Last contact", "Home
 * visit", "Seen" → due again every month; "Annual review", "Recert", "Plan of
 * care", "ISP" → every year; a birthday or anything else → no reminder. A
 * contact column guessed as yearly showed no colour for eleven months
 * (UX-A-08), so contacts come before "last".
 */
export function suggestRepeat(name: string): DateAnswer {
  const n = name.toLowerCase()
  if (/birth|\bdob\b|born/.test(n)) return { repeat: 'no' }
  if (/\bdue\b|expir|deadline|\bends?\b|renew/.test(n)) return { repeat: 'due' }
  if (/contact|visit|\bcall|check[- ]?in|touch|\bseen\b|face[- ]to[- ]face/.test(n)) return { repeat: 'every', n: 1, unit: 'months' }
  if (/annual|yearly|review|assess|\blast\b|service|inspect|recert|redetermination|authori[sz]ation|plan of care|\bisp\b/.test(n)) return { repeat: 'every', n: 1, unit: 'years' }
  return { repeat: 'no' }
}

/**
 * How many days before it's due the cell turns yellow. Mirrors the standard rules
 * setup makes (src/main/builtin-templates.ts): short cycles up to a month warn a
 * week ahead, 90 days two weeks ahead, half a year or more a month ahead.
 */
export function yellowDaysBefore(answer: DateAnswer): number {
  if (answer.repeat === 'no') return 0
  if (answer.repeat === 'due') return 14
  const months = answer.unit === 'years' ? answer.n * 12 : answer.unit === 'months' ? answer.n : null
  if (months === 6 || months === 12) return 30
  if (months === null && (answer.n === 30 || answer.n === 60)) return 7
  if (months === null && answer.n === 90) return 14
  const days = months !== null ? months * 30 : answer.n
  return days <= 31 ? 7 : days <= 120 ? 14 : 30
}

/** "every month", "every 6 months", "every year" */
export function everyPhrase(n: number, unit: 'days' | 'months' | 'years'): string {
  const one = unit.slice(0, -1)
  return n === 1 ? `every ${one}` : `every ${n} ${unit}`
}

/** A guess for each date column, keyed by its id */
export function guessRepeats(columns: ReadonlyArray<{ id: number; name: string }>): Record<number, DateAnswer> {
  return Object.fromEntries(columns.map(c => [c.id, suggestRepeat(c.name)]))
}

/**
 * The answers as one sentence: "Last visit repeats every month and Annual
 * review every year." Null when no date has a reminder.
 */
export function describeRepeats(columns: ReadonlyArray<{ id: number; name: string }>, answers: Record<number, DateAnswer>): string | null {
  const every: string[] = []
  const due: string[] = []
  for (const c of columns) {
    const a = answers[c.id]
    if (!a || a.repeat === 'no') continue
    if (a.repeat === 'due') due.push(c.name)
    else every.push(`${every.length === 0 ? `${c.name} repeats` : c.name} ${everyPhrase(a.n, a.unit)}`)
  }
  const parts = [...every]
  if (due.length > 0) parts.push(`${andList(due)} ${due.length === 1 ? 'is a due date' : 'are due dates'}`)
  if (parts.length === 0) return null
  return `${andList(parts)}.`
}

/** "a", "a and b", "a, b and c" */
function andList(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}
