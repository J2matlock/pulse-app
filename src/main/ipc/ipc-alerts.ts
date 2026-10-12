/**
 * ipc-alerts.ts — ALERT_RULE_* IPC handlers
 */

import { IPC } from '../../shared/ipc-channels'
import { secureWrap, logNonFatal, ok, fail, buildSafeSetClause, validId, enforceWritable } from './ipc-utils'
import { getDb } from '../database'
import type { AlertRule, AlertRuleUse, DeletedAlertRule } from '../../shared/types'
import { RULE_KINDS, conditionSchema, parseRuleConfig, type RuleKind } from '../../shared/deadlineEngine'
import { convertDateColumnsToDeadline } from '../rule-columns'
import { LIVE_GRID } from '../../shared/liveRecords'

/** Calendar-month intervals: whole months up to 10 years (null/0 = not month-based). */
function validMonths(v: unknown): boolean {
  return v == null || (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 120)
}

/**
 * Check the W05 fields (kind, settings, condition, business days). Returns the
 * values to store, or a plain-language problem.
 */
function validEngineFields(input: Partial<AlertRule>, current?: { kind?: string | null }): { fields: Record<string, unknown> } | { error: string } {
  const fields: Record<string, unknown> = {}
  const kind = (input.kind ?? current?.kind ?? 'interval') as RuleKind
  if (input.kind !== undefined) {
    if (!(RULE_KINDS as readonly string[]).includes(input.kind)) return { error: 'Unknown kind of deadline' }
    fields.kind = input.kind
  }
  if (input.rule_config !== undefined || input.kind !== undefined) {
    const cfg = parseRuleConfig(kind, input.rule_config ?? null)
    if (!cfg.ok) return { error: cfg.error }
    fields.rule_config = cfg.config === null ? null : JSON.stringify(cfg.config)
  }
  if (input.rule_condition !== undefined) {
    if (input.rule_condition === null || input.rule_condition === '') fields.rule_condition = null
    else {
      let data: unknown
      try { data = JSON.parse(input.rule_condition) } catch { return { error: 'The "only when" setting could not be read.' } }
      const c = conditionSchema.safeParse(data)
      if (!c.success) return { error: 'The "only when" setting is incomplete.' }
      fields.rule_condition = JSON.stringify(c.data)
    }
  }
  // 1 = a day off moves to the working day before, 2 = to the next working day
  if (input.business_days !== undefined) fields.business_days = input.business_days === 2 ? 2 : input.business_days ? 1 : 0
  return { fields }
}

export function registerAlertHandlers(): void {
  secureWrap(IPC.ALERT_RULE_GET_ALL, 'ipc-alerts', () => {
    const rules = getDb().prepare('SELECT * FROM alert_rules ORDER BY name ASC').all() as AlertRule[]
    return ok(rules)
  })

  secureWrap(IPC.ALERT_RULE_CREATE, 'ipc-alerts', (_e, rule: Omit<AlertRule, 'id' | 'created_at'>) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!rule || typeof rule !== 'object') return fail('Invalid rule')
    if (typeof rule.name !== 'string' || !rule.name.trim() || rule.name.length > 200) return fail('Invalid rule name')
    if (rule.description != null && (typeof rule.description !== 'string' || rule.description.length > 2000)) return fail('Invalid rule description')
    if (typeof rule.thresholds !== 'string' || rule.thresholds.length > 10_000) return fail('Thresholds too large')
    try { JSON.parse(rule.thresholds) } catch (err) { logNonFatal('ipc-alerts', 'Invalid thresholds JSON', err); return fail('Invalid thresholds JSON') }
    if (rule.interval_days != null && (!Number.isInteger(rule.interval_days) || rule.interval_days < 0)) return fail('Invalid interval_days')
    if (!validMonths(rule.interval_months)) return fail('Invalid interval_months')
    const engine = validEngineFields(rule)
    if ('error' in engine) return fail(engine.error)
    const f = engine.fields
    const result = getDb().prepare(`
      INSERT INTO alert_rules (name, description, is_system, thresholds, interval_days, interval_months, end_of_month,
        kind, rule_config, rule_condition, business_days, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(rule.name, rule.description ?? null, 0, rule.thresholds, rule.interval_days ?? null, rule.interval_months || null, rule.end_of_month ? 1 : 0,
      (f.kind as string | undefined) ?? 'interval', (f.rule_config as string | null | undefined) ?? null, (f.rule_condition as string | null | undefined) ?? null, (f.business_days as number | undefined) ?? 0)
    return ok(result.lastInsertRowid)
  })

  secureWrap(IPC.ALERT_RULE_UPDATE, 'ipc-alerts', (_e, id: number, updates: Partial<AlertRule>) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(id)) return fail('Invalid ID')
    if (!updates || typeof updates !== 'object') return fail('Invalid rule')
    if (updates.description != null && (typeof updates.description !== 'string' || updates.description.length > 2000)) return fail('Invalid rule description')
    if (updates.thresholds !== undefined) {
      if (typeof updates.thresholds !== 'string' || updates.thresholds.length > 10_000) return fail('Thresholds too large')
      try { JSON.parse(updates.thresholds) } catch (err) { logNonFatal('ipc-alerts', 'Invalid thresholds JSON', err); return fail('Invalid thresholds JSON') }
    }
    if (updates.name !== undefined && (typeof updates.name !== 'string' || !updates.name.trim() || updates.name.length > 200)) return fail('Invalid rule name')
    if (updates.interval_months !== undefined && !validMonths(updates.interval_months)) return fail('Invalid interval_months')
    const current = getDb().prepare('SELECT kind FROM alert_rules WHERE id = ?').get(id) as { kind: string | null } | undefined
    if (!current) return fail('Alert rule not found')
    const engine = validEngineFields(updates, current)
    if ('error' in engine) return fail(engine.error)
    const normalized: Record<string, unknown> = { ...updates, ...engine.fields }
    if (updates.end_of_month !== undefined) normalized.end_of_month = updates.end_of_month ? 1 : 0
    if (updates.interval_months !== undefined) normalized.interval_months = updates.interval_months || null
    const allowed = ['name', 'description', 'thresholds', 'interval_days', 'interval_months', 'end_of_month',
      'kind', 'rule_config', 'rule_condition', 'business_days'] as const
    const result = buildSafeSetClause(normalized, allowed)
    if (!result) return fail('No valid fields to update')
    const db = getDb()
    db.transaction(() => {
      db.prepare(`UPDATE alert_rules SET ${result.setClause} WHERE id = ?`).run(...result.values, id)
      // Now worked out from another date: its Date columns hold the done date, so they become Deadline columns
      convertDateColumnsToDeadline(db, id)
    })()
    return ok(true)
  })

  secureWrap(IPC.ALERT_RULE_USAGE, 'ipc-alerts', () => ok(ruleUsage()))

  secureWrap(IPC.ALERT_RULE_DELETE, 'ipc-alerts', (_e, id: number) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(id)) return fail('Invalid ID')
    const db = getDb()
    const rule = db.prepare('SELECT * FROM alert_rules WHERE id = ?').get(id) as AlertRule | undefined
    if (!rule) return fail('Alert rule not found')
    if (rule.is_system) return fail("Built-in deadline rules can't be deleted.")
    // Unlink every column in the same step: a column left pointing at a missing
    // rule would stop being a deadline in the grid but not everywhere else
    const columnIds = db.transaction(() => {
      const cols = db.prepare(`SELECT id FROM columns WHERE CAST(json_extract(config, '$.alert_rule_id') AS INTEGER) = ?`).all(id) as Array<{ id: number }>
      const unlink = db.prepare(`UPDATE columns SET config = json_remove(config, '$.alert_rule_id', '$.alert_rule_name') WHERE id = ?`)
      for (const c of cols) unlink.run(c.id)
      db.prepare('DELETE FROM alert_rules WHERE id = ?').run(id)
      return cols.map(c => c.id)
    })()
    const snapshot: DeletedAlertRule = { rule, columnIds }
    return ok(snapshot)
  })

  // Undo of a delete: the rule comes back with its id, and the columns it was
  // taken from use it again (unless they've been given another rule since)
  secureWrap(IPC.ALERT_RULE_RESTORE, 'ipc-alerts', (_e, snapshot: DeletedAlertRule) => {
    const guard = enforceWritable(); if (guard) return guard
    const r = snapshot?.rule
    if (!r || !validId(r.id) || typeof r.name !== 'string' || !r.name.trim() || r.name.length > 200) return fail('Invalid rule')
    if (typeof r.thresholds !== 'string' || r.thresholds.length > 10_000) return fail('Thresholds too large')
    if (!Array.isArray(snapshot.columnIds) || snapshot.columnIds.length > 10_000 || !snapshot.columnIds.every(validId)) return fail('Invalid columns')
    if (!validMonths(r.interval_months)) return fail('Invalid interval_months')
    const engine = validEngineFields({ kind: r.kind ?? 'interval', rule_config: r.rule_config ?? null, rule_condition: r.rule_condition ?? null })
    if ('error' in engine) return fail(engine.error)
    const f = engine.fields
    const db = getDb()
    const id = db.transaction(() => {
      const taken = db.prepare('SELECT 1 FROM alert_rules WHERE id = ?').get(r.id)
      const res = db.prepare(`
        INSERT INTO alert_rules (id, name, description, is_system, thresholds, interval_days, interval_months, end_of_month,
          kind, rule_config, rule_condition, business_days, created_at)
        VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))
      `).run(taken ? null : r.id, r.name, r.description ?? null, r.thresholds,
        Number.isInteger(r.interval_days) ? r.interval_days : null, r.interval_months || null, r.end_of_month ? 1 : 0,
        (f.kind as string | undefined) ?? 'interval', (f.rule_config as string | null | undefined) ?? null,
        (f.rule_condition as string | null | undefined) ?? null, r.business_days === 2 ? 2 : r.business_days ? 1 : 0,
        typeof r.created_at === 'string' ? r.created_at : null)
      const newId = Number(res.lastInsertRowid)
      const relink = db.prepare(`UPDATE columns SET config = json_set(COALESCE(config, '{}'), '$.alert_rule_id', ?)
        WHERE id = ? AND json_extract(COALESCE(config, '{}'), '$.alert_rule_id') IS NULL`)
      for (const c of snapshot.columnIds) relink.run(newId, c)
      return newId
    })()
    return ok(id)
  })
}

/** Every column that uses a rule, in lists that are still in use. */
export function ruleUsage(): AlertRuleUse[] {
  const rows = getDb().prepare(`
    SELECT CAST(json_extract(col.config, '$.alert_rule_id') AS INTEGER) AS rule_id, col.id AS column_id, col.name AS column_name,
           g.id AS grid_id, g.name AS grid_name, col.is_visible
    FROM columns col JOIN grids g ON g.id = col.grid_id AND ${LIVE_GRID}
    WHERE json_extract(col.config, '$.alert_rule_id') IS NOT NULL
    ORDER BY g.position, g.id, col.position, col.id
  `).all() as Array<Omit<AlertRuleUse, 'hidden'> & { is_visible: number }>
  return rows.map(({ is_visible, ...u }) => ({ ...u, hidden: is_visible === 0 }))
}
