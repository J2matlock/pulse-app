/**
 * Guess the words for one record and for many from a list's name, for the
 * guided blank start: "Customers" → customer / customers, "My clients" →
 * client / clients. People can always correct the guess.
 */
import { VOCAB_WORD_MAX } from './vocab'

const KNOWN: Record<string, [one: string, many: string]> = {
  staff: ['staff member', 'staff'],
  equipment: ['piece of equipment', 'equipment'],
  people: ['person', 'people'],
  children: ['child', 'children'],
  inventory: ['item', 'items'],
  stock: ['item', 'items'],
}

/**
 * Names that describe the container, not what's in it. "My caseload" holds clients, not
 * caseloads; guessing the name itself turned every button into "Add Caseload" (UX-A-01).
 * These get the neutral words and the next screen asks.
 */
const COLLECTIVE = new Set([
  'caseload', 'caseloads', 'roster', 'rosters', 'panel', 'panels', 'case', 'cases', 'list', 'lists',
  'team', 'teams', 'group', 'groups', 'sheet', 'sheets', 'spreadsheet', 'spreadsheets', 'record', 'records',
  'data', 'database', 'tracker', 'trackers', 'log', 'logs', 'register', 'registers', 'directory', 'file', 'files',
  'workload', 'portfolio', 'pipeline', 'queue', 'schedule',
])

export const NEUTRAL_WORDS = { one: 'record', many: 'records' } as const

/**
 * Why typed words for one and many can't be saved yet, or null when they can. The same
 * word for both ("caseload / caseload") breaks every count in the app (UX-A-01, UX-A-32).
 */
export function ownWordsProblem(one: string, many: string): string | null {
  if (!one.trim()) return 'Type what you call one of them.'
  if (!many.trim()) return 'Type what you call more than one of them.'
  if (one.trim().toLowerCase() === many.trim().toLowerCase()) {
    return `The word for one and for more than one are the same ("${one.trim()}"). Both are needed, like "member" and "members", so they can be counted.`
  }
  return null
}

export function wordsFromListName(name: string): { one: string; many: string } {
  const base = name.trim().replace(/^(my|our|the|all)\s+/i, '').toLowerCase().slice(0, VOCAB_WORD_MAX)
  if (!base) return { ...NEUTRAL_WORDS }
  const known = KNOWN[base]
  if (known) return { one: known[0], many: known[1] }
  // "Client caseload", "Housing roster": the last word says what kind of name it is
  const lastWord = base.split(/\s+/).pop() ?? base
  if (COLLECTIVE.has(lastWord)) return { ...NEUTRAL_WORDS }
  let one = base
  if (/[^aeiou]ies$/.test(base)) one = `${base.slice(0, -3)}y`
  else if (/(ss|x|z|ch|sh)es$/.test(base)) one = base.slice(0, -2)
  else if (/[^s]s$/.test(base)) one = base.slice(0, -1)
  // No plural form ("Glass", "Housing"): one word for one and many breaks every count ("4 glass")
  if (one === base) return { ...NEUTRAL_WORDS }
  return { one, many: base }
}
