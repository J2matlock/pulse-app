/**
 * Age and Days-until columns store nothing; the grid works them out from
 * their source date column. Filters, highlight rules and copying a cell use
 * these helpers so they see the same number the cell shows (bug sweep S5).
 */
import type { Column, GridRow, ParsedAlertRule } from '../../shared/types'
import { takesDeadlineRule } from '../../shared/types'
import { computeDaysUntil, evaluateRuleForRow, formatCalculatedDays } from './deadlineCalc'
import { ageInYears } from '../../shared/dates'

type Rules = Map<number, ParsedAlertRule> | readonly ParsedAlertRule[] | undefined

export function isComputedColumnType(columnType: string | undefined): boolean {
  return columnType === 'age_from_dob' || columnType === 'calculated_days'
}

function configOf(col: Column | undefined): Record<string, unknown> {
  try { return JSON.parse(col?.config || '{}') as Record<string, unknown> } catch { return {} }
}

export { ageInYears } from '../../shared/dates'

function ruleFor(source: Column | undefined, rules: Rules): ParsedAlertRule | undefined {
  if (!source || !rules || !takesDeadlineRule(source.column_type)) return undefined
  const id = configOf(source).alert_rule_id
  if (typeof id !== 'number') return undefined
  return rules instanceof Map ? rules.get(id) : rules.find(r => r.id === id)
}

/**
 * The number an Age (years) or Days-until (days) cell shows for this row;
 * null when it shows a dash. Days-until counts to when the source is due when
 * the source date has a deadline rule, like the cell does (R4).
 */
export function computedColumnNumber(col: Column, row: GridRow, columns: readonly Column[], rules: Rules): number | null {
  const srcId = configOf(col).source_column_id
  if (typeof srcId !== 'number') return null
  const value = (row[`col_${srcId}` as keyof GridRow] as string | null | undefined) || null
  if (col.column_type === 'age_from_dob') return value ? ageInYears(value) : null
  if (col.column_type !== 'calculated_days') return null
  const rule = ruleFor(columns.find(c => c.id === srcId), rules)
  if (rule) {
    const res = evaluateRuleForRow(rule, value, row, srcId)
    return res.state === 'done' || res.state === 'paused' ? null : res.daysUntil
  }
  return value ? computeDaysUntil(value) : null
}

/** What an Age or Days-until cell says, as plain text ("34 yrs", "12 days", "Due today"); '' for a dash */
export function computedColumnText(col: Column, row: GridRow, columns: readonly Column[], rules: Rules): string {
  const n = computedColumnNumber(col, row, columns, rules)
  if (n === null) return ''
  return col.column_type === 'age_from_dob' ? `${n} yrs` : formatCalculatedDays(n).text
}

/**
 * The row with each Age and Days-until column's number filled in, for
 * highlight rules that compare it ("Age greater than 65"). The same row when
 * there are none, so memos downstream don't change.
 */
export function withComputedValues(row: GridRow, columns: readonly Column[], rules: Rules): GridRow {
  let out: GridRow | null = null
  for (const col of columns) {
    if (!isComputedColumnType(col.column_type)) continue
    const n = computedColumnNumber(col, row, columns, rules)
    out ??= { ...row }
    out[`col_${col.id}` as const] = n === null ? null : String(n)
  }
  return out ?? row
}
