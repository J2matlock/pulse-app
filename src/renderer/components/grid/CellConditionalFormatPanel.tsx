/**
 * CellConditionalFormatPanel — Per-cell and per-column conditional formatting editor.
 * Cell rules stored in cell_formats keyed by (row_id, column_id).
 * Column rules stored in columns.conditional_format JSON.
 * Priority: Alert rules > Cell formats > Column formats > Row highlights
 */
import React, { useRef, useState } from 'react'
import { X, Plus, Trash2, Pipette, ChevronUp, ChevronDown } from 'lucide-react'
import toast from 'react-hot-toast'
import { useShallow } from 'zustand/react/shallow'
import { useGridStore } from '../../stores/gridStore'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import type { CellFormatRule, CellFormatSourceType, CellFormatOperator, GridRow } from '../../../shared/types'
import { useVocab } from '../../hooks/useVocab'

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

function operatorsForType(colType: string): OpDef[] {
  if (colType === 'number' || colType === 'age_from_dob' || colType === 'calculated_days') return NUMBER_OPS
  if (colType === 'date') return DATE_OPS
  if (colType === 'checkbox') return CHECKBOX_OPS
  if (colType === 'dropdown') return DROPDOWN_OPS
  return TEXT_OPS
}

function defaultOpForType(colType: string): CellFormatOperator {
  if (colType === 'number' || colType === 'age_from_dob' || colType === 'calculated_days') return 'greater_than'
  if (colType === 'date') return 'after'
  if (colType === 'checkbox') return 'is_checked'
  return 'equals'
}

const NO_VALUE_OPS: CellFormatOperator[] = ['is_empty', 'is_not_empty', 'is_checked', 'is_unchecked']

// ── Color palette ─────────────────────────────────────────────────────────────

const COLOR_ROWS = [
  { label: 'Subtle', colors: [
    { hex: '#bbf7d0', name: 'Mint' }, { hex: '#fef08a', name: 'Lemon' },
    { hex: '#fed7aa', name: 'Peach' }, { hex: '#fecaca', name: 'Blush' },
    { hex: '#e9d5ff', name: 'Lavender' }, { hex: '#bfdbfe', name: 'Sky' },
  ]},
  { label: 'Medium', colors: [
    { hex: '#4ade80', name: 'Green' }, { hex: '#facc15', name: 'Amber' },
    { hex: '#fb923c', name: 'Orange' }, { hex: '#f87171', name: 'Coral' },
    { hex: '#c084fc', name: 'Purple' }, { hex: '#60a5fa', name: 'Blue' },
  ]},
  { label: 'Vivid', colors: [
    { hex: '#16a34a', name: 'Forest' }, { hex: '#d97706', name: 'Amber dark' },
    { hex: '#ea580c', name: 'Deep orange' }, { hex: '#dc2626', name: 'Crimson' },
    { hex: '#9333ea', name: 'Violet' }, { hex: '#2563eb', name: 'Royal blue' },
  ]},
]

export const BORDER_COLORS = [
  { hex: '#22c55e', name: 'Green' }, { hex: '#eab308', name: 'Yellow' },
  { hex: '#f97316', name: 'Orange' }, { hex: '#ef4444', name: 'Red' },
  { hex: '#a855f7', name: 'Purple' }, { hex: '#3b82f6', name: 'Blue' },
  { hex: '#ec4899', name: 'Pink' },   { hex: '#14b8a6', name: 'Teal' },
]

export function CellSwatchPicker({ value, onChange, allowNone }: {
  value: string | undefined
  onChange: (v: string | undefined) => void
  allowNone?: boolean
}): React.ReactElement {
  const allHexes = COLOR_ROWS.flatMap(r => r.colors.map(c => c.hex))
  const isCustom = !!value && !allHexes.includes(value)
  return (
    <div className="space-y-1.5">
      {COLOR_ROWS.map(row => (
        <div key={row.label} className="flex items-center gap-1.5">
          <span className="text-sm text-slate-500 dark:text-slate-400 w-12 flex-shrink-0">{row.label}</span>
          <div className="flex gap-1.5">
            {row.colors.map(c => (
              <button key={c.hex} type="button" title={c.name}
                onClick={() => onChange(c.hex)}
                className={`hit-44 w-7 h-7 rounded-lg border-2 transition-all focus-visible:ring-3 focus-visible:ring-blue-500 ${
                  value === c.hex
                    ? 'border-slate-800 dark:border-white scale-110 shadow-md'
                    : 'border-transparent hover:scale-110 hover:border-slate-400'
                }`}
                style={{ backgroundColor: c.hex }}
              />
            ))}
          </div>
        </div>
      ))}
      <div className="flex items-center gap-2 pt-1 border-t border-slate-200 dark:border-slate-600">
        {allowNone && (
          <button type="button" onClick={() => onChange(undefined)}
            className={`hit-44 w-7 h-7 rounded-lg border-2 flex items-center justify-center text-slate-500 text-base ${
              !value ? 'border-slate-700 dark:border-white scale-110' : 'border-slate-300 dark:border-slate-600'
            }`} title="No color">∅</button>
        )}
        <Pipette className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
        <input type="color" value={value ?? '#ffffff'} onChange={e => onChange(e.target.value)}
          className="w-7 h-7 rounded-lg cursor-pointer border-2 p-0"
          style={{ borderColor: isCustom ? '#1e293b' : '#e2e8f0' }}
          title="Custom color" />
        {isCustom && <span className="text-sm font-mono text-slate-500">{value}</span>}
      </div>
    </div>
  )
}

// ── Record label helper ──────────────────────────────────────────────────────────

function rowLabel(row: GridRow, nameColId: number | null, position: number, recordWord: string): string {
  if (nameColId != null) {
    const val = row[`col_${nameColId}` as keyof GridRow] as string | null
    if (val) return val
  }
  return `${recordWord} ${position + 1}`
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  rowId?: number
  columnId: number
  onClose: () => void
  mode?: 'cell' | 'column'
  selectedRowIds?: Set<number>
}

type ApplyScope = 'cell' | 'all_rows' | 'selected'

export function CellConditionalFormatPanel({ rowId, columnId, onClose, mode = 'cell', selectedRowIds }: Props): React.ReactElement {
  const { t } = useVocab()
  const { columns, rows, cellFormats } = useGridStore(useShallow(s => ({
    columns: s.columns,
    rows: s.rows,
    cellFormats: s.cellFormats,
  })))
  const { setCellFormat, batchSetCellFormat, updateColumn } = useGridStore(useShallow(s => ({
    setCellFormat: s.setCellFormat,
    batchSetCellFormat: s.batchSetCellFormat,
    updateColumn: s.updateColumn,
  })))

  const trapRef = useRef<HTMLDivElement>(null)
  useFocusTrap(trapRef, true)

  const isColumnMode = mode === 'column'
  const thisColumn  = columns.find(c => c.id === columnId)
  const nameCol     = columns.find(c => c.is_name_column === 1) ?? columns.find(c => c.column_type === 'text')
  const nameColId   = nameCol?.id ?? null
  const otherColumns = columns.filter(c => c.id !== columnId)

  const [rules, setRules] = useState<CellFormatRule[]>(() => {
    if (isColumnMode) {
      try { return JSON.parse(thisColumn?.conditional_format || '[]') } catch { return [] }
    }
    return cellFormats.get(`${rowId}_${columnId}`) ?? []
  })
  const [isSaving, setIsSaving] = useState(false)
  const [applyScope, setApplyScope] = useState<ApplyScope>(() => {
    if (isColumnMode) return 'cell'
    // If existing rules have originRowId matching this row, it was saved as "all rows"
    const existing = cellFormats.get(`${rowId}_${columnId}`) ?? []
    if (existing.length > 0 && rowId != null && existing.some((r: CellFormatRule) => r.originRowId === rowId)) {
      return 'all_rows'
    }
    return 'cell'
  })

  function addRule() {
    const colType = thisColumn?.column_type ?? 'text'
    setRules(prev => [...prev, {
      sourceType: 'self',
      operator: defaultOpForType(colType),
      value: '',
      bgColor: '#fef08a',
    }])
  }

  function removeRule(i: number) {
    setRules(prev => prev.filter((_, idx) => idx !== i))
  }

  function moveRule(from: number, to: number) {
    setRules(prev => {
      const next = [...prev]
      const [item] = next.splice(from, 1)
      if (item) next.splice(to, 0, item)
      return next
    })
  }

  function updateRule(i: number, patch: Partial<CellFormatRule>) {
    setRules(prev => prev.map((r, idx) => {
      if (idx !== i) return r
      const updated = { ...r, ...patch }
      if ('sourceType' in patch || 'sourceColumnId' in patch) {
        const srcColId = 'sourceColumnId' in patch ? patch.sourceColumnId : r.sourceColumnId
        const srcType  = srcColId != null
          ? (columns.find(c => c.id === srcColId)?.column_type ?? 'text')
          : (thisColumn?.column_type ?? 'text')
        updated.operator = defaultOpForType(srcType)
        updated.value    = ''
        updated.value2   = undefined
      }
      return updated
    }))
  }

  async function handleSave() {
    setIsSaving(true)
    try {
      if (isColumnMode) {
        await updateColumn(columnId, { conditional_format: JSON.stringify(rules) })
        toast.success('Column highlight rules saved')
      } else if (applyScope === 'all_rows') {
        // A column rule, so records added later are highlighted too (L-19)
        let current: CellFormatRule[] = []
        try { current = JSON.parse(thisColumn?.conditional_format || '[]') as CellFormatRule[] } catch { current = [] }
        const clean = rules.map(({ originRowId: _o, ...r }) => r)
        const seen = new Set(current.map(r => JSON.stringify(r)))
        const merged = [...current, ...clean.filter(r => !seen.has(JSON.stringify(r)))]
        await updateColumn(columnId, { conditional_format: JSON.stringify(merged) })
        // This cell's own copy would show twice
        if (rowId != null && (cellFormats.get(`${rowId}_${columnId}`) ?? []).length > 0) await setCellFormat(rowId, columnId, [])
        toast.success(`Highlight saved for every ${t('record')} in "${thisColumn?.name ?? 'this column'}"`)
      } else if (applyScope === 'selected' && selectedRowIds && selectedRowIds.size > 0) {
        const stamped = rules.map(r => ({ ...r, originRowId: r.originRowId ?? rowId ?? undefined }))
        const entries = Array.from(selectedRowIds).map(rid => ({ rowId: rid, columnId, rules: stamped }))
        await batchSetCellFormat(entries)
        toast.success(`Formatting applied to ${selectedRowIds.size} ${t('record', { count: selectedRowIds.size })}`)
      } else {
        if (rowId != null) await setCellFormat(rowId, columnId, rules)
      }
      onClose()
    } finally {
      setIsSaving(false)
    }
  }

  const thisRowLabel = !isColumnMode && rowId != null ? rowLabel(
    rows.find(r => r.row_id === rowId) ?? { row_id: rowId, position: 0 } as GridRow,
    nameColId,
    rows.findIndex(r => r.row_id === rowId),
    t('record', { cap: true })
  ) : ''

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div ref={trapRef} className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col">

        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <div>
            <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
              {isColumnMode ? 'Auto-Highlight Column' : 'Auto-Highlight Cell'}
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              {isColumnMode
                ? thisColumn?.name ?? 'column'
                : `${thisRowLabel} — ${thisColumn?.name ?? 'column'}`}
            </p>
          </div>
          <button onClick={onClose} title="Close" aria-label="Close" className="hit-44 p-1.5 rounded-sm hover:bg-slate-100 dark:hover:bg-slate-700 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
            Automatically color cells based on their value (e.g., highlight overdue dates in red).
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {isColumnMode
              ? `Rules apply to every ${t('record')} in this column. The first one that matches is used.`
              : `Rules stay with this ${t('record')}'s cell, even when the ${t('list')} is sorted. The first one that matches is used.`}
          </p>

          {rules.length === 0 && (
            <div className="py-6 text-center text-slate-500 dark:text-slate-400 text-sm">No highlight rules yet. Click "Add rule" below to get started.</div>
          )}

          {rules.map((rule, i) => {
            const srcColId = rule.sourceColumnId
            const srcCol   = srcColId != null ? columns.find(c => c.id === srcColId) : thisColumn
            const effectiveType = srcCol?.column_type ?? thisColumn?.column_type ?? 'text'
            const operators  = operatorsForType(effectiveType)
            const needsValue = !NO_VALUE_OPS.includes(rule.operator)
            const isDropdown = effectiveType === 'dropdown'
            const isDate     = effectiveType === 'date'
            const isNumber   = effectiveType === 'number' || effectiveType === 'age_from_dob' || effectiveType === 'calculated_days'
            const dropdownOptions: string[] = (() => {
              try { return JSON.parse(srcCol?.config ?? thisColumn?.config ?? '{}').options ?? [] } catch { return [] }
            })()

            return (
              <div key={i} className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
                {/* Rule header */}
                <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 dark:bg-slate-700/50 border-b border-slate-200 dark:border-slate-700">
                  <span className="text-sm font-semibold text-slate-500 uppercase tracking-wide flex-shrink-0">Highlight rule {i + 1}</span>
                  <input
                    type="text"
                    className="flex-1 bg-transparent border-0 border-b border-transparent focus:border-blue-500 text-base text-slate-700 dark:text-slate-200 placeholder:text-slate-500 py-0"
                    placeholder="Name this rule (optional)"
                    value={rule.name ?? ''}
                    onChange={e => updateRule(i, { name: e.target.value || undefined })}
                  />
                  {rules.length > 1 && (
                    <div className="flex flex-col flex-shrink-0">
                      <button onClick={() => moveRule(i, i - 1)} disabled={i === 0}
                        className="hit-44 text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 disabled:opacity-30 disabled:cursor-default"
                        title="Move up (higher priority)">
                        <ChevronUp className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => moveRule(i, i + 1)} disabled={i >= rules.length - 1}
                        className="hit-44 text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 disabled:opacity-30 disabled:cursor-default"
                        title="Move down (lower priority)">
                        <ChevronDown className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                  <button onClick={() => removeRule(i)} title="Delete this rule" aria-label="Delete this rule" className="hit-44 p-1 text-slate-500 dark:text-slate-400 hover:text-red-500 rounded-sm focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 flex-shrink-0">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="p-3 space-y-3">
                  {/* Source */}
                  <div className="space-y-1.5">
                    <label className="text-base font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                      What triggers this format?
                    </label>
                    <select className="input w-full py-1 text-base" style={{ minHeight: 36 }}
                      value={rule.sourceType}
                      onChange={e => updateRule(i, {
                        sourceType: e.target.value as CellFormatSourceType,
                        sourceColumnId: undefined,
                        sourceRowId: undefined,
                      })}>
                      <option value="self">This cell's own value</option>
                      <option value="same_row_column">Another column of the same {t('record')} (e.g. a checkbox)</option>
                      {!isColumnMode && (
                        <option value="specific_cell">A cell of another {t('record')}</option>
                      )}
                    </select>

                    {(rule.sourceType === 'same_row_column' || rule.sourceType === 'specific_cell') && (
                      <select className="input w-full py-1 text-base" style={{ minHeight: 36 }}
                        value={rule.sourceColumnId ?? ''}
                        onChange={e => updateRule(i, { sourceColumnId: e.target.value ? parseInt(e.target.value, 10) : undefined })}>
                        <option value="">— pick a column —</option>
                        {otherColumns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    )}
                    {rule.sourceType === 'same_row_column' && !rule.sourceColumnId && (
                      <p className="text-sm text-amber-700 dark:text-amber-400">Pick a column above to trigger from.</p>
                    )}

                    {!isColumnMode && rule.sourceType === 'specific_cell' && (
                      <select className="input w-full py-1 text-base" style={{ minHeight: 36 }}
                        value={rule.sourceRowId ?? ''}
                        onChange={e => updateRule(i, { sourceRowId: e.target.value ? parseInt(e.target.value, 10) : undefined })}>
                        <option value="">— pick {t('record', { article: true })} —</option>
                        {rows.filter(r => rowId != null && r.row_id !== rowId).map((r, idx) => (
                          <option key={r.row_id} value={r.row_id}>{rowLabel(r, nameColId, idx, t('record', { cap: true }))}</option>
                        ))}
                      </select>
                    )}
                  </div>

                  {/* Condition */}
                  <div className="space-y-1.5">
                    <label htmlFor={`cond-format-operator-${i}`} className="text-base font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Condition</label>
                    <div className="flex flex-wrap gap-2">
                      <select id={`cond-format-operator-${i}`} className="input py-1 text-base" style={{ minHeight: 36, minWidth: 160 }}
                        value={rule.operator}
                        onChange={e => updateRule(i, { operator: e.target.value as CellFormatOperator, value: '', value2: undefined })}>
                        {operators.map(op => <option key={op.value} value={op.value}>{op.label}</option>)}
                      </select>

                      {needsValue && !isDropdown && (
                        isDate ? (
                          <input type="date" className="input flex-1 py-1 text-base" style={{ minHeight: 36, minWidth: 140 }}
                            value={rule.value} onChange={e => updateRule(i, { value: e.target.value })} />
                        ) : (
                          <input className="input w-full py-1 text-base" style={{ minHeight: 36 }}
                            type={isNumber ? 'number' : 'text'}
                            value={rule.value} onChange={e => updateRule(i, { value: e.target.value })}
                            placeholder={rule.operator === 'between' || rule.operator === 'date_between' ? 'From' : 'Value'} />
                        )
                      )}

                      {needsValue && isDropdown && (
                        <select className="input flex-1 py-1 text-base" style={{ minHeight: 36, minWidth: 140 }}
                          value={rule.value} onChange={e => updateRule(i, { value: e.target.value })}>
                          <option value="">— pick option —</option>
                          {dropdownOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                      )}

                      {(rule.operator === 'between' || rule.operator === 'date_between') && (
                        isDate ? (
                          <input type="date" className="input flex-1 py-1 text-base" style={{ minHeight: 36, minWidth: 140 }}
                            value={rule.value2 ?? ''} onChange={e => updateRule(i, { value2: e.target.value })} />
                        ) : (
                          <input type="number" className="input w-full py-1 text-base" style={{ minHeight: 36 }}
                            value={rule.value2 ?? ''} onChange={e => updateRule(i, { value2: e.target.value })}
                            placeholder="To" />
                        )
                      )}
                    </div>
                    {/* Warn if value is empty for operators that require a value */}
                    {needsValue && !rule.value && !['not_equals', 'not_contains'].includes(rule.operator) && (
                      <p className="text-sm text-amber-700 dark:text-amber-400">
                        Enter a value above — without one this rule will never match.
                      </p>
                    )}
                  </div>

                  {/* Styling */}
                  <div className="space-y-3">
                    <label className="text-base font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Style when triggered</label>

                    {/* Background */}
                    <div>
                      <p className="text-sm text-slate-500 mb-1.5">Background color</p>
                      <CellSwatchPicker value={rule.bgColor} onChange={v => updateRule(i, { bgColor: v, pulse: false })} allowNone />
                    </div>

                    {/* Border glow */}
                    <div>
                      <p className="text-sm text-slate-500 mb-1.5">Border glow</p>
                      <div className="flex gap-1.5 flex-wrap">
                        <button type="button" onClick={() => updateRule(i, { borderColor: undefined })}
                          className={`hit-44 w-7 h-7 rounded-lg border-2 flex items-center justify-center text-slate-500 text-base ${
                            !rule.borderColor ? 'border-slate-700 dark:border-white scale-110' : 'border-slate-300 dark:border-slate-600'
                          }`} title="No border">∅</button>
                        {BORDER_COLORS.map(c => (
                          <button key={c.hex} type="button" title={c.name}
                            onClick={() => updateRule(i, { borderColor: c.hex })}
                            className={`hit-44 w-7 h-7 rounded-lg border-2 transition-all ${
                              rule.borderColor === c.hex
                                ? 'border-slate-800 dark:border-white scale-110 shadow-md'
                                : 'border-transparent hover:scale-110 hover:border-slate-400'
                            }`}
                            style={{ backgroundColor: c.hex }} />
                        ))}
                        <input type="color" value={rule.borderColor ?? '#3b82f6'}
                          onChange={e => updateRule(i, { borderColor: e.target.value })}
                          className="w-7 h-7 rounded-lg cursor-pointer border-2 border-slate-200 p-0"
                          title="Custom border color" />
                      </div>
                    </div>

                    {/* Text + toggles */}
                    <div className="flex items-center gap-4 flex-wrap">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm text-slate-500">Text:</span>
                        <input type="color" value={rule.textColor ?? '#1e293b'}
                          onChange={e => updateRule(i, { textColor: e.target.value })}
                          className="w-7 h-7 rounded-sm cursor-pointer border border-slate-200 p-0" />
                        {rule.textColor && (
                          <button onClick={() => updateRule(i, { textColor: undefined })}
                            className="hit-44 text-base text-slate-500 dark:text-slate-400 hover:text-slate-600 underline">reset</button>
                        )}
                      </div>
                      <label className="flex items-center gap-1.5 cursor-pointer text-base text-slate-600 dark:text-slate-300">
                        <input type="checkbox" checked={!!rule.bold}
                          onChange={e => updateRule(i, { bold: e.target.checked })}
                          className="w-4 h-4 rounded-sm border-slate-300 text-blue-600" />
                        <span className="font-bold">Bold</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer text-base text-slate-600 dark:text-slate-300">
                        <input type="checkbox" checked={!!rule.italic}
                          onChange={e => updateRule(i, { italic: e.target.checked })}
                          className="w-4 h-4 rounded-sm border-slate-300 text-blue-600" />
                        <span className="italic">Italic</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer text-base text-slate-600 dark:text-slate-300">
                        <input type="checkbox" checked={!!rule.pulse}
                          onChange={e => updateRule(i, { pulse: e.target.checked, bgColor: e.target.checked ? undefined : rule.bgColor })}
                          className="w-4 h-4 rounded-sm border-slate-300 text-blue-600" />
                        Pulse
                      </label>
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer select-none text-base text-slate-600 dark:text-slate-300">
                      <input type="checkbox" checked={!!rule.highlightRow}
                        onChange={e => updateRule(i, { highlightRow: e.target.checked })}
                        className="w-4 h-4 rounded-sm border-slate-300 text-blue-600 focus:ring-blue-500" />
                      Highlight the whole {t('record')} when matched
                    </label>

                    {/* Preview */}
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-slate-500">Preview:</span>
                      <div
                        className={`px-3 py-1.5 rounded-sm text-sm ${rule.pulse ? 'alert-pulse' : ''}`}
                        style={{
                          backgroundColor: rule.pulse ? undefined : (rule.bgColor ?? 'transparent'),
                          color: rule.textColor,
                          fontWeight: rule.bold ? 'bold' : undefined,
                          fontStyle: rule.italic ? 'italic' : undefined,
                          boxShadow: rule.borderColor ? `inset 0 0 0 2px ${rule.borderColor}` : undefined,
                        }}
                      >
                        {thisColumn?.name ?? 'Value'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}

          <button onClick={addRule} title="Add a new highlight rule" aria-label="Add a new highlight rule"
            className="hit-44 flex items-center gap-2 text-base text-blue-600 dark:text-blue-400 hover:underline focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 rounded-sm">
            <Plus className="w-4 h-4" />Add highlight rule
          </button>
        </div>

        <div className="flex-shrink-0 flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-700">
          {/* Scope selector — cell mode only */}
          {!isColumnMode && (
            <select
              className="input py-1 text-base mr-auto"
              style={{ minHeight: 36, maxWidth: 220 }}
              value={applyScope}
              onChange={e => setApplyScope(e.target.value as ApplyScope)}
            >
              <option value="cell">This cell only</option>
              <option value="all_rows">{`Every ${t('record')} in this column`}</option>
              {selectedRowIds && selectedRowIds.size > 0 && (
                <option value="selected">{`Selected ${t('record', { many: true })} (${selectedRowIds.size})`}</option>
              )}
            </select>
          )}
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={handleSave} disabled={isSaving} className="btn-primary">
            {isSaving ? 'Saving…' : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  )
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
    }
    if (match) return rule
  }
  return null
}
