/**
 * When a switched-off feature offers to turn itself on (UX pass Phase 2, Q1b).
 * Someone searches Help for it, puts a monthly rule on a "Contact" column, adds
 * a "Next appointment" column or writes "45 min" in a note: Pulse offers the
 * feature once, in one line, with "Turn on" and "Not now".
 *
 * Keyed by FeatureKey, like FEATURE_PLACES, so a new feature without a line
 * here fails typecheck. The order of the entries decides which feature wins
 * when one action points at several.
 *
 * Messages may hold {word} tokens; show them through useVocab().f.
 */
import { assertNever } from './assertNever'
import type { ColumnType } from './columnTraits'
import { FEATURES, type FeatureKey } from './features'
import type { RuleInterval } from './ruleInterval'

export const SUGGESTION_TRIGGERS = ['help', 'columnAdded', 'ruleSet', 'noteText'] as const
export type SuggestionTrigger = typeof SUGGESTION_TRIGGERS[number]

export interface FeatureSuggestion {
  /** Extra words that point at this feature in a Help search (its label always counts) */
  helpWords: readonly string[]
  /** A new column whose name matches (and whose type is listed, if given) */
  column?: { name: RegExp; types?: readonly ColumnType[] }
  /** A deadline rule of at most `maxDays` (a month counts as 31) put on a column whose name matches */
  rule?: { name: RegExp; maxDays: number }
  /** Words in a saved note */
  noteText?: RegExp
  /** The one-line offer */
  message: string
  /** The offer in Help, when `message` only makes sense next to a note */
  helpMessage?: string
}

/** "Spent 45 min", "1.5 hours" */
const TIME_IN_NOTE = /\b\d[\d.]*\s?(min|mins|minutes|hr|hrs|hour|hours)\b/i
/** "Drove 12 miles" */
const MILES_IN_NOTE = /\b\d[\d.]*\s?(mi|miles|mile)\b/i

export const FEATURE_SUGGESTIONS: Record<FeatureKey, FeatureSuggestion> = {
  // Before requirements, so a Help search for "contact" offers the directory;
  // "contacts per month" still finds requirements
  contactsDirectory: {
    helpWords: ['contact', 'provider', 'doctor', 'pharmacy', 'agency', 'directory', 'referral'],
    column: { name: /\b(doctor|physician|pcp|provider|pharmacy|therapist|psychiatrist|case manager|guardian|payee|agency)/i },
    message: 'Keep {contact:many} like doctors and agencies in one place, and link them to each {record}? Turn on the {ContactDirectory} page.',
  },
  requirements: {
    helpWords: ['requirement', 'minimum', 'how many visits', 'contacts per month', 'monthly contact', 'quota', 'behind'],
    rule: { name: /contact|visit|\bcalls?\b|check[- ]?in|face[- ]to[- ]face|\bseen\b|touch/i, maxDays: 31 },
    message: 'Want Pulse to count how many {activity:many} each {record} gets per month, and show who\'s behind? Turn on {Requirement:many}.',
  },
  timeTracking: {
    helpWords: ['time', 'minutes', 'units', 'billing', 'hours'],
    noteText: TIME_IN_NOTE,
    message: 'This {activity} mentions time. Record minutes on {activity:many} and total them each month?',
    helpMessage: 'Record minutes on {activity:many} and total them each month? Turn on Time on {activity:many}.',
  },
  mileage: {
    helpWords: ['mileage', 'miles', 'drive', 'travel', 'reimbursement'],
    noteText: MILES_IN_NOTE,
    message: 'This {activity} mentions miles. Record mileage on {activity:many} for your monthly claim? (This one won\'t have them; add miles when you edit it.)',
    helpMessage: 'Record miles on {activity:many} for your monthly mileage claim? Turn on Mileage on {activity:many}.',
  },
  appointments: {
    helpWords: ['appointment', 'schedule', 'meeting', 'session', 'calendar'],
    column: { name: /\b(appointments?|appts?|next visit|scheduled|meetings?|sessions?)\b/i, types: ['date'] },
    noteText: /\b(appt|appointment)\b[^.]{0,40}\b\d{1,2}[/:]\d{1,2}/i,
    message: 'Put {appointment:many} on the calendar with a time and a reminder? Turn on {Appointment:many}.',
  },
  personFields: {
    helpWords: ['age', 'birthday', 'date of birth', 'dob'],
    column: { name: /birth|\bdob\b|\bborn\b/i, types: ['date'] },
    message: 'Show each {record}\'s age from their date of birth? Turn on People details.',
  },
  priority: {
    helpWords: ['priority', 'acuity', 'risk', 'urgency', 'level of need', 'triage'],
    column: { name: /acuity|priority|risk level|level of care|\btier\b/i },
    message: 'Score how much attention each {record} needs, and sort by it? Turn on {Priority:many}.',
  },
  stages: {
    helpWords: ['board', 'kanban', 'stage', 'pipeline', 'workflow', 'step'],
    column: { name: /^\s*(stage|status|phase|step)\s*$/i, types: ['dropdown', 'status'] },
    message: 'See these as columns on a board, and drag each {record} along? Turn on Stages and board.',
  },
  attachments: {
    helpWords: ['file', 'attach', 'document', 'photo', 'scan', 'pdf', 'upload'],
    column: { name: /document|attachment|\bfiles?\b|\bscans?\b|photo/i },
    message: 'Keep files and photos with each {record}, stored encrypted inside Pulse? Turn on Files.',
  },
  links: {
    helpWords: ['link', 'connect', 'household', 'family', 'related'],
    message: 'Connect your {list:many}, like customers and their vehicles?',
  },
  checklists: {
    helpWords: ['checklist', 'steps', 'intake steps'],
    message: 'Step-by-step checklists on each {record}? Turn on Checklists.',
  },
  tasks: {
    helpWords: ['task', 'to-do', 'todo'],
    message: 'Your own to-do list, with repeating tasks? Turn on Tasks.',
  },
  notifications: {
    helpWords: ['notification', 'remind me', 'desktop', 'morning reminder'],
    message: 'Want a desktop notification each morning? Turn on Reminders.',
  },
  focusMode: {
    helpWords: ['focus', 'one at a time', 'distraction'],
    message: 'Go through what needs attention one at a time? Turn on Focus mode.',
  },
  letters: {
    helpWords: ['letter', 'mail merge', 'envelope', 'label', 'template'],
    message: 'Fill in letters from templates for each {record}? Turn on Letters and documents.',
  },
  summaryReport: {
    helpWords: ['supervisor', 'monthly report', 'activity report'],
    message: 'A report of {activity:many} and deadlines for your supervisor? Turn on Summary report.',
  },
  handoff: {
    helpWords: ['handoff', 'transfer', 'packet', 'discharge', 'hand over'],
    message: 'One PDF with everything about {a record}, for a transfer? Turn on Handoff packet.',
  },
  forms: {
    helpWords: ['form', 'intake form', 'questionnaire'],
    message: 'Fill in or print a form to add or update {a record}? Turn on Forms.',
  },
  // No note trigger: a "$" in a note is too common to mean "track costs"
  measures: {
    helpWords: ['labor', 'cost', 'parts', 'measure'],
    message: 'Add your own numbers, like labor hours or parts cost, to {activity:many}? Turn on Your own numbers.',
  },
  snippets: {
    helpWords: ['snippet', 'shortcut', 'canned text', 'slash'],
    message: 'Type a short code to insert text you use often? Turn on Snippets.',
  },
}

export type SuggestionInput =
  | { trigger: 'help'; query: string; fill: (text: string) => string }
  | { trigger: 'columnAdded'; name: string; type: ColumnType }
  | { trigger: 'ruleSet'; name: string; interval: RuleInterval }
  | { trigger: 'noteText'; text: string }

/** The offer for this trigger, with its {word} tokens still in */
export function suggestionMessage(key: FeatureKey, trigger: SuggestionTrigger): string {
  const s = FEATURE_SUGGESTIONS[key]
  return trigger === 'help' ? s.helpMessage ?? s.message : s.message
}

/** Words that say nothing about a feature ("how do I turn on the …") */
const STOP_WORDS = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'on', 'in', 'to', 'for', 'my', 'i', 'how', 'do', 'does', 'can', 'is', 'it', 'what', 'where', 'why', 'with', 'turn', 'use', 'see', 'show', 'find', 'get', 'add', 'make', 'set', 'up'])

/** The list's own words in a label ("Time on {activity:many}") don't name the feature */
const GENERAL_WORD_TOKENS = /\{(?:a |A )?(?:record|list|activity|activityLog|contact|worker|archive)(?::many)?\}/gi

function words(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
}

/** How well an action points at a feature */
const NO_MATCH = 0
const BY_PREFIX = 1
const WHOLE_WORDS = 2

function sameWord(a: string, b: string): boolean {
  return a === b || a === `${b}s` || b === `${a}s`
}

function helpMatch(key: FeatureKey, label: string, query: string, fill: (text: string) => string): number {
  const wanted = words(query).filter(w => !STOP_WORDS.has(w))
  if (wanted.length === 0) return NO_MATCH
  const tokens = [...words(fill(label.replace(GENERAL_WORD_TOKENS, ''))), ...FEATURE_SUGGESTIONS[key].helpWords.flatMap(words)]
  if (wanted.every(w => tokens.some(t => sameWord(t, w)))) return WHOLE_WORDS
  // "mile" finds mileage; one or two letters only count as a whole word, so typing "m" offers nothing
  return wanted.every(w => w.length >= 3 && tokens.some(t => t.startsWith(w))) ? BY_PREFIX : NO_MATCH
}

/** A month counts as 31 days; an interval of nothing (the date is the deadline) never counts */
function intervalDays(iv: RuleInterval): number {
  return iv.days + iv.months * 31
}

function match(key: FeatureKey, label: string, input: SuggestionInput): number {
  const s = FEATURE_SUGGESTIONS[key]
  const yes = (b: boolean): number => (b ? WHOLE_WORDS : NO_MATCH)
  switch (input.trigger) {
    case 'help':
      return helpMatch(key, label, input.query, input.fill)
    case 'columnAdded':
      return yes(!!s.column && s.column.name.test(input.name) && (!s.column.types || s.column.types.includes(input.type)))
    case 'ruleSet': {
      const days = intervalDays(input.interval)
      return yes(!!s.rule && days > 0 && days <= s.rule.maxDays && s.rule.name.test(input.name))
    }
    case 'noteText':
      return yes(!!s.noteText && s.noteText.test(input.text))
    default:
      return assertNever(input, 'suggestion trigger')
  }
}

/**
 * The first switched-off feature this action points at, or null. In Help a
 * feature named by whole words beats one found by the start of a word, so
 * "age" offers People details, not the directory's "agency".
 */
export function suggestFeature(input: SuggestionInput, isOff: (k: FeatureKey) => boolean): FeatureKey | null {
  let best: FeatureKey | null = null
  let bestScore = NO_MATCH
  for (const key of Object.keys(FEATURE_SUGGESTIONS) as FeatureKey[]) {
    const def = FEATURES.find(f => f.key === key)
    if (!def?.available || !isOff(key)) continue
    const score = match(key, def.label, input)
    if (score === WHOLE_WORDS) return key
    if (score > bestScore) { best = key; bestScore = score }
  }
  return best
}
