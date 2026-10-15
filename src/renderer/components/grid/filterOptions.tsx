import React from 'react'
import { clampLeft } from '../../utils/domHelpers'
import type { FilterOperator } from '../../stores/gridStore'
import { takesDeadlineRule, type Column, type ColumnFilter, type ColumnType, type GridRow } from '../../../shared/types'
import { parseLinkValue, type LinkChip } from '../../../shared/links'
import { TODAY_TOKEN, DUE_STATUSES } from '../../utils/filterMatch'
import { formatDate as formatCellDate } from './CellDisplay'

// What each column type can be filtered by, quick presets, and the small value
// pickers the filter bar and the toolbar's filter panel share

/**
 * A pop-up panel just below its button, kept inside the window: it moves left at
 * the right edge and scrolls instead of running off the bottom (AUDIT-055: at 200%
 * zoom the window is only ~380px tall).
 */
export function panelBelow(anchor: HTMLElement | null, width: number): React.CSSProperties {
  const r = anchor?.getBoundingClientRect()
  const top = (r?.bottom ?? 100) + 4
  return { top, left: clampLeft(r?.left ?? 0, width), maxHeight: `calc(100vh - ${top + 8}px)`, overflowY: 'auto' }
}

export const ROW_TAG_OPS: FilterOperator[] = ['contains', 'not_contains', 'is_empty', 'is_not_empty']

// Checkbox filters default to 'true' so the Add button isn't immediately disabled
function defaultValueForType(colType: string | undefined): string {
  return colType === 'checkbox' ? 'true' : ''
}

// Human-readable operator labels
export const OPERATOR_LABELS: Record<FilterOperator, string> = {
  contains:      'contains',
  not_contains:  'does not contain',
  equals:        'equals',
  not_equals:    'not equal to',
  starts_with:   'starts with',
  ends_with:     'ends with',
  is_empty:      'is empty',
  is_not_empty:  'is not empty',
  gt:            'greater than',
  lt:            'less than',
  before:        'before',
  after:         'after',
  links_to:      'links to',
  due_status:    'deadline is',
}

// Operators available per column type; every type has its own entry (a missing one fell back to text, Q-049)
const OPS_FOR_TYPE: Record<Exclude<ColumnType, 'deadline'>, FilterOperator[]> = {
  text:     ['contains', 'not_contains', 'equals', 'not_equals', 'starts_with', 'ends_with', 'is_empty', 'is_not_empty'],
  notes:    ['contains', 'not_contains', 'is_empty', 'is_not_empty'],
  address:  ['contains', 'not_contains', 'is_empty', 'is_not_empty'],
  phone:    ['contains', 'not_contains', 'equals', 'not_equals', 'is_empty', 'is_not_empty'],
  email:    ['contains', 'not_contains', 'equals', 'not_equals', 'is_empty', 'is_not_empty'],
  url:      ['contains', 'not_contains', 'is_empty', 'is_not_empty'],
  number:   ['equals', 'not_equals', 'gt', 'lt', 'is_empty', 'is_not_empty'],
  currency: ['equals', 'not_equals', 'gt', 'lt', 'is_empty', 'is_not_empty'],
  // Worked out from a date: compared as the number the cell shows
  age_from_dob:    ['gt', 'lt', 'equals', 'not_equals', 'is_empty', 'is_not_empty'],
  calculated_days: ['lt', 'gt', 'equals', 'not_equals', 'is_empty', 'is_not_empty'],
  date:     ['equals', 'before', 'after', 'is_empty', 'is_not_empty'],
  checkbox: ['equals', 'not_equals'],
  dropdown: ['equals', 'not_equals', 'is_empty', 'is_not_empty'],
  status:   ['equals', 'not_equals', 'is_empty', 'is_not_empty'],
  tag:      ['contains', 'not_contains', 'is_empty', 'is_not_empty'],
  link:     ['links_to', 'contains', 'not_contains', 'is_empty', 'is_not_empty'],
  // "J-0042": matched as text, or by its number for greater/less than
  auto_number: ['equals', 'not_equals', 'contains', 'gt', 'lt', 'is_empty', 'is_not_empty'],
  // How many files: always a number, 0 when there are none
  file_count:  ['gt', 'lt', 'equals', 'not_equals'],
}

export const NO_VALUE_OPS: FilterOperator[] = ['is_empty', 'is_not_empty']

/**
 * The operators for a column. A column with a deadline rule offers "due
 * status" first (G-12); a Deadline column's stored date means nothing to
 * people, so it offers only that.
 */
export function opsForColumn(col: Column | undefined): FilterOperator[] {
  if (!col) return OPS_FOR_TYPE.text
  const hasRule = takesDeadlineRule(col.column_type) && (() => { try { return !!(JSON.parse(col.config || '{}') as { alert_rule_id?: number }).alert_rule_id } catch { return false } })()
  if (col.column_type === 'deadline') return ['due_status']
  const base = OPS_FOR_TYPE[col.column_type] ?? OPS_FOR_TYPE.text
  return hasRule ? ['due_status', ...base] : base
}

/** The value a new filter starts with */
export function startValue(op: FilterOperator, colType: string | undefined): string {
  return op === 'due_status' ? 'overdue' : defaultValueForType(colType)
}

export function DueStatusValue({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }): React.ReactElement {
  return (
    <div>
      <label htmlFor={id} className="block text-base text-slate-500 dark:text-slate-400 mb-1">Value</label>
      <select id={id} className="input w-full text-base" style={{ minHeight: 36 }} value={value || 'overdue'} onChange={e => onChange(e.target.value)}>
        {DUE_STATUSES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
      </select>
    </div>
  )
}

// Quick preset buttons shown after column selection to reduce clicks
export type FilterPreset = { label: string; op: FilterOperator; value?: string }
export const PRESETS_BY_TYPE: Record<string, FilterPreset[]> = {
  text: [
    { label: 'Contains\u2026', op: 'contains' },
    { label: 'Is empty', op: 'is_empty' },
  ],
  notes: [
    { label: 'Contains\u2026', op: 'contains' },
    { label: 'Is empty', op: 'is_empty' },
  ],
  address: [
    { label: 'Contains\u2026', op: 'contains' },
    { label: 'Is empty', op: 'is_empty' },
  ],
  phone: [
    { label: 'Contains\u2026', op: 'contains' },
    { label: 'Is empty', op: 'is_empty' },
  ],
  email: [
    { label: 'Contains\u2026', op: 'contains' },
    { label: 'Is empty', op: 'is_empty' },
  ],
  url: [
    { label: 'Contains\u2026', op: 'contains' },
    { label: 'Is empty', op: 'is_empty' },
  ],
  date: [
    { label: 'In the past', op: 'before', value: TODAY_TOKEN },
    { label: 'Is empty', op: 'is_empty' },
  ],
  checkbox: [
    { label: 'Is checked', op: 'equals', value: 'true' },
    { label: 'Is unchecked', op: 'equals', value: 'false' },
  ],
  number: [
    { label: 'Greater than\u2026', op: 'gt' },
    { label: 'Is empty', op: 'is_empty' },
  ],
  currency: [
    { label: 'Greater than\u2026', op: 'gt' },
    { label: 'Is empty', op: 'is_empty' },
  ],
  age_from_dob: [
    { label: 'Greater than\u2026', op: 'gt' },
    { label: 'Less than\u2026', op: 'lt' },
  ],
  calculated_days: [
    { label: 'Less than\u2026', op: 'lt' },
    { label: 'Is empty', op: 'is_empty' },
  ],
  dropdown: [
    { label: 'Is empty', op: 'is_empty' },
  ],
  status: [
    { label: 'Is empty', op: 'is_empty' },
  ],
  tag: [
    { label: 'Contains\u2026', op: 'contains' },
    { label: 'Is empty', op: 'is_empty' },
  ],
  link: [
    { label: 'Links to\u2026', op: 'links_to' },
    { label: 'Is empty', op: 'is_empty' },
  ],
  auto_number: [
    { label: 'Contains\u2026', op: 'contains' },
    { label: 'Greater than\u2026', op: 'gt' },
  ],
  file_count: [
    { label: 'Greater than\u2026', op: 'gt' },
    { label: 'Less than\u2026', op: 'lt' },
  ],
}

/** Records a link column links to, across the loaded rows, for "links to" (W04) */
function linkTargets(rows: GridRow[], columnId: number): LinkChip[] {
  const seen = new Map<number, LinkChip>()
  for (const r of rows) for (const c of parseLinkValue(r[`col_${columnId}`])) if (!seen.has(c.rowId)) seen.set(c.rowId, c)
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function filterValueLabel(f: ColumnFilter, rows: GridRow[]): string {
  if (f.value === TODAY_TOKEN) return 'today'
  if (f.operator === 'due_status') return DUE_STATUSES.find(d => d.value === f.value)?.label ?? f.value
  if (f.operator !== 'links_to') return /^\d{4}-\d{2}-\d{2}$/.test(f.value) ? formatCellDate(f.value) : f.value
  return linkTargets(rows, f.columnId).find(c => String(c.rowId) === f.value)?.name ?? f.value
}

export function LinkFilterValue({ id, columnId, rows, value, onChange }: { id: string; columnId: number; rows: GridRow[]; value: string; onChange: (v: string) => void }): React.ReactElement {
  const targets = linkTargets(rows, columnId)
  return (
    <div>
      <label htmlFor={id} className="block text-base text-slate-500 dark:text-slate-400 mb-1">Linked to</label>
      <select id={id} autoFocus className="input w-full text-base" style={{ minHeight: 36 }} value={value} onChange={e => onChange(e.target.value)}>
        <option value="">Choose…</option>
        {targets.map(c => <option key={c.rowId} value={String(c.rowId)}>{c.name || '(unnamed)'}</option>)}
      </select>
    </div>
  )
}
