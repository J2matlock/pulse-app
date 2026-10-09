/**
 * The words Pulse uses for the things people track, so a caseworker sees
 * "clients" and a shop owner sees "customers" everywhere, PDFs included.
 *
 * Resolution order: a list's own words → workspace words → generic words.
 * See plans/generalization/W01-workspace.md §2.
 */
import { z } from 'zod'

export type VocabKey =
  | 'record' | 'list' | 'activity' | 'activityLog' | 'contactDirectory' | 'contact'
  | 'priority' | 'archive' | 'worker' | 'requirement' | 'appointment' | 'stage'

export interface Term {
  one: string
  many: string
  /** Article for `one` ("a client", "an item") */
  article: 'a' | 'an'
  /** Override when simple capitalization is wrong (e.g. "IEP") */
  oneCap?: string
  manyCap?: string
}

export type Vocab = Record<VocabKey, Term>

const w = (one: string, many: string, article: 'a' | 'an' = 'a', caps: Pick<Term, 'oneCap' | 'manyCap'> = {}): Term =>
  ({ one, many, article, ...caps })

/** Words for a new, blank workspace. */
export const GENERIC_VOCAB: Vocab = {
  record: w('record', 'records'),
  list: w('list', 'lists'),
  activity: w('note', 'notes'),
  activityLog: w('activity log', 'activity logs', 'an'),
  contactDirectory: w('contacts', 'contacts', 'a', { oneCap: 'Contacts', manyCap: 'Contacts' }),
  contact: w('contact', 'contacts'),
  priority: w('priority level', 'priority levels'),
  archive: w('archive', 'archives', 'an'),
  worker: w('worker', 'workers'),
  requirement: w('requirement', 'requirements'),
  appointment: w('appointment', 'appointments', 'an'),
  stage: w('stage', 'stages'),
}

/** Today's words. Existing installs are saved with these (migration 036). */
export const HUMAN_SERVICES_VOCAB: Vocab = {
  ...GENERIC_VOCAB,
  record: w('client', 'clients'),
  list: w('caseload', 'caseloads'),
  activity: w('case note', 'case notes'),
  activityLog: w('case log', 'case logs'),
  contact: w('provider', 'providers'),
  priority: w('acuity level', 'acuity levels', 'an'),
  worker: w('case manager', 'case managers'),
  requirement: w('contact requirement', 'contact requirements'),
}

export const VOCAB_WORD_MAX = 40

const wordSchema = z.string().trim().min(1).max(VOCAB_WORD_MAX).regex(/^[^<>{}]+$/, 'Words cannot contain < > { }')
const termSchema = z.object({
  one: wordSchema,
  many: wordSchema,
  article: z.enum(['a', 'an']),
  oneCap: wordSchema.optional(),
  manyCap: wordSchema.optional(),
}).strict()

const VOCAB_KEYS = Object.keys(GENERIC_VOCAB) as VocabKey[]

/** Partial word sets as stored in settings and on lists. */
export const vocabSchema = z.object(
  Object.fromEntries(VOCAB_KEYS.map(k => [k, termSchema.optional()])) as Record<VocabKey, z.ZodOptional<typeof termSchema>>,
).strict()

/** "a"/"an" by spelling; good enough as a default the user can override. */
export function guessArticle(word: string): 'a' | 'an' {
  return /^[aeiou]/i.test(word.trim()) && !/^(uni|use|eu|one)/i.test(word.trim()) ? 'an' : 'a'
}

/** Later layers win; missing keys fall back to GENERIC_VOCAB. */
export function resolveVocab(...layers: Array<Partial<Vocab> | null | undefined>): Vocab {
  const out: Vocab = { ...GENERIC_VOCAB }
  for (const layer of layers) {
    if (!layer) continue
    for (const k of VOCAB_KEYS) {
      const t = layer[k]
      if (t) out[k] = t
    }
  }
  return out
}

/** Parse stored JSON safely; invalid or empty values are ignored. */
export function parseVocab(json: string | null | undefined): Partial<Vocab> | null {
  if (!json) return null
  try {
    const parsed = vocabSchema.safeParse(JSON.parse(json))
    return parsed.success ? parsed.data as Partial<Vocab> : null
  } catch {
    return null
  }
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export interface TermOptions {
  /** Plural form */
  many?: boolean
  /** Picks singular or plural from a count (1 → one, else many) */
  count?: number
  /** Capitalize the first letter (sentence start, titles) */
  cap?: boolean
  /** Prefix "a"/"an" (singular only) */
  article?: boolean
}

/**
 * term(v, 'record')                    → "client"
 * term(v, 'record', { count: 3 })      → "clients"
 * term(v, 'record', { article: true }) → "a client"
 * term(v, 'record', { many: true, cap: true }) → "Clients"
 */
export function term(v: Vocab, key: VocabKey, opts: TermOptions = {}): string {
  const t = v[key]
  const plural = opts.count !== undefined ? opts.count !== 1 : !!opts.many
  let word = plural ? t.many : t.one
  if (opts.cap) word = plural ? (t.manyCap ?? capitalize(t.many)) : (t.oneCap ?? capitalize(t.one))
  if (opts.article && !plural) {
    const art = opts.cap ? capitalize(t.article) : t.article
    // "A Client" reads oddly; keep the noun as typed after a capitalized article
    return `${art} ${opts.cap ? t.one : word}`
  }
  return word
}

const KEY_BY_LOWER = new Map(VOCAB_KEYS.map(k => [k.toLowerCase(), k]))

/**
 * Fill word tokens in static text (tour steps, help, shortcut lists):
 *   {record} → "client"        {record:many} → "clients"
 *   {Record} → "Client"        {Record:many} → "Clients"
 *   {a record} → "a client"    {A record} → "A client"
 * Unknown tokens are left as typed. Words can't contain braces (vocabSchema),
 * so a filled word never creates a new token.
 */
export function fillVocab(text: string, v: Vocab): string {
  return text.replace(/\{(a |A )?([a-zA-Z]+)(:many)?\}/g, (whole, art: string | undefined, name: string, many: string | undefined) => {
    const key = KEY_BY_LOWER.get(name.toLowerCase())
    if (!key) return whole
    const cap = /^[A-Z]/.test(name)
    if (art) {
      const phrase = term(v, key, { article: true })
      return art === 'A ' ? capitalize(phrase) : phrase
    }
    return term(v, key, { many: !!many, cap })
  })
}
