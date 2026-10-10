/**
 * Loads deadlines and works them out with the shared engine
 * (plans/generalization/W05-deadline-engine.md §2.2). Everything that lists
 * deadlines — dashboard, briefing, planner, calendar export, reports — goes
 * through here, so they all agree.
 */
import { getDb } from './database'
import { evaluate, engineRuleFrom, meterHistoryColumn, referencedColumns, sequenceAnchor, extensionAnchor, matchExtension, applyExtension, type StoredExtension, type QuotaConfig, type DeadlineResult, type EngineRule, type RecordContext, type RuleKind } from '../shared/deadlineEngine'
import type { WorkCalendar } from '../shared/businessDays'
import type { GridDeadlineContext } from '../shared/ipc-contract'
import { workCalendarSetting } from './vocab'
import { localDateString } from '../shared/dates'
import { daysBetween } from '../shared/ymd'

/** One deadline: the same fields the dashboard always had, plus the engine's result */
export interface DeadlineItem extends DeadlineResult {
  row_id: number
  grid_id: number
  grid_name: string
  column_id: number
  column_name: string
  column_config: string
  date_value: string
  client_name: string | null
  /** What the list holds (person/thing/job) */
  record_kind: string | null
  interval_days: number | null
  interval_months: number | null
  end_of_month: number | null
  alert_thresholds: string | null
  /** Same as `due`; the name the dashboard has always used */
  effective_date: string | null
  /** How the rule works (W05), so marking done can do the right thing */
  rule_kind: RuleKind
  /** The extension in effect, so it can be removed */
  extension_id?: number
}

export interface DeadlineQuery {
  gridId?: number
  rowIds?: number[]
  /** Only deadlines due in this range (inclusive, 'YYYY-MM-DD') */
  from?: string
  to?: string
  /** Soonest first, then cut to this many */
  limit?: number
  /** For tests and reports "as of" a day; defaults to today */
  today?: string
  /** Also list deadlines already done (relative rules whose own date is filled in) */
  includeDone?: boolean
  /** Also list deadlines paused by their "only when…" condition */
  includePaused?: boolean
  /** Also list calendar rules not shown yet because of their lead time, at the date they're next due (calendar files) */
  includeUpcoming?: boolean
}

type RuleFields = { kind: string | null; rule_config: string | null; rule_condition: string | null; business_days: number | null }

/** Days off for business-day rules (Settings → Alerts → Days off). */
export function loadWorkCalendar(): WorkCalendar {
  const c = workCalendarSetting()
  return { holidays: new Set(c.holidays), weekend: c.weekend }
}

interface Row extends RuleFields {
  row_id: number; grid_id: number; grid_name: string; column_id: number; column_name: string; column_config: string
  date_value: string; client_name: string | null; record_kind: string | null; rule_id: number | null
  interval_days: number | null; interval_months: number | null; end_of_month: number | null; alert_thresholds: string | null
}

interface RuleColumn extends RuleFields {
  column_id: number; column_name: string; column_config: string; grid_id: number; grid_name: string; rule_id: number
  interval_days: number | null; interval_months: number | null; end_of_month: number | null; alert_thresholds: string | null
}

export function loadDeadlines(q: DeadlineQuery = {}): DeadlineItem[] {
  const today = q.today ?? localDateString()
  const cal = loadWorkCalendar()
  const rowFilter = q.rowIds?.length ? `AND r.id IN (${q.rowIds.map(() => '?').join(',')})` : ''
  // Plain interval rules need only the filled-in cell: one query for all of them
  const rows = getDb().prepare(`
    SELECT r.id AS row_id, r.grid_id, g.name AS grid_name, col.id AS column_id, col.name AS column_name,
           col.config AS column_config, c.value AS date_value, r.display_name AS client_name, g.record_kind, ar.id AS rule_id,
           ar.interval_days, ar.interval_months, ar.end_of_month, ar.thresholds AS alert_thresholds,
           ar.kind, ar.rule_config, ar.rule_condition, ar.business_days
    FROM cells c
    JOIN rows r   ON r.id = c.row_id AND r.is_active = 1 AND r.deleted_at IS NULL
    JOIN grids g  ON g.id = r.grid_id AND g.is_active = 1
    JOIN columns col ON col.id = c.column_id AND col.column_type IN ('date', 'deadline')
      AND json_extract(col.config, '$.alert_rule_id') IS NOT NULL
    LEFT JOIN alert_rules ar ON ar.id = CAST(json_extract(col.config, '$.alert_rule_id') AS INTEGER)
    WHERE c.value IS NOT NULL AND c.value != ''
      AND (ar.id IS NULL OR (COALESCE(ar.kind, 'interval') = 'interval' AND ar.rule_condition IS NULL))
      AND (? IS NULL OR r.grid_id = ?) ${rowFilter}
  `).all(q.gridId ?? null, q.gridId ?? null, ...(q.rowIds ?? [])) as Row[]

  const items: DeadlineItem[] = []
  const extensions = activeExtensions()
  // Parse each rule once per load, not once per record
  const rules = new Map<number, EngineRule>()
  const ruleFor = (r: Row) => {
    const id = r.rule_id ?? 0
    let rule = rules.get(id)
    if (!rule) { rule = engineRuleFrom({ ...r, id }); rules.set(id, rule) }
    return rule
  }
  const add = (r: Row, ctx: RecordContext) => {
    const rule = ruleFor(r)
    let res = evaluate(rule, ctx)
    // An extension applies while the date it extended (and the step) is unchanged
    const ext = matchExtension(extensions.get(`${r.row_id}:${r.column_id}`), extensionAnchor(rule, ctx.columnDate, ctx.values), res.step)
    if (ext) res = { ...applyExtension(res, ext, today) }
    if (res.due === null && q.includeUpcoming && res.upcoming) res = { ...res, due: res.upcoming, state: 'ok', daysUntil: daysBetween(today, res.upcoming) }
    if (res.due === null) return
    if (res.state === 'done' && !q.includeDone) return
    if (res.state === 'paused' && !q.includePaused) return
    if (q.from && res.due < q.from) return
    if (q.to && res.due > q.to) return
    items.push({
      row_id: r.row_id, grid_id: r.grid_id, grid_name: r.grid_name, column_id: r.column_id, column_name: r.column_name,
      column_config: r.column_config, date_value: r.date_value, client_name: r.client_name, record_kind: r.record_kind,
      interval_days: r.interval_days, interval_months: r.interval_months, end_of_month: r.end_of_month,
      alert_thresholds: r.alert_thresholds, ...res, effective_date: res.due, rule_kind: rule.kind,
      ...(ext && res.extended ? { extension_id: ext.id } : {}),
    })
  }
  for (const r of rows) add(r, { today, columnDate: r.date_value, holidays: cal.holidays, weekend: cal.weekend })

  // Other kinds (and rules with conditions) can be due with their own cell empty, and
  // read other columns: load each such column's rows with the columns it refers to
  const ruleColumns = getDb().prepare(`
    SELECT col.id AS column_id, col.name AS column_name, col.config AS column_config, g.id AS grid_id, g.name AS grid_name,
           ar.id AS rule_id, ar.interval_days, ar.interval_months, ar.end_of_month, ar.thresholds AS alert_thresholds,
           ar.kind, ar.rule_config, ar.rule_condition, ar.business_days
    FROM columns col
    JOIN grids g ON g.id = col.grid_id AND g.is_active = 1
    JOIN alert_rules ar ON ar.id = CAST(json_extract(col.config, '$.alert_rule_id') AS INTEGER)
    WHERE col.column_type IN ('date', 'deadline') AND json_extract(col.config, '$.alert_rule_id') IS NOT NULL
      AND (COALESCE(ar.kind, 'interval') != 'interval' OR ar.rule_condition IS NOT NULL)
      AND (? IS NULL OR g.id = ?)
  `).all(q.gridId ?? null, q.gridId ?? null) as RuleColumn[]
  for (const rc of ruleColumns) {
    const refs = referencedColumns(engineRuleFrom({ ...rc, id: rc.rule_id })).filter(id => Number.isInteger(id) && id > 0)
    const refSelect = refs.map((id, i) => `, (SELECT value FROM cells WHERE row_id = r.id AND column_id = ${id}) AS ref_${i}`).join('')
    const recs = getDb().prepare(`
      SELECT r.id AS row_id, r.display_name AS client_name, g.record_kind,
             (SELECT value FROM cells WHERE row_id = r.id AND column_id = ?) AS own ${refSelect}
      FROM rows r JOIN grids g ON g.id = r.grid_id
      WHERE r.grid_id = ? AND r.is_active = 1 AND r.deleted_at IS NULL ${rowFilter}
    `).all(rc.column_id, rc.grid_id, ...(q.rowIds ?? [])) as Array<Record<string, unknown> & { row_id: number; client_name: string | null; record_kind: string | null; own: string | null }>
    const parsed = engineRuleFrom({ ...rc, id: rc.rule_id })
    const history = meterHistories(meterHistoryColumn(parsed))
    const counts = parsed.kind === 'quota' && parsed.config ? quotaCounts(rc.grid_id, parsed.config as QuotaConfig) : new Map<number, number>()
    const progress = parsed.kind === 'sequence' ? progressEntries(rc.column_id) : new Map<number, Array<{ step: number; anchor: string | null }>>()
    for (const rec of recs) {
      const values: Record<number, string | null> = {}
      refs.forEach((id, i) => { values[id] = (rec[`ref_${i}`] as string | null) ?? null })
      // Only steps done for this anchor date count; a new anchor starts a new cycle
      const anchor = sequenceAnchor(parsed, rec.own, values)
      const steps = (progress.get(rec.row_id) ?? []).filter(p => p.anchor === anchor).map(p => p.step)
      add({ ...rc, row_id: rec.row_id, client_name: rec.client_name, record_kind: rec.record_kind, date_value: rec.own ?? '' },
        { today, columnDate: rec.own, values, meterHistory: history.get(rec.row_id), activityCount: counts.get(rec.row_id) ?? 0, progress: steps, holidays: cal.holidays, weekend: cal.weekend })
    }
  }
  // Soonest first; ties in a stable order so lists don't shuffle between loads
  items.sort((a, b) => (a.due! < b.due! ? -1 : a.due! > b.due! ? 1 : a.row_id - b.row_id || a.column_id - b.column_id))
  return q.limit ? items.slice(0, q.limit) : items
}

/** Briefing counts: overdue, due today, and due in the next 7 days. */
export function deadlineCounts(today: string = localDateString()): { overdue: number; dueToday: number; dueThisWeek: number } {
  let overdue = 0, dueToday = 0, dueThisWeek = 0
  for (const d of loadDeadlines({ today })) {
    if (d.daysUntil === null) continue
    if (d.daysUntil < 0) overdue++
    else if (d.daysUntil === 0) dueToday++
    else if (d.daysUntil <= 7) dueThisWeek++
  }
  return { overdue, dueToday, dueThisWeek }
}

/**
 * For a quota rule: per record, the notes of the counted kinds between that
 * record's own start and end dates (local days; voided notes don't count).
 */
export function quotaCounts(gridId: number, cfg: QuotaConfig): Map<number, number> {
  const types = cfg.activityTypes
  const rows = getDb().prepare(`
    SELECT r.id AS row_id, COUNT(cl.id) AS n
    FROM rows r
    JOIN cells s ON s.row_id = r.id AND s.column_id = ?
    JOIN cells e ON e.row_id = r.id AND e.column_id = ?
    JOIN case_log cl ON cl.row_id = r.id AND cl.voided_at IS NULL
      AND cl.log_type IN (${types.map(() => '?').join(',')})
      AND date(cl.created_at, 'localtime') BETWEEN substr(s.value, 1, 10) AND substr(e.value, 1, 10)
    WHERE r.grid_id = ?
    GROUP BY r.id
  `).all(cfg.startColumnId, cfg.endColumnId, ...types, gridId) as Array<{ row_id: number; n: number }>
  return new Map(rows.map(r => [r.row_id, r.n]))
}

/** Extensions in effect, keyed `${rowId}:${columnId}`. */
export function activeExtensions(): Map<string, StoredExtension[]> {
  const out = new Map<string, StoredExtension[]>()
  const rows = getDb().prepare('SELECT id, row_id, column_id, step, new_due, reason, anchor_value FROM deadline_extensions WHERE revoked_at IS NULL ORDER BY id DESC').all() as
    Array<{ id: number; row_id: number; column_id: number; step: number | null; new_due: string; reason: string; anchor_value: string | null }>
  for (const r of rows) {
    const key = `${r.row_id}:${r.column_id}`
    out.set(key, [...(out.get(key) ?? []), { id: r.id, newDue: r.new_due, reason: r.reason, anchor: r.anchor_value, step: r.step }])
  }
  return out
}

/** Steps done on a sequence column, by record, with the anchor date each was done for. */
export function progressEntries(columnId: number): Map<number, Array<{ step: number; anchor: string | null }>> {
  const out = new Map<number, Array<{ step: number; anchor: string | null }>>()
  const rows = getDb().prepare('SELECT row_id, step, anchor_value FROM deadline_progress WHERE column_id = ?').all(columnId) as Array<{ row_id: number; step: number; anchor_value: string | null }>
  for (const r of rows) out.set(r.row_id, [...(out.get(r.row_id) ?? []), { step: r.step, anchor: r.anchor_value }])
  return out
}

/** Readings over the last 181 days for a meter column, by record (from field history). */
export function meterHistories(columnId: number | null): Map<number, Array<{ at: string; value: number }>> {
  const out = new Map<number, Array<{ at: string; value: number }>>()
  if (!columnId) return out
  const rows = getDb().prepare(`
    SELECT row_id, date(changed_at, 'localtime') AS at, new_value FROM cell_history
    WHERE column_id = ? AND changed_at >= datetime('now', '-181 days') ORDER BY changed_at
  `).all(columnId) as Array<{ row_id: number; at: string; new_value: string | null }>
  for (const r of rows) {
    const value = Number((r.new_value ?? '').replace(/,/g, ''))
    if (!r.new_value || !Number.isFinite(value)) continue
    out.set(r.row_id, [...(out.get(r.row_id) ?? []), { at: r.at, value }])
  }
  return out
}


export function loadGridDeadlineContext(gridId: number): GridDeadlineContext {
  const ctx: GridDeadlineContext = { meter: {}, quota: {}, progress: {}, extensions: {} }
  for (const [key, exts] of activeExtensions()) ctx.extensions[key] = exts
  const ruleRows = getDb().prepare(`
    SELECT col.id AS column_id, ar.id, ar.kind, ar.rule_config, ar.rule_condition, ar.business_days, ar.interval_days, ar.interval_months, ar.end_of_month
    FROM columns col JOIN alert_rules ar ON ar.id = CAST(json_extract(col.config, '$.alert_rule_id') AS INTEGER)
    WHERE col.grid_id = ? AND ar.kind IN ('meter', 'quota', 'sequence')
  `).all(gridId) as Array<Parameters<typeof engineRuleFrom>[0] & { column_id: number }>
  for (const r of ruleRows) {
    const rule = engineRuleFrom(r)
    const col = meterHistoryColumn(rule)
    for (const [rowId, readings] of meterHistories(col)) ctx.meter[`${rowId}:${col}`] = readings
    if (rule.kind === 'quota' && rule.config) {
      for (const [rowId, n] of quotaCounts(gridId, rule.config as QuotaConfig)) ctx.quota[`${rowId}:${r.column_id}`] = n
    }
    if (rule.kind === 'sequence') {
      for (const [rowId, entries] of progressEntries(r.column_id)) ctx.progress[`${rowId}:${r.column_id}`] = entries
    }
  }
  return ctx
}
