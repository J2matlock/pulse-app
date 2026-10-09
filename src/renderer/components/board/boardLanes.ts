/**
 * The board's lanes (W06 §3): which records show, in which stage, in what
 * order. Pure, so the board and its tests agree.
 */
import type { Column, ColumnFilter, GridRow, ParsedAlertRule } from '../../../shared/types'
import type { StageConfig, StageOption } from '../../../shared/stages'
import { DEFAULT_HIDE_DONE_DAYS } from '../../../shared/stages'
import { linkValueText } from '../../../shared/links'
import { parseDbTimestamp } from '../../../shared/dates'
import { matchFilter } from '../../utils/filterMatch'
import { evaluateRuleForRow } from '../../utils/deadlineCalc'

export interface Lane {
  /** null = "No stage" */
  option: StageOption | null
  rows: GridRow[]
  /** Done records left out because they've been done a while */
  hidden: number
}

export interface BoardFilters {
  activeFilters: ColumnFilter[]
  filterMode: 'and' | 'or'
  showStarredOnly: boolean
  searchQuery: string
  rowTagsMap?: Map<number, string[]>
}

/** The same filters and search the table uses */
export function visibleRows(rows: GridRow[], columns: Column[], f: BoardFilters): GridRow[] {
  let result = rows
  if (f.showStarredOnly) result = result.filter(r => r.is_starred === 1)
  if (f.activeFilters.length) {
    const match = (r: GridRow) => f.filterMode === 'or'
      ? f.activeFilters.some(x => matchFilter(r, x, columns, f.rowTagsMap))
      : f.activeFilters.every(x => matchFilter(r, x, columns, f.rowTagsMap))
    result = result.filter(match)
  }
  const q = f.searchQuery.trim().toLowerCase()
  if (q) {
    const searchable = columns.filter(c => c.is_name_column || ['text', 'dropdown', 'auto_number', 'link'].includes(c.column_type))
    result = result.filter(r => searchable.some(c => {
      const v = r[`col_${c.id}`]
      return (c.column_type === 'link' ? linkValueText(v) : String(v ?? '')).toLowerCase().includes(q)
    }))
  }
  return result
}

/** The nearest deadline on a record, across its columns with rules */
export function nearestDeadline(row: GridRow, columns: Column[], rules: ParsedAlertRule[]): { daysUntil: number; column: Column; rule: ParsedAlertRule } | null {
  let best: { daysUntil: number; column: Column; rule: ParsedAlertRule } | null = null
  for (const c of columns) {
    if (c.column_type !== 'date' && c.column_type !== 'deadline') continue
    let ruleId: number | undefined
    try { ruleId = (JSON.parse(c.config || '{}') as { alert_rule_id?: number }).alert_rule_id } catch { continue }
    const rule = ruleId !== undefined ? rules.find(r => r.id === ruleId) : undefined
    if (!rule) continue
    const res = evaluateRuleForRow(rule, row[`col_${c.id}`] ?? null, row as unknown as Record<string, unknown>, c.id)
    if (res.daysUntil === null || res.state === 'paused' || res.state === 'done') continue
    if (!best || res.daysUntil < best.daysUntil) best = { daysUntil: res.daysUntil, column: c, rule }
  }
  return best
}

/**
 * One lane per stage, in order, plus "No stage" when anything has none.
 * Within a lane: nearest deadline first, then name. Done records that
 * haven't changed in `hideDoneAfterDays` are counted, not shown.
 */
export function buildLanes(rows: GridRow[], stageColumnId: number, config: StageConfig, opts: {
  nameOf: (r: GridRow) => string
  dueOf: (r: GridRow) => number | null
  /** When it entered its stage (stored UTC timestamp), if known; otherwise its last change counts */
  sinceOf?: (r: GridRow) => string | null
  now?: Date
}): Lane[] {
  const now = opts.now ?? new Date()
  const hideAfter = config.hideDoneAfterDays ?? DEFAULT_HIDE_DONE_DAYS
  const lanes: Lane[] = config.options.map(option => ({ option, rows: [], hidden: 0 }))
  const byValue = new Map(lanes.map(l => [l.option!.value, l]))
  const none: Lane = { option: null, rows: [], hidden: 0 }
  for (const r of rows) {
    const lane = byValue.get(String(r[`col_${stageColumnId}`] ?? '')) ?? none
    if (lane.option?.done && hideAfter > 0) {
      const since = opts.sinceOf?.(r) ?? r.updated_at
      const changed = since ? parseDbTimestamp(since).getTime() : NaN
      if (!Number.isNaN(changed) && (now.getTime() - changed) / 86_400_000 > hideAfter) { lane.hidden++; continue }
    }
    lane.rows.push(r)
  }
  const sortKey = new Map(rows.map(r => [r.row_id, { due: opts.dueOf(r), name: opts.nameOf(r) }]))
  for (const lane of [...lanes, none]) {
    lane.rows.sort((a, b) => {
      const ka = sortKey.get(a.row_id)!, kb = sortKey.get(b.row_id)!
      if (ka.due !== kb.due) return ka.due === null ? 1 : kb.due === null ? -1 : ka.due - kb.due
      return ka.name.localeCompare(kb.name, undefined, { numeric: true, sensitivity: 'base' })
    })
  }
  return none.rows.length || none.hidden ? [...lanes, none] : lanes
}
