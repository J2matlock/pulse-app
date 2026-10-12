/**
 * Ready-made reports saved when a starter is added, so Reports isn't a blank
 * page: worked out from the lists themselves (by stage, finished per month,
 * notes per month, overdue deadlines), plus any the starter brings for its
 * trade. A report with the same name on that list isn't added twice.
 */
import { getDb } from './database'
import { word } from './vocab'
import { saveReport, listReports, ReportError } from './report-builder'
import { stageColumnOf, stageConfigOf } from '../shared/stages'
import type { ReportConfig } from '../shared/reports'
import type { Starter } from '../shared/starters/schema'

interface Col { id: number; name: string; column_type: string; config: string | null; is_name_column: number; position: number }

function columnsOf(gridId: number): Col[] {
  return getDb().prepare('SELECT id, name, column_type, config, is_name_column, position FROM columns WHERE grid_id = ? ORDER BY position').all(gridId) as Col[]
}

function hasDeadlines(cols: Col[]): boolean {
  return cols.some(c => {
    if (c.column_type === 'deadline') return true
    if (c.column_type !== 'date' || !c.config) return false
    try { return !!(JSON.parse(c.config) as { alert_rule_id?: number }).alert_rule_id } catch { return false }
  })
}

/** The reports worth having for one list, from its columns */
function suggestedFor(gridId: number, isMain: boolean): Array<{ name: string; config: ReportConfig }> {
  const db = getDb()
  const cols = columnsOf(gridId)
  const kind = (db.prepare('SELECT record_kind FROM grids WHERE id = ?').get(gridId) as { record_kind: string | null } | undefined)?.record_kind ?? 'person'
  const records = word('record', { many: true, cap: true }, gridId)
  const money = cols.find(c => c.column_type === 'currency')
  const nameCol = cols.find(c => c.is_name_column) ?? cols.find(c => c.column_type === 'text')
  const out: Array<{ name: string; config: ReportConfig }> = []
  const stage = stageColumnOf(cols)

  if (stage) {
    out.push({ name: `${records} by ${stage.name}`, config: {
      source: 'records', filters: [], groupBy: [{ field: `col:${stage.id}` }],
      values: [{ fn: 'count' }, ...(money ? [{ fn: 'sum' as const, field: `col:${money.id}` }] : [])],
      about: `How many ${records.toLowerCase()} are at each step${money ? `, and what they're worth` : ''}.`,
    } })
    // Finished per month, by the date a done stage fills in
    const doneStamp = stageConfigOf(stage)?.options.find(o => o.done && o.onEnter?.stampColumnId)?.onEnter?.stampColumnId
    const stamp = doneStamp ? cols.find(c => c.id === doneStamp) : undefined
    if (kind === 'job' && stamp) {
      out.push({ name: `${records} finished per month`, config: {
        source: 'records', filters: [], groupBy: [{ field: `col:${stamp.id}`, bucket: 'month' }],
        values: [{ fn: 'count' }, ...(money ? [{ fn: 'sum' as const, field: `col:${money.id}` }] : [])],
        dateRange: { field: `col:${stamp.id}`, preset: 'this_year' },
        about: `How much work was finished each month this year${money ? ', and its value' : ''}.`,
      } })
    }
  }
  if (isMain && kind !== 'job') {
    const activities = word('activity', { many: true, cap: true }, gridId)
    out.push({ name: `${activities} per month`, config: {
      source: 'activities', filters: [], groupBy: [{ field: 'act:date', bucket: 'month' }], values: [{ fn: 'count' }],
      dateRange: { field: 'act:date', preset: 'this_year' },
      about: `How many ${activities.toLowerCase()} were written each month this year: a quick look at how busy it's been.`,
    } })
  }
  if (isMain && hasDeadlines(cols)) {
    out.push({ name: 'Overdue deadlines', config: {
      source: 'deadlines', filters: [{ field: 'dl:state', operator: 'equals', value: 'Overdue' }], groupBy: [], values: [{ fn: 'count' }],
      columns: [...(nameCol ? [`col:${nameCol.id}`] : []), 'dl:rule', 'dl:due', 'dl:overdue'], sort: { field: 'dl:overdue', dir: 'desc' },
      about: `Everything past due in ${(db.prepare('SELECT name FROM grids WHERE id = ?').get(gridId) as { name: string }).name}, the longest overdue first.`,
    } })
  }
  return out
}

/** A starter's own report settings name columns ("col:Estimate sent on"); swap in the list's column ids */
function resolveColumns(config: unknown, cols: Col[], gridId: number): unknown {
  const byName = new Map(cols.map(c => [c.name.toLowerCase(), c.id]))
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string' && v.startsWith('col:') && !/^col:\d+$/.test(v)) {
      const id = byName.get(v.slice(4).toLowerCase())
      if (id === undefined) throw new ReportError(`It names a column "${v.slice(4)}" that isn't in the ${word('list', {}, gridId)}.`)
      return `col:${id}`
    }
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
    return v
  }
  return walk(config)
}

/**
 * Saves the ready-made reports for the lists just added (list key → id; the
 * first is the main list). Returns warnings for any of the starter's own that
 * couldn't be added.
 */
export function addStarterReports(s: Starter, gridIds: Record<string, number>, order: string[]): string[] {
  const warnings: string[] = []
  const existing = (gridId: number) => new Set(listReports(gridId).map(r => r.name.toLowerCase()))
  const save = (gridId: number, name: string, config: unknown) => {
    if (existing(gridId).has(name.toLowerCase())) return
    saveReport({ name, gridId, config })
  }
  order.forEach((key, i) => {
    const gridId = gridIds[key]
    if (!gridId) return
    for (const r of suggestedFor(gridId, i === 0)) {
      try { save(gridId, r.name, r.config) } catch { /* a list this doesn't fit: skip quietly */ }
    }
  })
  for (const r of s.reports ?? []) {
    const gridId = gridIds[r.list]
    if (!gridId) continue // that list wasn't added
    try {
      const config = resolveColumns(r.config, columnsOf(gridId), gridId) as Record<string, unknown>
      save(gridId, r.name, { ...config, ...(r.description ? { about: r.description } : {}) })
    } catch (err) {
      warnings.push(`The report "${r.name}" wasn't added. ${err instanceof ReportError ? err.message : 'Its settings aren’t valid.'}`)
    }
  }
  return warnings
}
