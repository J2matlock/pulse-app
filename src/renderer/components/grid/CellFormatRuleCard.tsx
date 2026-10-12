import React from 'react'
import { Trash2, Pipette, ChevronUp, ChevronDown } from 'lucide-react'
import type { CellFormatRule, CellFormatSourceType, CellFormatOperator, Column, GridRow } from '../../../shared/types'
import { useVocab } from '../../hooks/useVocab'
import { operatorsForType, NO_VALUE_OPS, rowLabel } from './cellFormatRules'

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

export interface CellFormatRuleCardProps {
  rule: CellFormatRule
  index: number
  ruleCount: number
  columns: Column[]
  /** The column the rules are for */
  thisColumn: Column | undefined
  /** Columns a rule can read instead of its own */
  otherColumns: Column[]
  rows: GridRow[]
  /** The record whose cell is being formatted (cell mode) */
  rowId: number | undefined
  nameColId: number | null
  isColumnMode: boolean
  onChange: (patch: Partial<CellFormatRule>) => void
  /** Move this rule to another place in the list (earlier rules win) */
  onMove: (to: number) => void
  onRemove: () => void
}

/** One highlight rule: what it reads, the condition, and the style it applies */
export function CellFormatRuleCard({
  rule, index: i, ruleCount, columns, thisColumn, otherColumns, rows, rowId, nameColId, isColumnMode, onChange, onMove, onRemove,
}: CellFormatRuleCardProps): React.ReactElement {
  const { t } = useVocab()
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
    <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
      {/* Rule header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 dark:bg-slate-700/50 border-b border-slate-200 dark:border-slate-700">
        <span className="text-sm font-semibold text-slate-500 uppercase tracking-wide flex-shrink-0">Highlight rule {i + 1}</span>
        <input
          type="text"
          className="flex-1 bg-transparent border-0 border-b border-transparent focus:border-blue-500 text-base text-slate-700 dark:text-slate-200 placeholder:text-slate-500 py-0"
          placeholder="Name this rule (optional)"
          value={rule.name ?? ''}
          onChange={e => onChange({ name: e.target.value || undefined })}
        />
        {ruleCount > 1 && (
          <div className="flex flex-col flex-shrink-0">
            <button onClick={() => onMove(i - 1)} disabled={i === 0}
              className="hit-44 text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 disabled:opacity-30 disabled:cursor-default"
              title="Move up (higher priority)">
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => onMove(i + 1)} disabled={i >= ruleCount - 1}
              className="hit-44 text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 disabled:opacity-30 disabled:cursor-default"
              title="Move down (lower priority)">
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        <button onClick={onRemove} title="Delete this rule" aria-label="Delete this rule" className="hit-44 p-1 text-slate-500 dark:text-slate-400 hover:text-red-500 rounded-sm focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 flex-shrink-0">
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
            onChange={e => onChange({
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
              onChange={e => onChange({ sourceColumnId: e.target.value ? parseInt(e.target.value, 10) : undefined })}>
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
              onChange={e => onChange({ sourceRowId: e.target.value ? parseInt(e.target.value, 10) : undefined })}>
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
              onChange={e => onChange({ operator: e.target.value as CellFormatOperator, value: '', value2: undefined })}>
              {operators.map(op => <option key={op.value} value={op.value}>{op.label}</option>)}
            </select>

            {needsValue && !isDropdown && (
              isDate ? (
                <input type="date" className="input flex-1 py-1 text-base" style={{ minHeight: 36, minWidth: 140 }}
                  value={rule.value} onChange={e => onChange({ value: e.target.value })} />
              ) : (
                <input className="input w-full py-1 text-base" style={{ minHeight: 36 }}
                  type={isNumber ? 'number' : 'text'}
                  value={rule.value} onChange={e => onChange({ value: e.target.value })}
                  placeholder={rule.operator === 'between' || rule.operator === 'date_between' ? 'From' : 'Value'} />
              )
            )}

            {needsValue && isDropdown && (
              <select className="input flex-1 py-1 text-base" style={{ minHeight: 36, minWidth: 140 }}
                value={rule.value} onChange={e => onChange({ value: e.target.value })}>
                <option value="">— pick option —</option>
                {dropdownOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
              </select>
            )}

            {(rule.operator === 'between' || rule.operator === 'date_between') && (
              isDate ? (
                <input type="date" className="input flex-1 py-1 text-base" style={{ minHeight: 36, minWidth: 140 }}
                  value={rule.value2 ?? ''} onChange={e => onChange({ value2: e.target.value })} />
              ) : (
                <input type="number" className="input w-full py-1 text-base" style={{ minHeight: 36 }}
                  value={rule.value2 ?? ''} onChange={e => onChange({ value2: e.target.value })}
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
            <CellSwatchPicker value={rule.bgColor} onChange={v => onChange({ bgColor: v, pulse: false })} allowNone />
          </div>

          {/* Border glow */}
          <div>
            <p className="text-sm text-slate-500 mb-1.5">Border glow</p>
            <div className="flex gap-1.5 flex-wrap">
              <button type="button" onClick={() => onChange({ borderColor: undefined })}
                className={`hit-44 w-7 h-7 rounded-lg border-2 flex items-center justify-center text-slate-500 text-base ${
                  !rule.borderColor ? 'border-slate-700 dark:border-white scale-110' : 'border-slate-300 dark:border-slate-600'
                }`} title="No border">∅</button>
              {BORDER_COLORS.map(c => (
                <button key={c.hex} type="button" title={c.name}
                  onClick={() => onChange({ borderColor: c.hex })}
                  className={`hit-44 w-7 h-7 rounded-lg border-2 transition-all ${
                    rule.borderColor === c.hex
                      ? 'border-slate-800 dark:border-white scale-110 shadow-md'
                      : 'border-transparent hover:scale-110 hover:border-slate-400'
                  }`}
                  style={{ backgroundColor: c.hex }} />
              ))}
              <input type="color" value={rule.borderColor ?? '#3b82f6'}
                onChange={e => onChange({ borderColor: e.target.value })}
                className="w-7 h-7 rounded-lg cursor-pointer border-2 border-slate-200 p-0"
                title="Custom border color" />
            </div>
          </div>

          {/* Text + toggles */}
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-1.5">
              <span className="text-sm text-slate-500">Text:</span>
              <input type="color" value={rule.textColor ?? '#1e293b'}
                onChange={e => onChange({ textColor: e.target.value })}
                className="w-7 h-7 rounded-sm cursor-pointer border border-slate-200 p-0" />
              {rule.textColor && (
                <button onClick={() => onChange({ textColor: undefined })}
                  className="hit-44 text-base text-slate-500 dark:text-slate-400 hover:text-slate-600 underline">reset</button>
              )}
            </div>
            <label className="flex items-center gap-1.5 cursor-pointer text-base text-slate-600 dark:text-slate-300">
              <input type="checkbox" checked={!!rule.bold}
                onChange={e => onChange({ bold: e.target.checked })}
                className="w-4 h-4 rounded-sm border-slate-300 text-blue-600" />
              <span className="font-bold">Bold</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer text-base text-slate-600 dark:text-slate-300">
              <input type="checkbox" checked={!!rule.italic}
                onChange={e => onChange({ italic: e.target.checked })}
                className="w-4 h-4 rounded-sm border-slate-300 text-blue-600" />
              <span className="italic">Italic</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer text-base text-slate-600 dark:text-slate-300">
              <input type="checkbox" checked={!!rule.pulse}
                onChange={e => onChange({ pulse: e.target.checked, bgColor: e.target.checked ? undefined : rule.bgColor })}
                className="w-4 h-4 rounded-sm border-slate-300 text-blue-600" />
              Pulse
            </label>
          </div>
          <label className="flex items-center gap-2 cursor-pointer select-none text-base text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={!!rule.highlightRow}
              onChange={e => onChange({ highlightRow: e.target.checked })}
              className="w-4 h-4 rounded-sm border-slate-300 text-blue-600 focus-visible:ring-3 focus-visible:ring-blue-500" />
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
}
