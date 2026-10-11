/**
 * How the table sorts a column (audit G-11, G-43): deadlines by when
 * they're due (overdue first, then later, then nothing due, then done or
 * paused), numbers and money as numbers, dates by their ISO value.
 */
import type { Column, GridRow, ParsedAlertRule } from '../../../shared/types'
import { computeDaysUntil, evaluateRuleForRow } from '../../utils/deadlineCalc'
import { useGridStore } from '../../stores/gridStore'

type Cmp = (a: GridRow, b: GridRow) => number

const nullsLast = (a: unknown, b: unknown): number | null => {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  return null
}

export function numberCompare(columnId: number): Cmp {
  return (ra, rb) => {
    const parse = (v: unknown) => { const n = typeof v === 'string' && v.trim() !== '' ? Number(v.replace(/[$,]/g, '')) : NaN; return isNaN(n) ? null : n }
    const a = parse(ra[`col_${columnId}`]), b = parse(rb[`col_${columnId}`])
    return nullsLast(a, b) ?? (a! - b!)
  }
}

export function dateCompare(columnId: number): Cmp {
  return (ra, rb) => {
    const a = (ra[`col_${columnId}`] as string | null) || null, b = (rb[`col_${columnId}`] as string | null) || null
    return nullsLast(a, b) ?? (a! < b! ? -1 : a! > b! ? 1 : 0)
  }
}

export function deadlineCompare(columnId: number, rule: ParsedAlertRule): Cmp {
  const key = (r: GridRow): [number, number] => {
    const res = evaluateRuleForRow(rule, (r[`col_${columnId}`] as string | null) ?? null, r as unknown as Record<string, unknown>, columnId)
    if (res.state === 'done' || res.state === 'paused') return [2, 0]
    if (res.daysUntil === null) return [1, 0]
    return [0, res.daysUntil]
  }
  return (ra, rb) => {
    const [ba, da] = key(ra), [bb, db] = key(rb)
    return ba !== bb ? ba - bb : da - db
  }
}

function ruleIdOf(col: Column | undefined): number | undefined {
  if (!col?.config) return undefined
  try { return (JSON.parse(col.config) as { alert_rule_id?: number }).alert_rule_id } catch { return undefined }
}

/**
 * What a "Days until" column counts to (R4). When its date has a deadline
 * rule, the stored date is when it was last done, so count to when it's due,
 * the same as the date's own chip. Done or paused: nothing to count.
 */
export function daysUntilSource(sourceId: number, row: GridRow, rules: readonly ParsedAlertRule[]): number | null {
  const { columns, hiddenColumns } = useGridStore.getState()
  const source = columns.find(c => c.id === sourceId) ?? hiddenColumns.find(c => c.id === sourceId)
  const value = (row[`col_${sourceId}`] as string | null | undefined) || null
  const ruleId = ruleIdOf(source)
  const rule = ruleId !== undefined ? rules.find(r => r.id === ruleId) : undefined
  if (rule) {
    const res = evaluateRuleForRow(rule, value, row as unknown as Record<string, unknown>, sourceId)
    return res.state === 'done' || res.state === 'paused' ? null : res.daysUntil
  }
  return value ? computeDaysUntil(value) : null
}
