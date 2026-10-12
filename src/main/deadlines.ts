/**
 * Loads deadlines and works them out with the shared engine
 * (plans/generalization/W05-deadline-engine.md §2.2). Everything that lists
 * deadlines — dashboard, briefing, planner, calendar export, reports — goes
 * through here, so they all agree.
 */
import { getDb } from './database'
import { evaluate, isUsedUp, meterInfo, type MeterInfo, engineRuleFrom, meterHistoryColumn, referencedColumns, extensionAnchor, matchExtension, applyExtension, type StoredExtension, type QuotaConfig, type DeadlineResult, type EngineRule, type RecordContext, type RuleKind, buildRecordContext, RULE_KINDS } from '../shared/deadlineEngine'
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
  /** Meter rules: unit and readings, for the "current reading?" question */
  meter?: MeterInfo
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
  /** Archived records too (exports that print them; never records or lists in the Trash) (F-020) */
  includeArchived?: boolean
}

type RuleFields = { kind: string | null; rule_config: string | null; rule_condition: string | null; business_days: number | null }

/** Days off for business-day rules (Settings → Deadlines & reminders → Days off). */
export function loadWorkCalendar(): WorkCalendar {
  const c = workCalendarSetting()
  return { holidays: new Set(c.holidays), weekend: c.weekend }
}

interface Row extends RuleFields {
  row_id: number; grid_id: number; grid_name: string; column_id: number; column_name: string; column_config: string
  date_value: string; client_name: string | null; record_kind: string | null; rule_id: number | null
  interval_days: number | null; interval_months: number | null; end_of_month: number | null; alert_thresholds: string | null
  /** A one-off date marked Finished for this value (Decision E1) */
  finished_for?: string | null
}

interface RuleColumn extends RuleFields {
  column_id: number; column_name: string; column_config: string; grid_id: number; grid_name: string; rule_id: number
  interval_days: number | null; interval_months: number | null; end_of_month: number | null; alert_thresholds: string | null
}

export function loadDeadlines(q: DeadlineQuery = {}): DeadlineItem[] {
  const today = q.today ?? localDateString()
  const cal = loadWorkCalendar()
  const rowFilter = q.rowIds?.length ? `AND r.id IN (${q.rowIds.map(() => '?').join(',')})` : ''
  const activeOnly = q.includeArchived ? '' : 'AND r.is_active = 1'
  // Plain interval rules need only the filled-in cell: one query for all of them
  const rows = getDb().prepare(`
    SELECT r.id AS row_id, r.grid_id, g.name AS grid_name, col.id AS column_id, col.name AS column_name,
           col.config AS column_config, c.value AS date_value, r.display_name AS client_name, g.record_kind, ar.id AS rule_id,
           ar.interval_days, ar.interval_months, ar.end_of_month, ar.thresholds AS alert_thresholds,
           ar.kind, ar.rule_config, ar.rule_condition, ar.business_days, dd.done_for AS finished_for
    FROM cells c
    JOIN rows r   ON r.id = c.row_id ${activeOnly} AND r.deleted_at IS NULL
    JOIN grids g  ON g.id = r.grid_id AND g.is_active = 1
    JOIN columns col ON col.id = c.column_id AND col.column_type IN ('date', 'deadline')
      AND json_extract(col.config, '$.alert_rule_id') IS NOT NULL
    JOIN alert_rules ar ON ar.id = CAST(json_extract(col.config, '$.alert_rule_id') AS INTEGER)
    LEFT JOIN deadline_done dd ON dd.row_id = r.id AND dd.column_id = col.id AND dd.done_for = substr(c.value, 1, 10)
    WHERE c.value IS NOT NULL AND c.value != ''
      AND COALESCE(ar.kind, 'interval') = 'interval' AND ar.rule_condition IS NULL
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
    const meter = meterInfo(rule, ctx.values)
    items.push({
      ...(meter ? { meter } : {}),
      row_id: r.row_id, grid_id: r.grid_id, grid_name: r.grid_name, column_id: r.column_id, column_name: r.column_name,
      column_config: r.column_config, date_value: r.date_value, client_name: r.client_name, record_kind: r.record_kind,
      interval_days: r.interval_days, interval_months: r.interval_months, end_of_month: r.end_of_month,
      alert_thresholds: r.alert_thresholds, ...res, effective_date: res.due, rule_kind: rule.kind,
      ...(ext && res.extended ? { extension_id: ext.id } : {}),
    })
  }
  for (const r of rows) add(r, buildRecordContext(ruleFor(r), { today, columnDate: r.date_value, holidays: cal.holidays, weekend: cal.weekend, ...(r.finished_for ? { finishedFor: [r.finished_for] } : {}) }))

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
      WHERE r.grid_id = ? ${activeOnly} AND r.deleted_at IS NULL ${rowFilter}
    `).all(rc.column_id, rc.grid_id, ...(q.rowIds ?? [])) as Array<Record<string, unknown> & { row_id: number; client_name: string | null; record_kind: string | null; own: string | null }>
    const parsed = engineRuleFrom({ ...rc, id: rc.rule_id })
    const history = meterHistories(meterHistoryColumn(parsed))
    const counts = parsed.kind === 'quota' && parsed.config ? quotaCounts(rc.grid_id, parsed.config as QuotaConfig) : new Map<number, number>()
    const progress = parsed.kind === 'sequence' ? progressEntries(rc.column_id) : new Map<number, Array<{ step: number; anchor: string | null }>>()
    const previous = parsed.kind === 'calendar' ? previousValues(rc.column_id) : null
    const finished = parsed.kind === 'interval' ? finishedDates(rc.column_id) : null
    for (const rec of recs) {
      const values: Record<number, string | null> = {}
      refs.forEach((id, i) => { values[id] = (rec[`ref_${i}`] as string | null) ?? null })
      add({ ...rc, row_id: rec.row_id, client_name: rec.client_name, record_kind: rec.record_kind, date_value: rec.own ?? '' },
        buildRecordContext(parsed, {
          today, columnDate: rec.own, values, meterHistory: history.get(rec.row_id), activityCount: counts.get(rec.row_id) ?? 0,
          progress: progress.get(rec.row_id) ?? [], holidays: cal.holidays, weekend: cal.weekend,
          previousDone: previous?.has(rec.row_id) ? previous.get(rec.row_id) ?? null : undefined,
          finishedFor: finished?.get(rec.row_id),
        }))
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
    // A used-up quota is overdue, not "due today", until its end date
    if (d.daysUntil < 0 || isUsedUp(d)) overdue++
    else if (d.daysUntil === 0) dueToday++
    else if (d.daysUntil <= 7) dueThisWeek++
  }
  return { overdue, dueToday, dueThisWeek }
}

/**
 * For a quota rule: per record, the notes of the counted kinds between that
 * record's own start and end dates (local days; voided notes don't count).
 * `until` (a stored UTC timestamp) counts only notes that happened by then, for reports as of a past day.
 */
export function quotaCounts(gridId: number, cfg: QuotaConfig, until?: string): Map<number, number> {
  const types = cfg.activityTypes
  const rows = getDb().prepare(`
    SELECT r.id AS row_id, COUNT(cl.id) AS n
    FROM rows r
    JOIN cells s ON s.row_id = r.id AND s.column_id = ?
    JOIN cells e ON e.row_id = r.id AND e.column_id = ?
    JOIN case_log cl ON cl.row_id = r.id AND cl.voided_at IS NULL
      AND cl.log_type IN (${types.map(() => '?').join(',')})
      AND date(cl.occurred_at, 'localtime') BETWEEN substr(s.value, 1, 10) AND substr(e.value, 1, 10)
    WHERE r.grid_id = ? AND (? IS NULL OR cl.occurred_at <= ?)
    GROUP BY r.id
  `).all(cfg.startColumnId, cfg.endColumnId, ...types, gridId, until ?? null, until ?? null) as Array<{ row_id: number; n: number }>
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
export function progressEntries(columnId: number, doneBy?: string): Map<number, Array<{ step: number; anchor: string | null }>> {
  const out = new Map<number, Array<{ step: number; anchor: string | null }>>()
  // doneBy ('YYYY-MM-DD'): only steps checked off by that day, for reports as of a past day
  const rows = getDb().prepare('SELECT row_id, step, anchor_value FROM deadline_progress WHERE column_id = ? AND (? IS NULL OR done_at <= ?)')
    .all(columnId, doneBy ?? null, doneBy ?? null) as Array<{ row_id: number; step: number; anchor_value: string | null }>
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
  // The reading before the first recorded change was on file since the record was
  // added: one more point, so two readings are enough for a forecast (D-32)
  const firsts = getDb().prepare(`
    SELECT h.row_id, h.old_value, date(r.created_at, 'localtime') AS created, date(h.changed_at, 'localtime') AS changed
    FROM cell_history h JOIN rows r ON r.id = h.row_id
    WHERE h.column_id = ? AND r.created_at >= datetime('now', '-181 days')
      AND h.id = (SELECT MIN(h2.id) FROM cell_history h2 WHERE h2.row_id = h.row_id AND h2.column_id = h.column_id)
  `).all(columnId) as Array<{ row_id: number; old_value: string | null; created: string; changed: string }>
  for (const f of firsts) {
    const value = Number((f.old_value ?? '').replace(/,/g, ''))
    if (!f.old_value || !Number.isFinite(value) || f.created >= f.changed) continue
    out.set(f.row_id, [{ at: f.created, value }, ...(out.get(f.row_id) ?? [])])
  }
  return out
}


/**
 * For calendar rules: per record, what the column held before its latest
 * change (the previous done date). Records with no recorded change are left
 * out, which the engine reads as "not known".
 * `until` (a stored UTC timestamp): the latest change made by then, for reports as of a past day.
 */
export function previousValues(columnId: number, until?: string): Map<number, string | null> {
  const rows = getDb().prepare(`
    SELECT h.row_id, h.old_value FROM cell_history h
    WHERE h.column_id = @columnId AND h.id = (SELECT MAX(h2.id) FROM cell_history h2 WHERE h2.row_id = h.row_id AND h2.column_id = h.column_id
      AND (@until IS NULL OR h2.changed_at <= @until))
  `).all({ columnId, until: until ?? null }) as Array<{ row_id: number; old_value: string | null }>
  return new Map(rows.map(r => [r.row_id, r.old_value]))
}

/** One-off dates marked Finished on a column, by record (Decision E1). */
export function finishedDates(columnId: number): Map<number, string[]> {
  const out = new Map<number, string[]>()
  for (const r of getDb().prepare('SELECT row_id, done_for FROM deadline_done WHERE column_id = ?').all(columnId) as Array<{ row_id: number; done_for: string }>) {
    out.set(r.row_id, [...(out.get(r.row_id) ?? []), r.done_for])
  }
  return out
}

/**
 * Whether a kind's deadlines read per-record data loaded below (meter
 * readings, quota counts, step progress, previous values). Every kind is
 * listed, so a new one has to say whether it needs a loader.
 */
const LOADS_GRID_CONTEXT = {
  interval: false, relative: false, calendar: true, meter: true, quota: true, sequence: true,
} satisfies Record<RuleKind, boolean>
const CONTEXT_KINDS = RULE_KINDS.filter(k => LOADS_GRID_CONTEXT[k])

export function loadGridDeadlineContext(gridId: number): GridDeadlineContext {
  const ctx: GridDeadlineContext = { meter: {}, quota: {}, progress: {}, extensions: {}, previous: {}, finished: {} }
  for (const r of getDb().prepare('SELECT dd.row_id, dd.column_id, dd.done_for FROM deadline_done dd JOIN rows r ON r.id = dd.row_id WHERE r.grid_id = ?').all(gridId) as Array<{ row_id: number; column_id: number; done_for: string }>) {
    const key = `${r.row_id}:${r.column_id}`
    ctx.finished![key] = [...(ctx.finished![key] ?? []), r.done_for]
  }
  for (const [key, exts] of activeExtensions()) ctx.extensions[key] = exts
  const ruleRows = getDb().prepare(`
    SELECT col.id AS column_id, ar.id, ar.kind, ar.rule_config, ar.rule_condition, ar.business_days, ar.interval_days, ar.interval_months, ar.end_of_month
    FROM columns col JOIN alert_rules ar ON ar.id = CAST(json_extract(col.config, '$.alert_rule_id') AS INTEGER)
    WHERE col.grid_id = ? AND ar.kind IN (${CONTEXT_KINDS.map(() => '?').join(', ')})
  `).all(gridId, ...CONTEXT_KINDS) as Array<Parameters<typeof engineRuleFrom>[0] & { column_id: number }>
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
    if (rule.kind === 'calendar') {
      for (const [rowId, prev] of previousValues(r.column_id)) ctx.previous![`${rowId}:${r.column_id}`] = prev
    }
  }
  return ctx
}
