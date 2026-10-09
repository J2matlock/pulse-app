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

export function wordsFromListName(name: string): { one: string; many: string } {
  const base = name.trim().replace(/^(my|our|the|all)\s+/i, '').toLowerCase().slice(0, VOCAB_WORD_MAX)
  if (!base) return { one: 'record', many: 'records' }
  const known = KNOWN[base]
  if (known) return { one: known[0], many: known[1] }
  let one = base
  if (/[^aeiou]ies$/.test(base)) one = `${base.slice(0, -3)}y`
  else if (/(ss|x|z|ch|sh)es$/.test(base)) one = base.slice(0, -2)
  else if (/[^s]s$/.test(base)) one = base.slice(0, -1)
  return { one, many: base }
}
