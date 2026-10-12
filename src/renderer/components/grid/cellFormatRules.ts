import type { CellFormatRule, CellFormatOperator, GridRow } from '../../../shared/types'
import { unhandledCase } from '../../../shared/assertNever'

// Which conditions each column type offers, and whether a rule matches a cell

// ── Operator sets ─────────────────────────────────────────────────────────────

type OpDef = { value: CellFormatOperator; label: string }

const TEXT_OPS: OpDef[] = [
  { value: 'equals',       label: 'Equals' },
  { value: 'not_equals',   label: 'Does not equal' },
  { value: 'contains',     label: 'Contains' },
  { value: 'not_contains', label: 'Does not contain' },
  { value: 'starts_with',  label: 'Starts with' },
  { value: 'ends_with',    label: 'Ends with' },
  { value: 'is_empty',     label: 'Is empty' },
  { value: 'is_not_empty', label: 'Is not empty' },
]

const NUMBER_OPS: OpDef[] = [
  { value: 'equals',                label: 'Equals' },
  { value: 'not_equals',            label: 'Does not equal' },
  { value: 'greater_than',          label: 'Greater than' },
  { value: 'greater_than_or_equal', label: 'Greater than or equal' },
  { value: 'less_than',             label: 'Less than' },
  { value: 'less_than_or_equal',    label: 'Less than or equal' },
  { value: 'between',               label: 'Between' },
  { value: 'is_empty',              label: 'Is empty' },
  { value: 'is_not_empty',          label: 'Is not empty' },
]

const DATE_OPS: OpDef[] = [
  { value: 'before',       label: 'Before' },
  { value: 'after',        label: 'After' },
  { value: 'on_date',      label: 'On date' },
  { value: 'date_between', label: 'Between' },
  { value: 'is_empty',     label: 'Is empty' },
  { value: 'is_not_empty', label: 'Is not empty' },
]

const CHECKBOX_OPS: OpDef[] = [
  { value: 'is_checked',   label: 'Is checked' },
  { value: 'is_unchecked', label: 'Is unchecked' },
]

const DROPDOWN_OPS: OpDef[] = [
  { value: 'equals',       label: 'Is' },
  { value: 'not_equals',   label: 'Is not' },
  { value: 'is_empty',     label: 'Is empty' },
  { value: 'is_not_empty', label: 'Is not empty' },
]

export function operatorsForType(colType: string): OpDef[] {
  if (colType === 'number' || colType === 'age_from_dob' || colType === 'calculated_days') return NUMBER_OPS
  if (colType === 'date') return DATE_OPS
  if (colType === 'checkbox') return CHECKBOX_OPS
  if (colType === 'dropdown') return DROPDOWN_OPS
  return TEXT_OPS
}

export function defaultOpForType(colType: string): CellFormatOperator {
  if (colType === 'number' || colType === 'age_from_dob' || colType === 'calculated_days') return 'greater_than'
  if (colType === 'date') return 'after'
  if (colType === 'checkbox') return 'is_checked'
  return 'equals'
}

export const NO_VALUE_OPS: CellFormatOperator[] = ['is_empty', 'is_not_empty', 'is_checked', 'is_unchecked']

// ── Record label helper ──────────────────────────────────────────────────────────

export function rowLabel(row: GridRow, nameColId: number | null, position: number, recordWord: string): string {
  if (nameColId != null) {
    const val = row[`col_${nameColId}` as keyof GridRow] as string | null
    if (val) return val
  }
  return `${recordWord} ${position + 1}`
}

// ── Evaluation ────────────────────────────────────────────────────────────────

export function evalCellFormat(
  rules: CellFormatRule[],
  selfValue: string | null,
  rowOriginal: GridRow,
  rowMap: Map<number, GridRow>
): CellFormatRule | null {
  if (rules.length === 0) return null

  for (const rule of rules) {
    let value: string | null
    if (rule.sourceType === 'same_row_column' && rule.sourceColumnId != null) {
      value = rowOriginal[`col_${rule.sourceColumnId}`] ?? null
    } else if (rule.sourceType === 'specific_cell' && rule.sourceRowId != null && rule.sourceColumnId != null) {
      value = rowMap.get(rule.sourceRowId)?.[`col_${rule.sourceColumnId}`] ?? null
    } else {
      value = selfValue
    }

    // No-value operators — evaluate regardless of whether value is empty
    if (rule.operator === 'is_empty')     { if (!value || value.trim() === '') return rule; continue }
    if (rule.operator === 'is_not_empty') { if (value && value.trim() !== '')  return rule; continue }
    if (rule.operator === 'is_checked')   { if (value === 'true' || value === '1') return rule; continue }
    if (rule.operator === 'is_unchecked') { if (value !== 'true' && value !== '1') return rule; continue }

    if (!value) continue

    // Skip rules where the comparison value is blank (user left the field empty)
    if (!rule.value && !['not_equals', 'not_contains'].includes(rule.operator)) continue

    const num  = parseFloat(value)
    const rNum = parseFloat(rule.value)
    let match = false

    switch (rule.operator) {
      case 'equals':                match = value === rule.value; break
      case 'not_equals':            match = value !== rule.value; break
      case 'contains':              match = value.toLowerCase().includes(rule.value.toLowerCase()); break
      case 'not_contains':          match = !value.toLowerCase().includes(rule.value.toLowerCase()); break
      case 'starts_with':           match = value.toLowerCase().startsWith(rule.value.toLowerCase()); break
      case 'ends_with':             match = value.toLowerCase().endsWith(rule.value.toLowerCase()); break
      case 'greater_than':          match = !isNaN(num) && num > rNum; break
      case 'greater_than_or_equal': match = !isNaN(num) && num >= rNum; break
      case 'less_than':             match = !isNaN(num) && num < rNum; break
      case 'less_than_or_equal':    match = !isNaN(num) && num <= rNum; break
      case 'between':               match = !isNaN(num) && rule.value2 !== undefined && num >= rNum && num <= parseFloat(rule.value2); break
      case 'before':                match = value < rule.value; break
      case 'after':                 match = value > rule.value; break
      case 'on_date':               match = value.startsWith(rule.value); break
      case 'date_between':          match = rule.value2 !== undefined && value >= rule.value && value <= rule.value2; break
      // An operator added without a case fails typecheck; a stored one this
      // version doesn't know never matches, as before
      default:                      unhandledCase(rule.operator)
    }
    if (match) return rule
  }
  return null
}
