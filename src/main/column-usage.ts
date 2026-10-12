/**
 * What depends on a column (audit 2026-10, items 1.8 / D-25 / L-10).
 *
 * Rules, other columns, appointment series, the list's sort, saved views,
 * filters, reports and forms point at columns by id inside JSON. Deleting the
 * column quietly breaks them, so the delete dialog lists them first.
 */
import { getDb } from './database'
import { word } from './vocab'
import { NOT_TRASHED_ROW } from '../shared/liveRecords'

/** Keys that hold a column id but don't end in "columnId" */
const EXTRA_REF_KEYS = new Set(['fromcolumnmonth'])

function isRefKey(key: string): boolean {
  const k = key.toLowerCase().replace(/_/g, '')
  return k.endsWith('columnid') || EXTRA_REF_KEYS.has(k)
}

/** Whether a JSON value mentions this column id under a column-id key, at any depth. */
export function jsonRefersToColumn(raw: string | null | undefined, columnId: number): boolean {
  if (!raw) return false
  let v: unknown
  try { v = JSON.parse(raw) } catch { return false }
  // Reports name fields "col:12" (or "col:12:month")
  const field = new RegExp(`^col:${columnId}(:|$)`)
  const walk = (x: unknown): boolean => {
    if (typeof x === 'string') return field.test(x)
    if (Array.isArray(x)) return x.some(walk)
    if (!x || typeof x !== 'object') return false
    for (const [k, val] of Object.entries(x as Record<string, unknown>)) {
      if (isRefKey(k) && (val === columnId || val === String(columnId))) return true
      if (walk(val)) return true
    }
    return false
  }
  return walk(v)
}

const quote = (s: string) => `"${s}"`

/**
 * Plain descriptions of everything that uses this column, for the delete
 * dialog: 'Deadline rule "Within 30 days"', 'Form "Intake"'… Empty when
 * nothing does.
 */
export function columnDependents(columnId: number): string[] {
  const db = getDb()
  const col = db.prepare('SELECT id, grid_id FROM columns WHERE id = ?').get(columnId) as { id: number; grid_id: number } | undefined
  if (!col) return []
  const out: string[] = []

  const rules = db.prepare('SELECT name, rule_config, rule_condition FROM alert_rules ORDER BY name').all() as
    Array<{ name: string; rule_config: string | null; rule_condition: string | null }>
  for (const r of rules) {
    if (jsonRefersToColumn(r.rule_config, columnId) || jsonRefersToColumn(r.rule_condition, columnId)) out.push(`Deadline rule ${quote(r.name)}`)
  }

  const others = db.prepare('SELECT id, name, config, conditional_format FROM columns WHERE grid_id = ? AND id != ? ORDER BY position').all(col.grid_id, columnId) as
    Array<{ id: number; name: string; config: string | null; conditional_format: string | null }>
  for (const c of others) {
    if (jsonRefersToColumn(c.config, columnId)) out.push(`Column ${quote(c.name)} (its settings use this column)`)
    else if (jsonRefersToColumn(c.conditional_format, columnId)) out.push(`Format rules on column ${quote(c.name)}`)
  }

  // Cells people can see: a record in the Trash isn't counted (Q-084)
  const formatted = (db.prepare(`SELECT cf.rules FROM cell_formats cf JOIN rows r ON r.id = cf.row_id
    WHERE r.grid_id = ? AND ${NOT_TRASHED_ROW} AND cf.column_id != ?`).all(col.grid_id, columnId) as Array<{ rules: string }>)
    .filter(f => jsonRefersToColumn(f.rules, columnId)).length
  if (formatted > 0) out.push(`Format rules on ${formatted} cell${formatted === 1 ? '' : 's'}`)

  const series = (db.prepare('SELECT rule FROM appointment_series').all() as Array<{ rule: string }>)
    .filter(s => jsonRefersToColumn(s.rule, columnId)).length
  if (series > 0) out.push(`${series} repeating ${word('appointment', { count: series })} that end on this date`)

  const grid = db.prepare('SELECT sort_config FROM grids WHERE id = ?').get(col.grid_id) as { sort_config: string | null } | undefined
  if (jsonRefersToColumn(grid?.sort_config, columnId)) out.push(`The ${word('list', {}, col.grid_id)}'s sort order`)

  const named = (sql: string, label: string, field = 'config') => {
    for (const r of db.prepare(sql).all(col.grid_id) as Array<Record<string, string>>) {
      if (jsonRefersToColumn(r[field], columnId)) out.push(`${label} ${quote(r.name ?? '')}`)
    }
  }
  named('SELECT name, config FROM saved_views WHERE grid_id = ? ORDER BY name', 'Saved view')
  named('SELECT name, filter_config FROM saved_filters WHERE grid_id = ? ORDER BY name', 'Saved filter', 'filter_config')
  named('SELECT name, config FROM report_definitions WHERE grid_id = ? ORDER BY name', 'Report')
  named('SELECT name, fields FROM forms WHERE grid_id = ? ORDER BY name', 'Form', 'fields')
  return out
}
