/**
 * Starter templates: the `.pulse` v2.0 workspace format (W01 §4.1).
 *
 * A starter is a ready-made setup (lists, columns, deadline rules,
 * checklists, words, feature switches, optional sample data) that people can
 * apply in whole or in part. Built-in starters live next to this file as JSON;
 * people can also open and share them as files.
 *
 * Parts of the format that later phases add (links, stages, forms, …) are
 * rejected with a "needs a newer version" message until this version of
 * Pulse can apply them.
 */
import { z } from 'zod'
import { textLength } from '../textLength'
import { RULE_KINDS } from '../deadlineEngine'
import { CARDINALITIES } from '../links'
import { APPT_STATUSES } from '../appointments'
import { vocabSchema, type VocabKey } from '../vocab'
import { featureMapSchema, type FeatureKey } from '../features'
import { ACTIVITY_COLORS } from '../activityTypes'
import { MAX_ACTIVE_MEASURES, measureDefSchema } from '../measures'
import { PERIOD_MAX, PERIODS } from '../periods'
import { DISPLAY_FORMAT_MAX } from '../displayFormat'
import { portableStageSchema } from '../stages'

export const STARTER_FORMAT = '2.0'
/** Files larger than this are refused before parsing */
export const MAX_STARTER_BYTES = 2 * 1024 * 1024

/** Keys reserved for later phases; a file using them needs a newer Pulse */
const FUTURE_STARTER_KEYS: string[] = []
const FUTURE_LIST_KEYS: string[] = []

const text = (max: number) => z.string().trim().check(textLength({ min: 1, max }))
const optionalText = (max: number) => z.string().check(textLength({ max })).nullable().optional()
const key = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'Keys use lowercase letters, numbers and dashes')

const columnSchema = z.object({
  name: text(100),
  column_type: z.string().check(textLength({ max: 40 })),
  width: z.number().int().min(40).max(1000).optional(),
  position: z.number().int().min(0).max(500),
  is_name_column: z.number().int().min(0).max(1).optional(),
  is_identifier: z.number().int().min(0).max(1).optional(),
  /** Empty cells show "Missing" (ignored for column types that can't be required) */
  is_required: z.number().int().min(0).max(1).optional(),
  default_value: optionalText(1000),
  description: optionalText(1000),
  /** JSON; may name rules and checklists (alert_rule_name, done_checklist_name) */
  config: z.string().check(textLength({ max: 10_000 })).optional(),
}).strict()

const alertRuleSchema = z.object({
  name: text(100),
  description: optionalText(500),
  thresholds: z.string().check(textLength({ max: 10_000 })),
  interval_days: z.number().int().min(0).max(3650).nullable().optional(),
  interval_months: z.number().int().min(0).max(120).nullable().optional(),
  end_of_month: z.number().int().min(0).max(1).nullable().optional(),
  /** W05 kinds; settings name columns as { "column": "Referral date" } */
  kind: z.enum(RULE_KINDS).optional(),
  rule_config: z.string().check(textLength({ max: 10_000 })).nullable().optional(),
  rule_condition: z.string().check(textLength({ max: 2_000 })).nullable().optional(),
  business_days: z.number().int().min(0).max(2).optional(),
}).strict()

const checklistSchema = z.object({
  name: text(100),
  description: optionalText(500),
  items: z.string().check(textLength({ max: 10_000 })),
  is_recurring: z.number().int().min(0).max(1).optional(),
  recurrence_days: z.number().int().min(1).max(3650).nullable().optional(),
}).strict()

const requirementSchema = z.object({
  label: text(100),
  note_types: z.array(z.string().check(textLength({ max: 40 }))).min(1).max(10),
  /** How many per period (the name is kept from the monthly-only format) */
  per_month: z.number().int().min(1).max(365),
  period: z.enum(PERIODS).optional(),
}).strict().refine(r => r.per_month <= PERIOD_MAX[r.period ?? 'month'], { message: 'Too many per period' })

/** A note type to add (W03 §5); matched to the workspace's types by key */
const activityTypeSchema = z.object({
  key: z.string().regex(/^[a-z0-9_]{1,30}$/),
  label: text(40),
  icon: z.string().check(textLength({ max: 16 })).optional(),
  color: z.enum(ACTIVITY_COLORS).optional(),
}).strict()

/** A link from this list to another list of the starter (W04 §8), by key */
const linkSchema = z.object({
  /** Key of the list on the other side; may be this list (household members) */
  to: key,
  label_forward: text(60),
  label_backward: text(60),
  cardinality: z.enum(CARDINALITIES).default('many_to_one'),
  /** Also add a column on the other list (default yes) */
  showOnOther: z.boolean().optional(),
}).strict()

/** A form on a list (W08 §6), its fields naming columns */
const starterFormSchema = z.object({
  name: text(200),
  intro: optionalText(2000),
  log_activity_type: z.string().regex(/^[a-z0-9_]{1,30}$/).nullable().optional(),
  fields: z.array(z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('column'), column: text(100), label: z.string().check(textLength({ max: 200 })).optional(), help: z.string().check(textLength({ max: 500 })).optional(), required: z.boolean().optional(), width: z.enum(['full', 'half']).optional() }).strict(),
    z.object({ kind: z.literal('section'), title: text(200), text: z.string().check(textLength({ max: 1000 })).optional() }).strict(),
    z.object({ kind: z.literal('note'), label: text(200), help: z.string().check(textLength({ max: 500 })).optional(), required: z.boolean().optional() }).strict(),
  ])).min(1).max(80),
}).strict()
export type StarterForm = z.infer<typeof starterFormSchema>

const listSchema = z.object({
  key,
  name: text(200),
  description: optionalText(500),
  kind: z.enum(['person', 'thing', 'job']),
  vocab: vocabSchema.optional(),
  columns: z.array(columnSchema).min(1).max(100),
  alertRules: z.array(alertRuleSchema).max(50).optional(),
  checklists: z.array(checklistSchema).max(50).optional(),
  requirements: z.array(requirementSchema).max(20).optional(),
  /** How each record's name is shown, e.g. "{Year} {Make} {Model}" (W02 §3) */
  displayFormat: z.string().check(textLength({ max: DISPLAY_FORMAT_MAX })).optional(),
  links: z.array(linkSchema).max(20).optional(),
  /** Which column is the stage, and its settings (W06 §8) */
  stage: portableStageSchema.extend({ column: text(100) }).optional(),
  forms: z.array(starterFormSchema).max(20).optional(),
}).strict()

const sampleValue = z.union([z.string().check(textLength({ max: 1000 })), z.number(), z.null(), z.object({ daysFromToday: z.number().int().min(-36500).max(3650) }).strict()])

const sampleDataSchema = z.object({
  /** list key → records, each a column name → value map */
  records: z.record(z.string(), z.array(z.record(z.string(), sampleValue)).max(200)),
  activities: z.array(z.object({
    /** "<list key>#<index>" */
    record: z.string().regex(/^[a-z0-9-]+#\d+$/),
    type: z.string().check(textLength({ max: 40 })),
    daysAgo: z.number().int().min(0).max(3650),
    text: text(5000),
  }).strict()).max(1000).optional(),
  /** Sample links: "<list key>#<index>" to "<list key>#<index>", by the from-list's link name */
  links: z.array(z.object({
    from: z.string().regex(/^[a-z0-9-]+#\d+$/),
    to: z.string().regex(/^[a-z0-9-]+#\d+$/),
    link: text(60),
  }).strict()).max(2000).optional(),
  /**
   * Earlier values of a column, oldest first (odometer readings, stage
   * changes), so forecasts and "days in stage" have something to go on. The
   * last value is normally the record's current one.
   */
  history: z.array(z.object({
    record: z.string().regex(/^[a-z0-9-]+#\d+$/),
    column: text(100),
    values: z.array(z.object({ value: z.string().check(textLength({ max: 1000 })), daysAgo: z.number().int().min(0).max(3650) }).strict()).min(1).max(50),
  }).strict()).max(2000).optional(),
  /** Steps already done on a step-by-step deadline column, so the demo isn't all overdue */
  stepsDone: z.array(z.object({
    record: z.string().regex(/^[a-z0-9-]+#\d+$/),
    column: text(100),
    steps: z.number().int().min(1).max(50),
  }).strict()).max(2000).optional(),
  /**
   * Appointments, days from today, so the calendar isn't empty. Without a
   * time it's all day. `repeatWeekly` makes a weekly series of that many.
   * Past ones are marked done unless `status` says otherwise. Each is about a
   * sample record, so removing the sample data removes it too.
   */
  appointments: z.array(z.object({
    record: z.string().regex(/^[a-z0-9-]+#\d+$/),
    title: text(200),
    dayOffset: z.number().int().min(-365).max(365),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
    minutes: z.number().int().min(5).max(720).optional(),
    type: z.string().regex(/^[a-z0-9_]{1,30}$/).optional(),
    location: z.string().check(textLength({ max: 300 })).optional(),
    repeatWeekly: z.number().int().min(2).max(52).optional(),
    status: z.enum(APPT_STATUSES).optional(),
  }).strict()).max(500).optional(),
}).strict()

const variantSchema = z.object({
  key,
  name: text(100),
  description: text(500),
  lists: z.array(listSchema).min(1).max(10),
  /** Sample records for this variant's columns (instead of the starter's) */
  sampleData: sampleDataSchema.optional(),
}).strict()

export const starterSchema = z.object({
  pulse_template: z.literal(STARTER_FORMAT),
  type: z.literal('workspace'),
  id: key,
  name: text(100),
  description: text(1000),
  /** lucide icon name */
  icon: z.string().regex(/^[a-z0-9-]{1,40}$/),
  group: optionalText(60),
  /** Other words people search for ("daycare", "plumber"), for the gallery search */
  keywords: z.array(text(40)).max(30).optional(),
  vocab: vocabSchema.optional(),
  suggestedFeatures: featureMapSchema.optional(),
  /** Exactly one of `lists` and `variants` */
  lists: z.array(listSchema).min(1).max(50).optional(),
  variants: z.array(variantSchema).min(2).max(20).optional(),
  variantQuestion: optionalText(200),
  activityTypes: z.array(activityTypeSchema).max(30).optional(),
  measures: z.array(measureDefSchema.omit({ archived: true })).max(MAX_ACTIVE_MEASURES).optional(),
  noteFormats: z.array(z.object({ id: key, name: text(60), fields: z.array(text(60)).min(1).max(8) }).strict()).max(20).optional(),
  documentTemplates: z.array(z.object({ name: text(200), content: z.string().check(textLength({ max: 200_000 })) }).strict()).max(50).optional(),
  sampleData: sampleDataSchema.optional(),
  helpTips: z.array(z.object({ title: text(100), body: text(2000) }).strict()).max(20).optional(),
  /** Suggested dashboard cards, in order (W10 §4); applied with the feature switches */
  dashboardCards: z.array(z.string().regex(/^[a-zA-Z]{1,40}$/)).max(20).optional(),
  /**
   * Ready-made reports for a trade's own questions, saved with the lists.
   * Settings are a report's (shared/reports.ts) with columns named, not
   * numbered: "col:Estimate sent on". Checked against the list when added.
   */
  reports: z.array(z.object({
    name: text(100),
    list: key,
    /** One line on what it answers, shown with the report */
    description: optionalText(200),
    /** Shown on the dashboard, when the example's features are turned on (like `dashboardCards`) */
    pinned: z.boolean().optional(),
    config: z.record(z.string(), z.unknown()),
  }).strict()).max(20).optional(),
}).strict().refine(s => (s.lists ? 1 : 0) + (s.variants ? 1 : 0) === 1, { message: 'A starter has either lists or variants' })

export type Starter = z.infer<typeof starterSchema>
export type StarterList = z.infer<typeof listSchema>
export type SampleDataSpec = z.infer<typeof sampleDataSchema>

export type ParseResult = { ok: true; starter: Starter } | { ok: false; error: string }

const NEWER_FILE = 'This example was made with a newer version of Pulse. Update Pulse to open it.'
const NEEDS_NEWER = 'This example needs a newer version of Pulse.'

/** Validate starter data (already JSON-parsed) with messages people can act on. */
export function parseStarter(data: unknown): ParseResult {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: "This isn't a Pulse template file." }
  const obj = data as Record<string, unknown>
  if (obj.type !== 'workspace') return { ok: false, error: "This isn't a Pulse workspace template." }
  const version = typeof obj.pulse_template === 'string' ? obj.pulse_template : ''
  const [major, minor] = version.split('.').map(Number)
  if (!(major! >= 2)) return { ok: false, error: "This isn't a Pulse workspace template." }
  if (major! > 2 || (minor ?? 0) > 0) return { ok: false, error: NEWER_FILE }
  const lists = [
    ...(Array.isArray(obj.lists) ? obj.lists : []),
    ...(Array.isArray(obj.variants) ? obj.variants.flatMap(v => (v && typeof v === 'object' && Array.isArray((v as { lists?: unknown }).lists) ? (v as { lists: unknown[] }).lists : [])) : []),
  ]
  if (FUTURE_STARTER_KEYS.some(k => k in obj) || lists.some(l => l && typeof l === 'object' && FUTURE_LIST_KEYS.some(k => k in l))) {
    return { ok: false, error: NEEDS_NEWER }
  }
  const parsed = starterSchema.safeParse(data)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const where = issue?.path.length ? ` (at ${issue.path.join('.')})` : ''
    return { ok: false, error: `This template file has a problem${where}: ${issue?.message ?? 'invalid data'}` }
  }
  const s = parsed.data
  // Keys must be unique so sample data and later links can refer to lists
  const listSets = s.variants ? s.variants.map(v => v.lists) : [s.lists!]
  for (const set of listSets) {
    const keys = set.map(l => l.key)
    if (new Set(keys).size !== keys.length) return { ok: false, error: 'This template file has two lists with the same key.' }
    for (const l of set) {
      if ((l.links ?? []).some(link => !keys.includes(link.to))) return { ok: false, error: `This template file links "${l.name}" to a list it doesn't have.` }
      const names = (l.links ?? []).map(link => link.label_forward.toLowerCase())
      if (new Set(names).size !== names.length) return { ok: false, error: `This template file has two links with the same name on "${l.name}".` }
    }
  }
  if (s.variants && new Set(s.variants.map(v => v.key)).size !== s.variants.length) {
    return { ok: false, error: 'This template file has two variants with the same key.' }
  }
  return { ok: true, starter: s }
}

/** The lists a starter applies: its own, or the chosen (default: first) variant's. */
export function starterLists(s: Starter, variant?: string): StarterList[] {
  if (s.lists) return s.lists
  const v = s.variants!.find(x => x.key === variant) ?? s.variants![0]!
  return v.lists
}

export interface StarterSummary {
  id: string
  name: string
  description: string
  icon: string
  group: string | null
  keywords: string[]
  listNames: string[]
  hasSampleData: boolean
  variantQuestion: string | null
  variants: Array<{ key: string; name: string; description: string; listNames: string[] }>
}

/**
 * How well a starter matches a gallery search (0 = not at all). Every typed
 * word must start a word of the starter (name, group, keywords, lists,
 * description); a whole-word match scores higher, and when some starters
 * match every word whole, only those are shown, so "car" doesn't bring up
 * "Caring for a parent" (audit F-16).
 */
export function starterSearchScore(s: StarterSummary, query: string): number {
  const terms = searchTerms(query)
  if (terms.length === 0) return 1
  const phrases = s.keywords.map(k => k.toLowerCase())
  const words = wordsOf([s.name, s.description, s.group ?? '', ...s.listNames, ...s.variants.map(v => v.name), ...s.keywords])
  let score = 0
  for (const t of terms) {
    if (words.includes(t) || words.includes(`${t}s`) || phrases.includes(t)) score += 3
    else if (words.some(w => w.startsWith(t))) score += 1
    else return 0
  }
  return score
}

const searchTerms = (query: string) => query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
const wordsOf = (texts: string[]) => texts.join(' ').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
const hasEveryTerm = (words: string[], terms: string[]) => terms.length > 0 && terms.every(t => words.includes(t) || words.includes(`${t}s`))

/**
 * Among equally good matches, the starter named for what was typed comes
 * first: its own name, then its keywords, then its other words, and last a
 * starter that matched only through one of its layouts. "foster" puts Foster
 * home licensing above Human services' Foster Care Caseworker layout.
 */
function closeness(s: StarterSummary, terms: string[]): number {
  if (hasEveryTerm(wordsOf([s.name]), terms)) return 3
  if (s.keywords.some(k => k.toLowerCase() === terms.join(' ')) || hasEveryTerm(wordsOf(s.keywords), terms)) return 2
  if (hasEveryTerm(wordsOf([s.description, s.group ?? '', ...s.listNames]), terms)) return 1
  return 0
}

/** The starters to show for a search, best first */
export function searchStarters(starters: StarterSummary[], query: string): StarterSummary[] {
  const terms = searchTerms(query)
  const scored = starters.map(s => ({ s, score: starterSearchScore(s, query), close: closeness(s, terms) })).filter(x => x.score > 0)
  const whole = scored.filter(x => x.score === 3 * terms.length)
  // Array sort is stable, so equal matches keep the catalog's order
  return (terms.length > 0 && whole.length > 0 ? whole : scored).sort((a, b) => b.score - a.score || b.close - a.close).map(x => x.s)
}

/**
 * The layouts of a starter a search found it by: those whose name or list
 * names hold every typed word whole, so the gallery can say "Matches: Foster
 * Care Caseworker" and open that layout directly.
 */
export function matchingVariants(s: StarterSummary, query: string): Array<{ key: string; name: string }> {
  const terms = searchTerms(query)
  if (terms.length === 0) return []
  return s.variants.filter(v => hasEveryTerm(wordsOf([v.name, ...v.listNames]), terms)).map(v => ({ key: v.key, name: v.name }))
}

/** The sample data that goes with the chosen (default: first) variant, if any. */
export function starterSampleData(s: Starter, variant?: string): SampleDataSpec | undefined {
  if (!s.variants) return s.sampleData
  const v = s.variants.find(x => x.key === variant) ?? s.variants[0]!
  return v.sampleData ?? s.sampleData
}

export function summarizeStarter(s: Starter): StarterSummary {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    icon: s.icon,
    group: s.group ?? null,
    keywords: s.keywords ?? [],
    listNames: starterLists(s).map(l => l.name),
    hasSampleData: !!s.sampleData || !!s.variants?.some(v => v.sampleData),
    variantQuestion: s.variantQuestion ?? null,
    variants: (s.variants ?? []).map(v => ({ key: v.key, name: v.name, description: v.description, listNames: v.lists.map(l => l.name) })),
  }
}

// ── Preview / apply (main ↔ renderer) ──────────────────────────────────────────

/** Main process: a built-in starter or a file on disk */
export type StarterSource = { builtinId: string } | { filePath: string }
/** Renderer: a built-in starter, or a file opened through STARTER_OPEN_FILE (the window never sees paths) */
export type StarterRef = { builtinId: string } | { fileToken: string }

export interface ApplyOptions {
  /** List keys to add (from the chosen variant) */
  lists: string[]
  applyWords: boolean
  applyFeatures: boolean
  sampleData: boolean
  variant?: string
}

export interface ApplyResult {
  /** list key → new grid id */
  gridIds: Record<string, number>
  /** Lists, rules and checklists that were renamed to avoid a clash: original → new name */
  renamed: Record<string, string>
  warnings: string[]
  /** Words, feature switches or your own numbers changed (tell open windows) */
  workspaceChanged: boolean
  /** Note types were added (tell open windows) */
  activityTypesChanged?: boolean
}

export interface StarterPreview {
  summary: StarterSummary
  variant: string | null
  lists: Array<{ key: string; name: string; finalName: string; kind: StarterList['kind']; columns: number; columnNames: string[]; rules: string[] }>
  /** Words that would change: current → proposed, plural forms */
  words: Array<{ key: VocabKey; current: string; proposed: string }>
  /** Features the starter would switch on that are off now */
  features: Array<{ key: FeatureKey; label: string }>
  hasSampleData: boolean
}
