/**
 * filterMatch.ts — Column filter matching logic.
 * Extracted from DataGrid for testability and reuse.
 */

import type { GridRow, Column, ColumnFilter, ParsedAlertRule } from '../../shared/types'
import { ROW_TAG_COLUMN_ID, ANY_DEADLINE_COLUMN_ID, takesDeadlineRule } from '../../shared/types'
import { evaluateRuleForRow } from './deadlineCalc'
import { linkValueText, parseLinkValue } from '../../shared/links'
import { localDateString } from '../../shared/dates'
import { computedColumnNumber, isComputedColumnType } from './computedColumns'

/** A typed amount as a number: "$1,200.50" is 1200.5, the way paste reads it; NaN when it isn't one */
function amount(text: string): number {
  const cleaned = text.replace(/[$,\s]/g, '')
  return cleaned === '' ? NaN : Number(cleaned)
}

/** A date filter value meaning "the day it's checked", so a saved "in the past" never freezes (G-40) */
export const TODAY_TOKEN = '@today'

export const DUE_STATUSES: Array<{ value: string; label: string }> = [
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Due today' },
  { value: 'next7', label: 'Due in the next 7 days' },
  { value: 'next30', label: 'Due in the next 30 days' },
  { value: 'done', label: 'Done' },
  { value: 'paused', label: 'Paused' },
]

/** The deadline rule on a column, if it has one */
export function ruleOfColumn(col: Column | undefined, rules: Map<number, ParsedAlertRule> | undefined): ParsedAlertRule | undefined {
  if (!col || !rules || !takesDeadlineRule(col.column_type)) return undefined
  try {
    const id = (JSON.parse(col.config || '{}') as { alert_rule_id?: number }).alert_rule_id
    return id !== undefined ? rules.get(id) : undefined
  } catch { return undefined }
}

/** Whether a deadline is in a "due status" bucket, worked out by the engine like its color (G-12) */
function dueStatusIs(row: GridRow, col: Column, rule: ParsedAlertRule, status: string): boolean {
  const res = evaluateRuleForRow(rule, (row[`col_${col.id}` as keyof GridRow] as string | null) ?? null, row as unknown as Record<string, unknown>, col.id)
  if (status === 'done') return res.state === 'done'
  if (status === 'paused') return res.state === 'paused'
  if (res.state === 'done' || res.state === 'paused' || res.daysUntil === null) return false
  const d = res.daysUntil
  if (status === 'overdue') return d < 0
  if (status === 'today') return d === 0
  if (status === 'next7') return d >= 0 && d <= 7
  if (status === 'next30') return d >= 0 && d <= 30
  return false
}

export function matchFilter(
  row: GridRow,
  filter: ColumnFilter,
  columns: Column[],
  rowTagsMap?: Map<number, string[]>,
  rules?: Map<number, ParsedAlertRule>,
): boolean {
  if (filter.operator === 'due_status') {
    const targets = filter.columnId === ANY_DEADLINE_COLUMN_ID ? columns : columns.filter(c => c.id === filter.columnId)
    return targets.some(c => { const rule = ruleOfColumn(c, rules); return !!rule && dueStatusIs(row, c, rule, filter.value) })
  }
  // Special case: row-level tag filter (columnId === -1)
  if (filter.columnId === ROW_TAG_COLUMN_ID) {
    const tagNames = rowTagsMap?.get(row.row_id) ?? []
    const tagStr = tagNames.join(',').toLowerCase()
    const v = filter.value.toLowerCase()
    switch (filter.operator) {
      case 'is_empty':     return tagNames.length === 0
      case 'is_not_empty': return tagNames.length > 0
      case 'contains':     return tagStr.includes(v)
      case 'not_contains': return !tagStr.includes(v)
      default:             return true
    }
  }

  const col = columns.find(c => c.id === filter.columnId)
  const stored = row[`col_${filter.columnId}` as keyof GridRow] as string | null
  // Link columns (W04) match on the linked names, or on one linked record
  if (col?.column_type === 'link' && filter.operator === 'links_to') {
    return parseLinkValue(stored).some(c => String(c.rowId) === filter.value)
  }
  // Age and Days-until store nothing: compare the number the cell shows
  const computed = col && isComputedColumnType(col.column_type) ? computedColumnNumber(col, row, columns, rules) : undefined
  const originalVal = computed !== undefined ? (computed === null ? null : String(computed))
    : col?.column_type === 'link' ? (linkValueText(stored) || null) : stored
  const rawVal = originalVal ?? ''
  // Normalize checkbox: 'true' or '1' → 'true', everything else → 'false'
  const cellVal = col?.column_type === 'checkbox'
    ? ((rawVal === 'true' || rawVal === '1') ? 'true' : 'false')
    : rawVal
  const v = filter.value === TODAY_TOKEN ? localDateString() : filter.value
  // Numbers compare as numbers: "1,000" is a thousand, "$100" a hundred, 1200.5 equals "1200.50"
  const numeric = col?.column_type === 'number' || col?.column_type === 'currency' || computed !== undefined
  if (numeric && (filter.operator === 'equals' || filter.operator === 'not_equals')) {
    const n = amount(cellVal), m = amount(v)
    if (!isNaN(n) && !isNaN(m)) return filter.operator === 'equals' ? n === m : n !== m
  }
  switch (filter.operator) {
    case 'is_empty':      return originalVal == null || originalVal === ''
    case 'is_not_empty':  return originalVal != null && originalVal !== ''
    case 'equals':        return cellVal.toLowerCase() === v.toLowerCase()
    case 'not_equals':    return cellVal.toLowerCase() !== v.toLowerCase()
    case 'contains':      return cellVal.toLowerCase().includes(v.toLowerCase())
    case 'not_contains':  return !cellVal.toLowerCase().includes(v.toLowerCase())
    case 'starts_with':   return cellVal.toLowerCase().startsWith(v.toLowerCase())
    case 'ends_with':     return cellVal.toLowerCase().endsWith(v.toLowerCase())
    case 'gt': {
      const n = amount(cellVal), m = amount(v)
      return !isNaN(n) && !isNaN(m) && n > m
    }
    case 'lt': {
      const n = amount(cellVal), m = amount(v)
      return !isNaN(n) && !isNaN(m) && n < m
    }
    case 'before': {
      if (cellVal === '' || v === '') return false
      const cellDate = new Date(cellVal).getTime()
      const filterDate = new Date(v).getTime()
      return !isNaN(cellDate) && !isNaN(filterDate) && cellDate < filterDate
    }
    case 'after': {
      if (cellVal === '' || v === '') return false
      const cellDate = new Date(cellVal).getTime()
      const filterDate = new Date(v).getTime()
      return !isNaN(cellDate) && !isNaN(filterDate) && cellDate > filterDate
    }
    default:       return true
  }
}
