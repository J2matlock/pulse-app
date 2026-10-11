/**
 * Deadline rules in starters and shared files (W05 commit 12).
 *
 * A rule's settings point at columns by id ("45 days after column 12"),
 * which means nothing in another database. In a file they point by name
 * instead: `{ "column": "Referral date" }`. Applying a file resolves the names
 * against the list the rule lands on, after its columns exist.
 */
import type { Database } from 'better-sqlite3'
import { parseRuleConfig, conditionSchema, RULE_KINDS, type RuleKind } from '../shared/deadlineEngine'

/** Settings keys that hold a column id, across every kind */
const REF_KEYS = ['anchorColumnId', 'fromColumnMonth', 'readingColumnId', 'lastServiceReadingColumnId', 'limitColumnId', 'startColumnId', 'endColumnId'] as const

export interface RuleSpec {
  name: string
  description?: string | null
  thresholds: string
  interval_days?: number | null
  interval_months?: number | null
  end_of_month?: number | null
  kind?: RuleKind
  rule_config?: string | null
  rule_condition?: string | null
  business_days?: number
}

type Obj = Record<string, unknown>

function parse(raw: string | null | undefined): Obj | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as unknown
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : null
  } catch { return null }
}

const isRef = (v: unknown): v is { column: string } => !!v && typeof v === 'object' && typeof (v as Obj).column === 'string'

/**
 * A stored rule's W05 fields for a file, with column ids swapped for names.
 * Plain date rules get nothing extra, so older versions can still read them.
 * A setting pointing at a column that isn't in this list falls back to a plain rule.
 */
export function portableRuleFields(rule: { kind?: string | null; rule_config?: string | null; rule_condition?: string | null; business_days?: number | null },
  columnName: (id: number) => string | undefined): Pick<RuleSpec, 'kind' | 'rule_config' | 'rule_condition' | 'business_days'> {
  const out: Pick<RuleSpec, 'kind' | 'rule_config' | 'rule_condition' | 'business_days'> = {}
  const kind = (RULE_KINDS as readonly string[]).includes(rule.kind ?? '') ? rule.kind as RuleKind : 'interval'
  const cfg = parse(rule.rule_config)
  if (kind !== 'interval' && cfg) {
    let ok = true
    for (const k of REF_KEYS) {
      if (typeof cfg[k] !== 'number') continue
      const name = columnName(cfg[k] as number)
      if (name) cfg[k] = { column: name }
      else ok = false
    }
    if (ok) { out.kind = kind; out.rule_config = JSON.stringify(cfg) }
  }
  const cond = parse(rule.rule_condition)
  if (cond && typeof cond.columnId === 'number') {
    const name = columnName(cond.columnId)
    if (name) out.rule_condition = JSON.stringify({ ...cond, columnId: { column: name } })
  }
  if (rule.business_days) out.business_days = rule.business_days === 2 ? 2 : 1
  return out
}

/** The rule points at columns, so it has to be set up after the list's columns exist. */
export function refersToColumns(r: Pick<RuleSpec, 'kind' | 'rule_config' | 'rule_condition'>): boolean {
  const cfg = parse(r.rule_config)
  const cond = parse(r.rule_condition)
  return (!!cfg && (r.kind ?? 'interval') !== 'interval' && REF_KEYS.some(k => isRef(cfg[k]))) || (!!cond && isRef(cond.columnId))
}

/**
 * Names back to this list's column ids. Anything that can't be resolved or
 * isn't valid any more drops back to a plain rule, and is reported.
 */
export function resolveRuleFields(r: RuleSpec, columnId: (name: string) => number | undefined): { fields: Required<Pick<RuleSpec, 'kind' | 'rule_config' | 'rule_condition' | 'business_days'>>; missing: string[] } {
  const missing: string[] = []
  const swap = (obj: Obj, k: string) => {
    if (!isRef(obj[k])) return
    const id = columnId(obj[k].column)
    if (id === undefined) { missing.push(obj[k].column); delete obj[k] } else obj[k] = id
  }
  let kind: RuleKind = (RULE_KINDS as readonly string[]).includes(r.kind ?? '') ? r.kind as RuleKind : 'interval'
  let ruleConfig: string | null = null
  const cfg = parse(r.rule_config)
  if (kind !== 'interval' && cfg) {
    const before = missing.length
    for (const k of REF_KEYS) swap(cfg, k)
    const checked = missing.length === before ? parseRuleConfig(kind, cfg) : { ok: false as const, error: '' }
    if (checked.ok) ruleConfig = checked.config ? JSON.stringify(checked.config) : null
    else kind = 'interval'
  } else kind = 'interval'

  let ruleCondition: string | null = null
  const cond = parse(r.rule_condition)
  if (cond) {
    const before = missing.length
    swap(cond, 'columnId')
    const checked = missing.length === before ? conditionSchema.safeParse(cond) : null
    if (checked?.success) ruleCondition = JSON.stringify(checked.data)
  }
  return { fields: { kind, rule_config: ruleConfig, rule_condition: ruleCondition, business_days: workDays(r.business_days) }, missing }
}

/**
 * Date columns whose rule reads the day it was done, not a due date (from
 * another date, fixed dates, a series of steps; not counted from their own
 * column), become Deadline columns (Decision E1). Returns the columns changed.
 */
export function convertDateColumnsToDeadline(db: Database, ruleId?: number): number[] {
  const ids = (db.prepare(`
    SELECT col.id FROM columns col
    JOIN alert_rules ar ON ar.id = CAST(json_extract(col.config, '$.alert_rule_id') AS INTEGER)
    WHERE col.column_type = 'date' AND (? IS NULL OR ar.id = ?) AND json_valid(ar.rule_config) AND (
      ar.kind = 'calendar'
      OR (ar.kind IN ('relative', 'sequence') AND COALESCE(json_extract(ar.rule_config, '$.anchorColumnId'), 'self') != 'self')
    )
  `).all(ruleId ?? null, ruleId ?? null) as Array<{ id: number }>).map(r => r.id)
  const set = db.prepare("UPDATE columns SET column_type = 'deadline' WHERE id = ?")
  for (const id of ids) set.run(id)
  return ids
}

/** 0 = dates stay put, 1 = a day off moves to the working day before, 2 = to the next one */
const workDays = (v: number | null | undefined): 0 | 1 | 2 => v === 2 ? 2 : v ? 1 : 0

const sameJson = (a: string | null | undefined, b: string | null | undefined): boolean => {
  try { return JSON.stringify(JSON.parse(a ?? 'null')) === JSON.stringify(JSON.parse(b ?? 'null')) } catch { return a === b }
}

/** Reuse a rule with this name only if it's identical; otherwise add "Name 2"… */
export function ensureRule(db: Database, r: RuleSpec, renamed: Record<string, string>): { id: number; name: string } {
  const find = db.prepare('SELECT id, thresholds, interval_days, interval_months, end_of_month, kind, rule_config, rule_condition, business_days FROM alert_rules WHERE name = ?')
  for (let n = 1; ; n++) {
    const name = n === 1 ? r.name : `${r.name} ${n}`
    const row = find.get(name) as {
      id: number; thresholds: string; interval_days: number | null; interval_months: number | null; end_of_month: number
      kind: string | null; rule_config: string | null; rule_condition: string | null; business_days: number | null
    } | undefined
    if (!row) {
      const id = Number(db.prepare(`
        INSERT INTO alert_rules (name, description, is_system, thresholds, interval_days, interval_months, end_of_month,
          kind, rule_config, rule_condition, business_days, created_at)
        VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(name, r.description ?? null, r.thresholds, r.interval_days ?? null, r.interval_months ?? null, r.end_of_month ? 1 : 0,
        r.kind ?? 'interval', r.rule_config ?? null, r.rule_condition ?? null, workDays(r.business_days)).lastInsertRowid)
      if (n > 1) renamed[r.name] = name
      return { id, name }
    }
    const same = sameJson(row.thresholds, r.thresholds)
      && (row.interval_days ?? null) === (r.interval_days ?? null)
      && (row.interval_months ?? null) === (r.interval_months ?? null)
      && (row.end_of_month ? 1 : 0) === (r.end_of_month ? 1 : 0)
      && (row.kind ?? 'interval') === (r.kind ?? 'interval')
      && sameJson(row.rule_config, r.rule_config)
      && sameJson(row.rule_condition, r.rule_condition)
      && workDays(row.business_days) === workDays(r.business_days)
    if (same) {
      if (n > 1) renamed[r.name] = name
      return { id: row.id, name }
    }
  }
}

/**
 * Set up the rules that point at columns, now that the list's columns exist,
 * and link the columns that name them. Returns warnings for anything that
 * had to fall back.
 */
export function linkColumnRules(db: Database, gridId: number, listName: string, rules: RuleSpec[], renamed: Record<string, string>): string[] {
  const warnings: string[] = []
  const cols = db.prepare('SELECT id, name, config FROM columns WHERE grid_id = ?').all(gridId) as Array<{ id: number; name: string; config: string | null }>
  const byName = new Map<string, number>()
  for (const c of cols) { const k = c.name.trim().toLowerCase(); if (!byName.has(k)) byName.set(k, c.id) }
  const save = db.prepare('UPDATE columns SET config = ? WHERE id = ?')
  for (const r of rules) {
    if (!refersToColumns(r)) continue
    const { fields, missing } = resolveRuleFields(r, n => byName.get(n.trim().toLowerCase()))
    if (missing.length) warnings.push(`"${r.name}" uses columns ${listName} doesn't have (${missing.join(', ')}), so it was added as a plain date rule.`)
    const rule = ensureRule(db, { ...r, ...fields }, renamed)
    for (const c of cols) {
      const cfg = parse(c.config)
      if (cfg?.alert_rule_name !== r.name) continue
      save.run(JSON.stringify({ ...cfg, alert_rule_id: rule.id, alert_rule_name: rule.name }), c.id)
    }
  }
  // A list set up from a file or example gets Deadline columns where the rule reads the done date (Decision E1)
  convertDateColumnsToDeadline(db)
  return warnings
}
