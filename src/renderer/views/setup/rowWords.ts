/**
 * "Each line of your spreadsheet is one…": the choices, and guesses from the
 * list's name, the file's name and its column names (UX Q1a).
 */
import type { RecordKind } from '../../../shared/types'
import { NEUTRAL_WORDS, wordsFromListName } from '../../../shared/listWords'

/** "What are these rows?" choices: the word for one and many, and what the list holds */
export const ROW_CHOICES: Array<{ one: string; many: string; kind: RecordKind }> = [
  { one: 'client', many: 'clients', kind: 'person' },
  { one: 'customer', many: 'customers', kind: 'person' },
  { one: 'student', many: 'students', kind: 'person' },
  { one: 'patient', many: 'patients', kind: 'person' },
  { one: 'staff member', many: 'staff', kind: 'person' },
  { one: 'vehicle', many: 'vehicles', kind: 'thing' },
  { one: 'property', many: 'properties', kind: 'thing' },
  { one: 'piece of equipment', many: 'equipment', kind: 'thing' },
  { one: 'job', many: 'jobs', kind: 'job' },
]

export type RowsAnswer = {
  choice: number | 'other' | null
  one: string
  many: string
  kind: RecordKind
  /** A guess from the list's name, offered as a suggestion — never filled in silently (UX-A-01) */
  suggested?: { one: string; many: string }
}

export const NO_ANSWER: RowsAnswer = { choice: null, one: '', many: '', kind: 'person' }

/**
 * "What are these rows?" starts from the list's name: a known word ("Customers") is ticked,
 * an unknown one ("Tenants") is only suggested, and a generic name ("My caseload") asks.
 */
export function guessRows(listName: string): RowsAnswer {
  const g = wordsFromListName(listName)
  if (g.one === NEUTRAL_WORDS.one) return NO_ANSWER
  const i = ROW_CHOICES.findIndex(c => c.one === g.one || c.many === g.many)
  if (i >= 0) return { ...NO_ANSWER, choice: i, kind: ROW_CHOICES[i]!.kind }
  return { ...NO_ANSWER, suggested: g }
}

/** Column names that give away what each line is, checked in this order */
const HEADER_HINTS: Array<{ one: string; re: RegExp }> = [
  { one: 'client', re: /\bclients?\b/i },
  { one: 'student', re: /\bstudents?\b/i },
  { one: 'patient', re: /\bpatients?\b|\bmrn\b/i },
  { one: 'customer', re: /\bcustomers?\b/i },
  { one: 'vehicle', re: /\bvin\b|\bmake\b|\bmodel\b|\bvehicles?\b|\blicen[cs]e plate\b/i },
  { one: 'property', re: /\bpropert(y|ies)\b|\bunit\b/i },
  { one: 'staff member', re: /\bemployees?\b|\bstaff\b/i },
  { one: 'job', re: /\bjobs?\b|\bwork order\b/i },
]

/** The choice the column names point to ("Client ID" → clients, "VIN" → vehicles), or null */
export function guessRowsFromHeaders(headers: readonly string[]): number | null {
  let best: { one: string; hits: number } | null = null
  for (const hint of HEADER_HINTS) {
    const hits = headers.filter(h => hint.re.test(h)).length
    if (hits > 0 && (!best || hits > best.hits)) best = { one: hint.one, hits }
  }
  if (!best) return null
  const i = ROW_CHOICES.findIndex(c => c.one === best.one)
  return i >= 0 ? i : null
}

/** The list's name first, then the column names; a guess from the headers is ticked */
export function guessRowsFor(listName: string, headers: readonly string[]): RowsAnswer {
  const fromName = guessRows(listName)
  if (fromName.choice !== null || fromName.suggested) return fromName
  const i = guessRowsFromHeaders(headers)
  return i === null ? NO_ANSWER : { ...NO_ANSWER, choice: i, kind: ROW_CHOICES[i]!.kind }
}

/** "caseload_export.xlsx" → "Caseload export": a list name from the file's name */
export function listNameFromFile(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? ''
  const name = base.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60).trim()
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : ''
}
