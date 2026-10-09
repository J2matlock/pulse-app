/**
 * Deadline engine v2 (plans/generalization/W05-deadline-engine.md).
 *
 * Pure: no database, no clock. Main and the window both call evaluate() so
 * every screen, report and export agrees on what's due when. Callers load
 * the record's values (and, for later kinds, meter readings, activity counts,
 * extensions and progress) into a RecordContext; `today` is passed in.
 *
 * Dates are local calendar dates as 'YYYY-MM-DD' strings throughout.
 */
import { z } from 'zod'
import { addInterval, describeInterval, hasInterval, toRuleInterval, type RuleInterval } from './ruleInterval'
import { addBusinessDays, rollBackToBusinessDay, DEFAULT_WEEKEND, type WorkCalendar } from './businessDays'
import { toYmd, ymdToDate, dateToYmd, daysBetween } from './ymd'

export { toYmd, ymdToDate, dateToYmd, daysBetween }

export type RuleKind = 'interval' | 'relative' | 'calendar' | 'meter' | 'quota' | 'sequence'

/** "Only while Status is Active" — a rule can hide or pause when this is false */
export interface Condition {
  columnId: number
  op: 'is' | 'is_not' | 'empty' | 'not_empty'
  values?: string[]
  whenFalse: 'hide' | 'pause'
}

export interface EngineRule {
  id: number
  kind: RuleKind
  interval: RuleInterval
  /** Kind-specific settings; null for interval rules */
  config: unknown | null
  condition: Condition | null
  /** Roll a due date that falls on a day off back to the previous working day */
  businessDays: boolean
}

export interface RecordContext {
  /** Injected so results are reproducible */
  today: string
  /** Value of the column the rule is on */
  columnDate: string | null
  /** Other columns the rule refers to, by column id */
  values?: Record<number, string | null>
  meterHistory?: Array<{ at: string; value: number }>
  activityCount?: number
  extension?: { newDue: string; reason: string } | null
  progress?: number[]
  /** Business-day calendar */
  holidays?: Set<string>
  weekend?: number[]
}

export type DeadlineState = 'none' | 'ok' | 'soon' | 'due' | 'overdue' | 'paused' | 'done'

export interface DeadlineResult {
  /** null = nothing due (no date, condition false, quota not active…) */
  due: string | null
  state: DeadlineState
  daysUntil: number | null
  /** The date is a forecast (meter rules) */
  estimated: boolean
  /** Short status, e.g. a sequence step or "9 of 12 used" */
  label?: string
  /** Sequence rules: the step that's due (0-based; past the last step = repeats) */
  step?: number
  /** Plain-English explanation for tooltips and PDFs */
  detail: string
  extended?: { from: string; reason: string }
}

// ── Rule settings per kind ──────────────────────────────────────────────────

const offsetSchema = z.object({
  days: z.number().int().min(0).max(3650).optional(),
  months: z.number().int().min(0).max(600).optional(),
  businessDays: z.number().int().min(0).max(1000).optional(),
}).strict()

export const relativeConfigSchema = z.object({
  kind: z.literal('relative'),
  /** The date this one is worked out from, or 'self' for the rule's own column */
  anchorColumnId: z.union([z.number().int().positive(), z.literal('self')]),
  offset: offsetSchema.extend({ direction: z.enum(['after', 'before']) }),
}).strict()
export type RelativeConfig = z.infer<typeof relativeConfigSchema>

export const calendarConfigSchema = z.object({
  kind: z.literal('calendar'),
  /** Months it's due in, 1–12 (quarterly estimates: [1, 4, 6, 9]) */
  months: z.array(z.number().int().min(1).max(12)).min(1).max(12).optional(),
  /** Day of the month, or 'last'; clamped to short months */
  day: z.union([z.number().int().min(1).max(31), z.literal('last')]).optional(),
  /** Take the month and day from this date column instead (an anniversary) */
  fromColumnMonth: z.number().int().positive().optional(),
  /** Only show it this many days ahead */
  lead: z.number().int().min(0).max(366).optional(),
}).strict().refine(c => !!c.fromColumnMonth || (!!c.months && c.day !== undefined), { message: 'Choose the months and day, or a date to repeat yearly' })
export type CalendarConfig = z.infer<typeof calendarConfigSchema>

export const meterConfigSchema = z.object({
  kind: z.literal('meter'),
  /** Number column with the current reading (odometer, hours…) */
  readingColumnId: z.number().int().positive(),
  /** Number column with the reading at the last service */
  lastServiceReadingColumnId: z.number().int().positive(),
  /** Due again after this much use */
  every: z.number().positive().max(1e9),
  unit: z.string().trim().min(1).max(20),
  /** "…or 6 months, whichever is first", counted from the rule's own date (the last service) */
  timeFallback: offsetSchema.omit({ businessDays: true }).optional(),
  /** Usage per day to assume until there are enough readings */
  typicalPerDay: z.number().positive().max(1e7).optional(),
}).strict()
export type MeterConfig = z.infer<typeof meterConfigSchema>

export const quotaConfigSchema = z.object({
  kind: z.literal('quota'),
  /** Kinds of notes that count (activity type keys) */
  activityTypes: z.array(z.string().regex(/^[a-z0-9_]{1,30}$/)).min(1).max(20),
  /** How many are allowed: from a number column, or fixed */
  limitColumnId: z.number().int().positive().optional(),
  limit: z.number().int().positive().max(100_000).optional(),
  /** Date columns for the period that counts (an authorization's start and end) */
  startColumnId: z.number().int().positive(),
  endColumnId: z.number().int().positive(),
  /** Warn when this many or fewer are left, or this close to the end */
  warnRemaining: z.number().int().min(0).max(1000).default(2),
  warnDaysBeforeEnd: z.number().int().min(0).max(366).default(14),
}).strict().refine(c => c.limitColumnId !== undefined || c.limit !== undefined, { message: 'Set how many are allowed' })
export type QuotaConfig = z.infer<typeof quotaConfigSchema>

export const sequenceConfigSchema = z.object({
  kind: z.literal('sequence'),
  /** The date the steps count from, or 'self' for the rule's own column */
  anchorColumnId: z.union([z.number().int().positive(), z.literal('self')]),
  steps: z.array(z.object({
    label: z.string().trim().min(1).max(80),
    offset: offsetSchema,
  }).strict()).min(1).max(20),
  /** After the last step, repeat this often (annual reviews forever) */
  repeatLast: offsetSchema.omit({ businessDays: true }).optional(),
}).strict()
export type SequenceConfig = z.infer<typeof sequenceConfigSchema>

export const conditionSchema = z.object({
  columnId: z.number().int().positive(),
  op: z.enum(['is', 'is_not', 'empty', 'not_empty']),
  values: z.array(z.string().max(200)).max(50).optional(),
  whenFalse: z.enum(['hide', 'pause']),
}).strict()

/** Settings schema per kind; kinds without settings (interval) have none */
export const RULE_CONFIG_SCHEMAS: Partial<Record<RuleKind, z.ZodTypeAny>> = {
  relative: relativeConfigSchema,
  calendar: calendarConfigSchema,
  meter: meterConfigSchema,
  quota: quotaConfigSchema,
  sequence: sequenceConfigSchema,
}

/** Check a kind's settings; returns the parsed value or a plain-language problem. */
export function parseRuleConfig(kind: RuleKind, raw: unknown): { ok: true; config: unknown | null } | { ok: false; error: string } {
  const schema = RULE_CONFIG_SCHEMAS[kind]
  if (!schema) return { ok: true, config: null }
  let data = raw
  if (typeof raw === 'string') { try { data = JSON.parse(raw) } catch { return { ok: false, error: 'The deadline settings could not be read.' } } }
  const r = schema.safeParse(data)
  return r.success ? { ok: true, config: r.data } : { ok: false, error: 'Some of the deadline settings are missing or not allowed.' }
}

export const RULE_KINDS: readonly RuleKind[] = ['interval', 'relative', 'calendar', 'meter', 'quota', 'sequence']

function parseJson(raw: string | null | undefined): unknown {
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

/** A stored rule (alert_rules row) as the engine sees it; unreadable settings fall back to an interval rule. */
export function engineRuleFrom(row: {
  id?: number | null; interval_days?: number | null; interval_months?: number | null; end_of_month?: number | boolean | null
  kind?: string | null; rule_config?: string | null; rule_condition?: string | null; business_days?: number | null
}): EngineRule {
  const kind = (RULE_KINDS as readonly string[]).includes(row.kind ?? '') ? row.kind as RuleKind : 'interval'
  const cfg = parseRuleConfig(kind, parseJson(row.rule_config))
  const cond = conditionSchema.safeParse(parseJson(row.rule_condition))
  return {
    id: row.id ?? 0,
    kind: cfg.ok ? kind : 'interval',
    interval: toRuleInterval(row),
    config: cfg.ok ? cfg.config : null,
    condition: cond.success ? cond.data : null,
    businessDays: !!row.business_days,
  }
}

/** Days ahead that count as "soon" when a rule has no thresholds of its own to say */
export const SOON_DAYS = 7

const NONE: DeadlineResult = { due: null, state: 'none', daysUntil: null, estimated: false, detail: '' }

// ── Dates ────────────────────────────────────────────────────────────────────

// One formatter for every call: building one per date costs more than the rest of the math
const DUE_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

export function formatDue(ymd: string): string {
  return DUE_FORMAT.format(ymdToDate(ymd))
}

function stateFor(daysUntil: number): DeadlineState {
  if (daysUntil < 0) return 'overdue'
  if (daysUntil === 0) return 'due'
  return daysUntil <= SOON_DAYS ? 'soon' : 'ok'
}

function result(due: string, today: string, detail: string, extra: Partial<DeadlineResult> = {}): DeadlineResult {
  const daysUntil = daysBetween(today, due)
  return { due, state: stateFor(daysUntil), daysUntil, estimated: false, detail, ...extra }
}

// ── Kinds ────────────────────────────────────────────────────────────────────

function calendarOf(ctx: RecordContext): WorkCalendar {
  return { holidays: ctx.holidays ?? new Set(), weekend: ctx.weekend ?? DEFAULT_WEEKEND }
}

/** Apply an offset (months, then days, then working days) forwards or backwards. */
function applyOffset(ymd: string, offset: RelativeConfig['offset'], cal: WorkCalendar): string {
  const sign = offset.direction === 'before' ? -1 : 1
  let d = ymdToDate(ymd)
  if (offset.months) d = sign > 0 ? addInterval(d, { days: 0, months: offset.months, endOfMonth: false }) : subtractMonths(d, offset.months)
  if (offset.days) d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + sign * offset.days)
  let out = dateToYmd(d)
  if (offset.businessDays) out = addBusinessDays(out, sign * offset.businessDays, cal)
  return out
}

/** Calendar-correct months back: Mar 31 − 1 month = Feb 28/29 */
function subtractMonths(d: Date, months: number): Date {
  const total = d.getFullYear() * 12 + d.getMonth() - months
  const y = Math.floor(total / 12)
  const m = total - y * 12
  return new Date(y, m, Math.min(d.getDate(), new Date(y, m + 1, 0).getDate()))
}

function describeOffset(o: RelativeConfig['offset']): string {
  const parts = [
    o.months ? `${o.months} month${o.months === 1 ? '' : 's'}` : '',
    o.days ? `${o.days} day${o.days === 1 ? '' : 's'}` : '',
    o.businessDays ? `${o.businessDays} working day${o.businessDays === 1 ? '' : 's'}` : '',
  ].filter(Boolean)
  return `${parts.join(' and ') || '0 days'} ${o.direction}`
}

/**
 * "90 days after Eligibility date", "60 days before Lease end". The rule's
 * own column, when filled in, is the date it was done: on or after the
 * start of this cycle (the anchor, or the due date for "before" rules) it
 * counts as done.
 */
function evaluateRelative(rule: EngineRule, ctx: RecordContext): DeadlineResult {
  const cfg = rule.config as RelativeConfig
  const anchor = toYmd(cfg.anchorColumnId === 'self' ? ctx.columnDate : ctx.values?.[cfg.anchorColumnId] ?? null)
  if (!anchor) return NONE
  const cal = calendarOf(ctx)
  const due = applyOffset(anchor, cfg.offset, cal)
  const detail = `Due ${formatDue(due)} (${describeOffset(cfg.offset)} ${formatDue(anchor)})`
  if (cfg.anchorColumnId !== 'self') {
    const doneOn = toYmd(ctx.columnDate)
    const cycleStart = cfg.offset.direction === 'after' ? anchor : applyOffset(due, cfg.offset, cal)
    if (doneOn && doneOn >= cycleStart) {
      return { due, state: 'done', daysUntil: null, estimated: false, detail: `Done ${formatDue(doneOn)} · ${detail}` }
    }
  }
  return result(due, ctx.today, detail)
}

function evaluateInterval(rule: EngineRule, ctx: RecordContext): DeadlineResult {
  const base = toYmd(ctx.columnDate)
  if (!base) return NONE
  const due = dateToYmd(addInterval(ymdToDate(base), rule.interval))
  const detail = hasInterval(rule.interval)
    ? `Due ${formatDue(due)} (${describeInterval(rule.interval).toLowerCase()}, from ${formatDue(base)})`
    : `Due ${formatDue(due)}`
  return result(due, ctx.today, detail)
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** The date in (year, month 1–12) for a day number or 'last', clamped to the month's length. */
function dayIn(year: number, month: number, day: number | 'last'): string {
  const last = new Date(year, month, 0).getDate()
  return dateToYmd(new Date(year, month - 1, day === 'last' ? last : Math.min(day, last)))
}

/**
 * "Quarterly on the 15th", "every Mar 31", "on the anniversary of the
 * appointment date". The rule's own column is the date it was last done:
 * the next occurrence after that, or — never done — the next one from today.
 */
function evaluateCalendar(rule: EngineRule, ctx: RecordContext): DeadlineResult {
  const cfg = rule.config as CalendarConfig
  let months = cfg.months ?? []
  let day: number | 'last' = cfg.day ?? 1
  if (cfg.fromColumnMonth) {
    const from = toYmd(ctx.values?.[cfg.fromColumnMonth] ?? null)
    if (!from) return NONE
    const [, m, d] = from.split('-').map(Number)
    months = [m!]
    day = d!
  }
  if (months.length === 0) return NONE
  const doneOn = toYmd(ctx.columnDate)
  // Strictly after the last time it was done; never done: on or after today
  const after = doneOn ?? null
  const from = doneOn ?? ctx.today
  const startYear = Number(from.slice(0, 4))
  const sorted = [...new Set(months)].sort((a, b) => a - b)
  let due: string | null = null
  for (let y = startYear; y <= startYear + 2 && !due; y++) {
    for (const m of sorted) {
      const candidate = dayIn(y, m, day)
      if (after ? candidate > after : candidate >= from) { due = candidate; break }
    }
  }
  if (!due) return NONE
  const when = cfg.fromColumnMonth ? 'every year on that date'
    : sorted.length === 12 ? `monthly on the ${day === 'last' ? 'last day' : ordinal(day)}`
    : `${sorted.map(m => MONTH_NAMES[m - 1]).join(', ')} ${day === 'last' ? '(last day)' : day}`
  const detail = `Due ${formatDue(due)} (${when}${doneOn ? `; last done ${formatDue(doneOn)}` : ''})`
  const res = result(due, ctx.today, detail)
  // Not shown until the lead time, unless it's already late
  if (cfg.lead !== undefined && res.daysUntil !== null && res.daysUntil > cfg.lead) return { ...NONE, detail: `Next: ${formatDue(due)}` }
  return res
}

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'
  return `${n}${s}`
}

function toNumber(v: string | null | undefined): number | null {
  if (v == null || v.trim() === '') return null
  const n = Number(v.replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * Usage per day from readings (least squares over the last 180 days). Needs
 * two readings at least 7 days apart; readings that went down (a corrected
 * odometer) are dropped. Null when there isn't enough to go on.
 */
export function meterRate(history: Array<{ at: string; value: number }>, today: string): number | null {
  const pts = history
    .map(h => ({ x: daysBetween(today, toYmd(h.at) ?? today), y: h.value }))
    .filter(p => p.x >= -180 && p.x <= 0 && Number.isFinite(p.y))
    .sort((a, b) => a.x - b.x)
  // Keep a rising series: a lower reading after a higher one replaces the run before it
  const rising: typeof pts = []
  for (const p of pts) {
    while (rising.length && rising[rising.length - 1]!.y > p.y) rising.pop()
    rising.push(p)
  }
  if (rising.length < 2 || rising[rising.length - 1]!.x - rising[0]!.x < 7) return null
  const n = rising.length
  const mx = rising.reduce((a, p) => a + p.x, 0) / n
  const my = rising.reduce((a, p) => a + p.y, 0) / n
  const sxy = rising.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0)
  const sxx = rising.reduce((a, p) => a + (p.x - mx) ** 2, 0)
  const rate = sxx === 0 ? null : sxy / sxx
  return rate !== null && rate > 0 ? rate : null
}

/**
 * "Every 5,000 miles or 6 months, whichever is first": due by the meter
 * (estimated from how fast readings grow) or by the time fallback counted
 * from the last service date, whichever comes first.
 */
function evaluateMeter(rule: EngineRule, ctx: RecordContext): DeadlineResult {
  const cfg = rule.config as MeterConfig
  const current = toNumber(ctx.values?.[cfg.readingColumnId])
  const lastService = toNumber(ctx.values?.[cfg.lastServiceReadingColumnId])
  const serviceDate = toYmd(ctx.columnDate)
  const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 1 })

  let byTime: string | null = null
  if (cfg.timeFallback && serviceDate) {
    const d = addInterval(ymdToDate(serviceDate), { days: cfg.timeFallback.days ?? 0, months: cfg.timeFallback.months ?? 0, endOfMonth: false })
    byTime = dateToYmd(d)
  }

  let byMeter: string | null = null
  let left: number | null = null
  if (current !== null && lastService !== null) {
    left = lastService + cfg.every - current
    const rate = meterRate([...(ctx.meterHistory ?? []), { at: ctx.today, value: current }], ctx.today) ?? cfg.typicalPerDay ?? null
    if (left <= 0) byMeter = ctx.today
    else if (rate) {
      const d = ymdToDate(ctx.today)
      byMeter = dateToYmd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + Math.ceil(left / rate)))
    }
  }

  const due = byMeter && byTime ? (byMeter <= byTime ? byMeter : byTime) : byMeter ?? byTime
  if (!due) {
    if (left !== null) return { ...NONE, detail: `${fmt(left)} ${cfg.unit} left` }
    return NONE
  }
  const meterPart = left === null ? null : left <= 0 ? `${fmt(-left)} ${cfg.unit} over` : `${fmt(left)} ${cfg.unit} left${byMeter ? ` (about ${formatDue(byMeter)})` : ''}`
  const timePart = byTime ? `by ${formatDue(byTime)}` : null
  const detail = meterPart && timePart ? `${meterPart} or ${timePart}, whichever is first` : meterPart ?? `Due ${timePart!.slice(3)}`
  const estimated = !!byMeter && due === byMeter && left !== null && left > 0
  return result(due, ctx.today, detail, { estimated, label: left !== null ? `${fmt(Math.max(0, left))} ${cfg.unit} left` : undefined })
}

/**
 * "12 sessions until the authorization ends": counts notes of the chosen
 * kinds between the start and end dates. Late when they're all used or the
 * end has passed; soon when few are left or the end is near. Due = the end.
 */
function evaluateQuota(rule: EngineRule, ctx: RecordContext): DeadlineResult {
  const cfg = rule.config as QuotaConfig
  const start = toYmd(ctx.values?.[cfg.startColumnId] ?? null)
  const end = toYmd(ctx.values?.[cfg.endColumnId] ?? null)
  const limit = cfg.limitColumnId !== undefined ? toNumber(ctx.values?.[cfg.limitColumnId] ?? null) : cfg.limit ?? null
  if (!start || !end || limit === null || limit <= 0) return NONE
  const used = ctx.activityCount ?? 0
  const left = Math.max(0, limit - used)
  const label = `${used} of ${limit} used`
  const daysUntil = daysBetween(ctx.today, end)
  const range = `${formatDue(start)} – ${formatDue(end)}`
  if (used >= limit) {
    // Out of visits: as urgent as a deadline due today, whatever the end date
    return { due: end, state: 'overdue', daysUntil: Math.min(daysUntil, 0), estimated: false, label, detail: `All ${limit} used (${range})` }
  }
  if (daysUntil < 0) return { due: end, state: 'overdue', daysUntil, estimated: false, label, detail: `Ended ${formatDue(end)} with ${left} left` }
  const soon = left <= cfg.warnRemaining || daysUntil <= cfg.warnDaysBeforeEnd
  const state: DeadlineState = daysUntil === 0 ? 'due' : soon ? 'soon' : 'ok'
  return { due: end, state, daysUntil, estimated: false, label, detail: `${left} of ${limit} left until ${formatDue(end)} (${range})` }
}

/** The date a sequence counts from, for this record. */
export function sequenceAnchor(rule: EngineRule, columnDate: string | null, values: Record<number, string | null> | undefined): string | null {
  if (rule.kind !== 'sequence' || !rule.config) return null
  const a = (rule.config as SequenceConfig).anchorColumnId
  return toYmd(a === 'self' ? columnDate : values?.[a] ?? null)
}

/** When step `i` is due (i past the last step = the (i − n + 1)th repeat), or null if there's no such step. */
export function sequenceStepDue(cfg: SequenceConfig, anchor: string, i: number, cal: WorkCalendar): { due: string; label: string } | null {
  const n = cfg.steps.length
  if (i < n) return { due: applyOffset(anchor, { ...cfg.steps[i]!.offset, direction: 'after' }, cal), label: cfg.steps[i]!.label }
  if (!cfg.repeatLast) return null
  const last = applyOffset(anchor, { ...cfg.steps[n - 1]!.offset, direction: 'after' }, cal)
  const times = i - n + 1
  const d = addInterval(ymdToDate(last), { days: (cfg.repeatLast.days ?? 0) * times, months: (cfg.repeatLast.months ?? 0) * times, endOfMonth: false })
  return { due: dateToYmd(d), label: cfg.steps[n - 1]!.label }
}

/**
 * "45-day IFSP, then 6-month review, then annual": due at the first step
 * not done yet, counted from the anchor date. Done steps come from
 * deadline_progress (only those for the current anchor date).
 */
function evaluateSequence(rule: EngineRule, ctx: RecordContext): DeadlineResult {
  const cfg = rule.config as SequenceConfig
  const anchor = sequenceAnchor(rule, ctx.columnDate, ctx.values)
  if (!anchor) return NONE
  const done = new Set(ctx.progress ?? [])
  const n = cfg.steps.length
  const cal = calendarOf(ctx)
  for (let i = 0; i < n + 200; i++) {
    if (done.has(i)) continue
    const step = sequenceStepDue(cfg, anchor, i, cal)
    if (!step) break
    const label = i < n ? `${step.label} (step ${i + 1} of ${n})` : `${step.label} (repeat ${i - n + 1})`
    return result(step.due, ctx.today, `${label}: due ${formatDue(step.due)}`, { label, step: i })
  }
  return { due: null, state: 'done', daysUntil: null, estimated: false, detail: `All ${n} steps done`, label: `All ${n} steps done` }
}

function evaluateKind(rule: EngineRule, ctx: RecordContext): DeadlineResult {
  switch (rule.kind) {
    case 'interval': return evaluateInterval(rule, ctx)
    case 'relative': return rule.config ? evaluateRelative(rule, ctx) : evaluateInterval(rule, ctx)
    case 'calendar': return rule.config ? evaluateCalendar(rule, ctx) : evaluateInterval(rule, ctx)
    case 'meter': return rule.config ? evaluateMeter(rule, ctx) : evaluateInterval(rule, ctx)
    case 'quota': return rule.config ? evaluateQuota(rule, ctx) : evaluateInterval(rule, ctx)
    case 'sequence': return rule.config ? evaluateSequence(rule, ctx) : evaluateInterval(rule, ctx)
    // Kinds still to come behave like plain intervals until their commit lands
    default: return evaluateInterval(rule, ctx)
  }
}

/**
 * The date an extension is tied to: the anchor for relative and sequence
 * rules, the rule's own date for the rest. A different date means a new
 * cycle, and the extension no longer applies.
 */
export function extensionAnchor(rule: EngineRule, columnDate: string | null, values: Record<number, string | null> | undefined): string {
  if ((rule.kind === 'relative' || rule.kind === 'sequence') && rule.config) {
    const a = (rule.config as RelativeConfig | SequenceConfig).anchorColumnId
    return toYmd(a === 'self' ? columnDate : values?.[a] ?? null) ?? ''
  }
  return toYmd(columnDate) ?? ''
}

export interface StoredExtension { id: number; newDue: string; reason: string; anchor: string | null; step: number | null }

/** The extension that applies to this result (same anchor date and, for sequences, the same step), if any. */
export function matchExtension(exts: StoredExtension[] | undefined, anchor: string, step: number | undefined): StoredExtension | undefined {
  return (exts ?? []).find(e => (e.anchor ?? '') === anchor && (e.step ?? null) === (step ?? null))
}

/** Move a result to an extension's date, keeping where it came from. */
export function applyExtension(res: DeadlineResult, ext: { newDue: string; reason: string }, today: string): DeadlineResult {
  if (!res.due || res.state === 'done' || res.state === 'paused' || res.state === 'none') return res
  const moved = result(ext.newDue, today, `Extended to ${formatDue(ext.newDue)} (was ${formatDue(res.due)}): ${ext.reason}`, { label: res.label, step: res.step })
  return { ...moved, extended: { from: res.due, reason: ext.reason } }
}

/** Whether a rule's "only when…" condition holds for this record (no condition = always). */
export function conditionHolds(cond: Condition | null, values: Record<number, string | null> | undefined): boolean {
  if (!cond) return true
  const raw = (values?.[cond.columnId] ?? '').toString().trim()
  const norm = (v: string) => v.trim().toLowerCase()
  switch (cond.op) {
    case 'empty': return raw === ''
    case 'not_empty': return raw !== ''
    case 'is': return (cond.values ?? []).some(v => norm(v) === norm(raw))
    case 'is_not': return !(cond.values ?? []).some(v => norm(v) === norm(raw))
  }
}

function describeCondition(cond: Condition): string {
  const list = (cond.values ?? []).join(' or ')
  switch (cond.op) {
    case 'is': return `only while it's ${list}`
    case 'is_not': return `not while it's ${list}`
    case 'empty': return 'only while that field is empty'
    case 'not_empty': return 'only while that field is filled in'
  }
}

/** What's due for one record under one rule. */
export function evaluate(rule: EngineRule, ctx: RecordContext): DeadlineResult {
  if (!conditionHolds(rule.condition, ctx.values)) {
    if (rule.condition!.whenFalse === 'hide') return NONE
    const res = evaluateKind(rule, ctx)
    return { ...res, state: 'paused', daysUntil: null, detail: `Paused (${describeCondition(rule.condition!)})${res.detail ? ` · ${res.detail}` : ''}` }
  }
  const res = evaluateKind(rule, ctx)
  if (ctx.extension) return applyExtension(res, ctx.extension, ctx.today)
  // "Count business days only": a due date on a day off moves to the working day before
  if (rule.businessDays && res.due && res.state !== 'done') {
    const rolled = rollBackToBusinessDay(res.due, calendarOf(ctx))
    if (rolled !== res.due) {
      return result(rolled, ctx.today, `Due ${formatDue(rolled)}, the working day before ${formatDue(res.due)} · ${res.detail}`, { estimated: res.estimated, label: res.label })
    }
  }
  return res
}

/** Whether a rule needs more than the cell itself (loaders fetch every row, not only filled cells). */
export function needsRowContext(rule: EngineRule): boolean {
  return rule.kind !== 'interval' || rule.condition !== null
}

/** The column whose history a meter rule needs (its readings), or null. */
export function meterHistoryColumn(rule: EngineRule): number | null {
  return rule.kind === 'meter' && rule.config ? (rule.config as MeterConfig).readingColumnId : null
}

/** Columns besides the rule's own that the loader must fetch for this rule. */
export function referencedColumns(rule: EngineRule): number[] {
  const ids = new Set<number>()
  if (rule.condition) ids.add(rule.condition.columnId)
  if (rule.kind === 'relative' && rule.config) {
    const a = (rule.config as RelativeConfig).anchorColumnId
    if (a !== 'self') ids.add(a)
  }
  if (rule.kind === 'calendar' && rule.config) {
    const f = (rule.config as CalendarConfig).fromColumnMonth
    if (f) ids.add(f)
  }
  if (rule.kind === 'meter' && rule.config) {
    const m = rule.config as MeterConfig
    ids.add(m.readingColumnId)
    ids.add(m.lastServiceReadingColumnId)
  }
  if (rule.kind === 'sequence' && rule.config) {
    const a = (rule.config as SequenceConfig).anchorColumnId
    if (a !== 'self') ids.add(a)
  }
  if (rule.kind === 'quota' && rule.config) {
    const q = rule.config as QuotaConfig
    ids.add(q.startColumnId)
    ids.add(q.endColumnId)
    if (q.limitColumnId) ids.add(q.limitColumnId)
  }
  return [...ids]
}
