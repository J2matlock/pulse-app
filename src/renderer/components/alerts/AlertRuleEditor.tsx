/**
 * AlertRuleEditor — Modal for creating/editing alert rules.
 * Built-in (is_system=1) rules are view-only. Rule kinds, "Only when…",
 * working days and the live preview are in RuleKindFields (W05 §6).
 */
import React, { useRef, useState } from 'react'
import { motion } from 'motion/react'
import { X, Plus, Trash2, AlertCircle, Pipette } from 'lucide-react'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { backdropVariants, modalPanelVariants } from '../../utils/animations'
import { useShallow } from 'zustand/react/shallow'
import { useAlertStore } from '../../stores/alertStore'
import type { ParsedAlertRule, AlertThreshold } from '../../../shared/types'
import { resolveAlertColor } from '../../utils/alertColors'
import { toRuleInterval, hasInterval, describeInterval, type RuleInterval } from '../../../shared/ruleInterval'
import { useVocab } from '../../hooks/useVocab'
import { useGridStore } from '../../stores/gridStore'
import { draftFromRule, draftToConfig, draftToCondition, type RuleDraft } from './ruleDraft'
import { useRuleList } from './useRuleList'
import { ruleSummary } from '../../../shared/ruleSummary'
import { KindCards, KindFields, ConditionFields, RulePreview, previewRule } from './RuleKindFields'

// ── Color palette ──────────────────────────────────────────────────────────────
// 3 rows: subtle (low-urgency) → medium → vivid (high-urgency)
const COLOR_ROWS: Array<{ label: string; colors: Array<{ hex: string; name: string }> }> = [
  {
    label: 'Subtle',
    colors: [
      { hex: '#bbf7d0', name: 'Mint' },
      { hex: '#fef08a', name: 'Lemon' },
      { hex: '#fed7aa', name: 'Peach' },
      { hex: '#fecaca', name: 'Blush' },
      { hex: '#e9d5ff', name: 'Lavender' },
      { hex: '#bfdbfe', name: 'Sky' },
    ],
  },
  {
    label: 'Medium',
    colors: [
      { hex: '#4ade80', name: 'Green' },
      { hex: '#facc15', name: 'Amber' },
      { hex: '#fb923c', name: 'Orange' },
      { hex: '#f87171', name: 'Coral' },
      { hex: '#c084fc', name: 'Purple' },
      { hex: '#60a5fa', name: 'Blue' },
    ],
  },
  {
    label: 'Vivid',
    colors: [
      { hex: '#16a34a', name: 'Forest' },
      { hex: '#d97706', name: 'Amber dark' },
      { hex: '#ea580c', name: 'Deep orange' },
      { hex: '#dc2626', name: 'Crimson' },
      { hex: '#9333ea', name: 'Violet' },
      { hex: '#2563eb', name: 'Royal blue' },
    ],
  },
]

// Special animated options (CSS class, not hex)
const PULSE_OPTIONS = [
  { value: 'alert-pulse',      label: 'Pulsing red',      hex: '#ef4444' },
  { value: 'alert-pulse-dark', label: 'Dark pulsing red', hex: '#dc2626' },
]

// Preset intervals — covers the most common social-work/care cycles.
// Months/years are calendar-based (an annual review stays on the same date).
const INTERVAL_PRESETS: Array<{ key: string; label: string; days: number; months: number }> = [
  { key: 'd0',   label: 'Date is the deadline', days: 0,  months: 0 },
  { key: 'd30',  label: '30 days after',        days: 30, months: 0 },
  { key: 'd90',  label: '90 days after',        days: 90, months: 0 },
  { key: 'm1',   label: '1 month after',        days: 0,  months: 1 },
  { key: 'm6',   label: '6 months after',       days: 0,  months: 6 },
  { key: 'm12',  label: '1 year after',         days: 0,  months: 12 },
  { key: 'm24',  label: '2 years after',        days: 0,  months: 24 },
  { key: 'm36',  label: '3 years after',        days: 0,  months: 36 },
]

type IntervalUnit = 'days' | 'months' | 'years'

function initialInterval(rule?: ParsedAlertRule): { key: string; amount: string; unit: IntervalUnit } {
  const iv = toRuleInterval(rule)
  const preset = INTERVAL_PRESETS.find(p => p.days === iv.days && p.months === iv.months)
  if (preset) return { key: preset.key, amount: '', unit: 'days' }
  if (iv.months > 0) {
    return iv.months % 12 === 0
      ? { key: 'custom', amount: String(iv.months / 12), unit: 'years' }
      : { key: 'custom', amount: String(iv.months), unit: 'months' }
  }
  return { key: 'custom', amount: String(iv.days), unit: 'days' }
}

interface Props {
  rule?: ParsedAlertRule
  /** The column the rule is being set up on, when opened from a column (for "this column" and the preview) */
  columnId?: number
  onClose: (createdRuleId?: number) => void
}

// ── Color Picker sub-component ─────────────────────────────────────────────────
function ColorPicker({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (v: string) => void
  disabled: boolean
}): React.ReactElement {
  const { t: w } = useVocab(null)
  const isPulse = PULSE_OPTIONS.some(p => p.value === value)
  const isCustom = !isPulse && value.startsWith('#') &&
    !COLOR_ROWS.some(row => row.colors.some(c => c.hex === value))

  return (
    <div className="space-y-2">
      {/* Palette rows */}
      {COLOR_ROWS.map(row => (
        <div key={row.label} className="flex items-center gap-1.5">
          <span className="text-sm text-slate-500 dark:text-slate-400 w-12 flex-shrink-0">{row.label}</span>
          <div className="flex gap-1.5">
            {row.colors.map(c => (
              <button
                key={c.hex}
                type="button"
                title={c.name}
                disabled={disabled}
                onClick={() => onChange(c.hex)}
                className={`hit-44 w-8 h-8 rounded-lg border-2 transition-all focus:outline-hidden focus-visible:ring-3 focus-visible:ring-offset-1 focus-visible:ring-blue-500 disabled:cursor-not-allowed ${
                  value === c.hex
                    ? 'border-slate-800 dark:border-white scale-110 shadow-lg'
                    : 'border-transparent hover:scale-110 hover:border-slate-400 hover:shadow-md'
                }`}
                style={{ backgroundColor: c.hex }}
              />
            ))}
          </div>
        </div>
      ))}

      {/* Pulse row */}
      <div className="flex items-center gap-1.5">
        <span className="text-sm text-slate-500 dark:text-slate-400 w-12 flex-shrink-0">Pulse</span>
        <div className="flex gap-1.5">
          {PULSE_OPTIONS.map(p => (
            <button
              key={p.value}
              type="button"
              title={p.label}
              disabled={disabled}
              onClick={() => onChange(p.value)}
              className={`hit-44 w-8 h-8 rounded-lg border-2 transition-all focus:outline-hidden focus-visible:ring-3 focus-visible:ring-offset-1 focus-visible:ring-blue-500 disabled:cursor-not-allowed ${
                value === p.value
                  ? 'border-slate-800 dark:border-white scale-110 shadow-lg'
                  : 'border-transparent hover:scale-110 hover:border-slate-400 hover:shadow-md'
              } alert-pulse`}
              style={{ backgroundColor: p.hex }}
            />
          ))}
          <span className="text-sm text-slate-500 dark:text-slate-400 self-center ml-1">
            Animated blink — for overdue items
          </span>
        </div>
      </div>

      {/* Custom color */}
      <div className="flex items-center gap-2 pt-1 border-t border-slate-200 dark:border-slate-600">
        <Pipette className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 flex-shrink-0" />
        <span className="text-sm text-slate-500 dark:text-slate-400 flex-shrink-0">Custom:</span>
        <div className="relative flex-shrink-0">
          <input
            type="color"
            disabled={disabled}
            value={isCustom ? value : '#ffffff'}
            onChange={e => onChange(e.target.value)}
            className="w-8 h-8 rounded-lg cursor-pointer border-2 disabled:cursor-not-allowed p-0 overflow-hidden"
            style={{
              borderColor: isCustom ? '#1e293b' : '#e2e8f0',
            }}
            title="Pick any color"
          />
        </div>
        {isCustom && (
          <span className="text-sm text-slate-500 dark:text-slate-400 font-mono">{value}</span>
        )}
        {!isCustom && (
          <span className="text-sm text-slate-500 dark:text-slate-400">Click to choose any color</span>
        )}
      </div>

      {/* Live preview */}
      <div className="flex items-center gap-3 p-2.5 rounded-lg border border-slate-200 dark:border-slate-600">
        <span className="text-sm text-slate-500 dark:text-slate-400 flex-shrink-0">Preview:</span>
        <div
          className={`flex-1 rounded-sm px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 ${resolveAlertColor(value).className}`}
          style={resolveAlertColor(value).style}
        >
          {w('record', { cap: true })} name · Column name
        </div>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
export function AlertRuleEditor({ rule, columnId, onClose }: Props): React.ReactElement {
  const trapRef = useRef<HTMLDivElement>(null)
  useFocusTrap(trapRef, true)
  const { createRule, updateRule } = useAlertStore(useShallow(s => ({
    createRule: s.createRule, updateRule: s.updateRule,
  })))
  const isSystem = rule?.is_system === 1
  const isNew = !rule
  const { t: w } = useVocab(null)

  const [name, setName] = useState(rule?.name ?? '')
  const [description, setDescription] = useState(rule?.description ?? '')

  const init = initialInterval(rule)
  const [intervalKey, setIntervalKey] = useState(init.key)
  const [customAmount, setCustomAmount] = useState(init.amount)
  const [customUnit, setCustomUnit] = useState<IntervalUnit>(init.unit)
  const [endOfMonth, setEndOfMonth] = useState(!!rule?.end_of_month)
  const [draft, setDraft] = useState<RuleDraft>(() => {
    const d = draftFromRule(rule)
    // A deadline column has no date of its own, so "after the date in this column" can't apply
    const onDeadlineColumn = useGridStore.getState().columns.find(c => c.id === columnId)?.column_type === 'deadline'
    return !rule && onDeadlineColumn ? { ...d, kind: 'calendar' } : d
  })
  const [businessDays, setBusinessDays] = useState(!!rule?.business_days)
  const patchDraft = (patch: Partial<RuleDraft>) => setDraft(d => ({ ...d, ...patch }))
  // The list the rule works in: from the columns that use it, not whichever list is open (D-09)
  const ruleList = useRuleList(rule?.id, columnId)
  const { columns, rows } = ruleList
  const ownColumnId = ruleList.columnId
  // Other columns to work from; the rule's own column is offered as "this column"
  const otherColumns = columns.filter(c => c.id !== ownColumnId)

  const [thresholds, setThresholds] = useState<AlertThreshold[]>(
    rule?.thresholds ?? [
      { daysBefore: 60,  bgClass: '#bbf7d0', label: 'Upcoming' },
      { daysBefore: 30,  bgClass: '#facc15', label: 'Due Soon' },
      { daysBefore: 14,  bgClass: '#fb923c', label: 'Urgent' },
      { daysBefore: 0,   bgClass: '#dc2626', label: 'Due Today' },
      { daysBefore: -1,  bgClass: 'alert-pulse-dark', label: 'Overdue' },
    ]
  )
  const [expandedThreshold, setExpandedThreshold] = useState<number | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const interval: RuleInterval = (() => {
    if (intervalKey !== 'custom') {
      const p = INTERVAL_PRESETS.find(x => x.key === intervalKey) ?? { days: 0, months: 0 }
      return { days: p.days, months: p.months, endOfMonth }
    }
    const n = Math.max(0, parseInt(customAmount, 10) || 0)
    if (customUnit === 'days') return { days: n, months: 0, endOfMonth }
    return { days: 0, months: customUnit === 'years' ? n * 12 : n, endOfMonth }
  })()
  const isInterval = draft.kind === 'interval'
  const intervalFields = isInterval
    ? { interval_days: interval.days || null, interval_months: interval.months || null, end_of_month: interval.endOfMonth ? 1 : 0 }
    : { interval_days: null, interval_months: null, end_of_month: 0 }
  const previewRuleForName = previewRule(draft, { id: 0, name: '', description: null, is_system: 0, thresholds: [], created_at: '', ...intervalFields }, false)
  // What a name left blank becomes: "Every 6 months", "45 days after Referral date"
  const autoName = 'error' in previewRuleForName ? 'New deadline rule' : ruleSummary(previewRuleForName, id => columns.find(c => c.id === id)?.name)
  const preview = previewRule(draft, {
    id: rule?.id ?? 0, name, description: null, is_system: 0, thresholds, created_at: '', ...intervalFields,
  }, businessDays)

  function addThreshold() {
    const next = thresholds.length
    setThresholds(prev => [...prev, { daysBefore: 7, bgClass: '#f87171', label: 'Alert' }])
    setExpandedThreshold(next)
  }

  function removeThreshold(i: number) {
    setThresholds(prev => prev.filter((_, idx) => idx !== i))
    setExpandedThreshold(null)
  }

  function updateThreshold(i: number, patch: Partial<AlertThreshold>) {
    setThresholds(prev => prev.map((t, idx) => idx === i ? { ...t, ...patch } : t))
  }

  function setThresholdDays(i: number, absValue: number, direction: 'before' | 'after') {
    updateThreshold(i, { daysBefore: direction === 'before' ? absValue : -absValue })
  }

  async function handleSave() {
    // A new rule is named after what it does unless someone typed a name (D-17)
    const finalName = (name.trim() || autoName).slice(0, 200)
    if (thresholds.length === 0) { setError('Add at least one threshold.'); return }
    const cfg = draftToConfig(draft)
    if (!cfg.ok) { setError(cfg.error); return }
    const cond = draftToCondition(draft)
    if (!cond.ok) { setError(cond.error); return }
    const engineFields = {
      kind: draft.kind,
      rule_config: cfg.value ? JSON.stringify(cfg.value) : null,
      rule_condition: cond.value ? JSON.stringify(cond.value) : null,
      business_days: businessDays && draft.kind !== 'quota' ? 1 : 0,
    }
    setIsSaving(true)
    setError(null)
    try {
      if (isNew) {
        const newId = await createRule({
          name: finalName,
          description: description.trim() || null,
          is_system: 0,
          thresholds: JSON.stringify(thresholds),
          ...intervalFields,
          ...engineFields,
        })
        onClose(newId ?? undefined)
      } else {
        await updateRule(rule!.id, {
          name: finalName,
          description: description.trim() || null,
          thresholds: JSON.stringify(thresholds),
          ...intervalFields,
          ...engineFields,
        })
        onClose()
      }
    } catch {
      setError('Failed to save alert rule. Please try again.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div ref={trapRef} className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <motion.div variants={backdropVariants} initial="hidden" animate="visible" className="fixed inset-0 bg-black/50" onClick={() => onClose()} />
      <motion.div variants={modalPanelVariants} initial="hidden" animate="visible" className="relative bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
            {isNew ? 'New Alert Rule' : isSystem ? 'View Alert Rule' : 'Edit Alert Rule'}
          </h2>
          <button onClick={() => onClose()} className="hit-44 p-1.5 rounded-sm hover:bg-slate-100 dark:hover:bg-slate-700 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {isSystem && (
            <div className="flex items-start gap-2 p-3 bg-slate-50 dark:bg-slate-700 rounded-lg text-sm text-slate-600 dark:text-slate-300">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-slate-500 dark:text-slate-400" />
              <span>This is a built-in rule and cannot be edited.</span>
            </div>
          )}

          {ruleList.choices.length > 0 && (
            <div>
              <label htmlFor="alert-rule-list" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">
                {ruleList.uses.length > 0 ? `Used in more than one ${w('list')}. Show the columns of` : `Columns from which ${w('list')}?`}
              </label>
              <select id="alert-rule-list" className="input" value={ruleList.gridId ?? ''} onChange={e => ruleList.setGridId(Number(e.target.value))}>
                {ruleList.choices.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}

          {/* How it's worked out */}
          <div>
            <h3 className="text-base font-medium text-slate-700 dark:text-slate-300 mb-2">How is this deadline worked out?</h3>
            <KindCards value={draft.kind} onChange={k => patchDraft({ kind: k })} disabled={isSystem} />
          </div>

          {ruleList.loading ? <p className="text-base text-slate-500 dark:text-slate-400">Loading the {w('list')}'s columns…</p>
            : !isInterval && <KindFields d={draft} set={patchDraft} columns={otherColumns} disabled={isSystem} />}

          {isInterval && (
          <div>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-2">
              How is the deadline calculated from the date stored in the cell?
            </p>
            <div className="flex flex-wrap gap-2">
              {INTERVAL_PRESETS.map(preset => (
                <button key={preset.key} type="button"
                  onClick={() => !isSystem && setIntervalKey(preset.key)}
                  disabled={isSystem} aria-pressed={intervalKey === preset.key}
                  className={`hit-44 px-3 py-1.5 rounded-lg text-base border transition-colors focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 ${
                    intervalKey === preset.key
                      ? 'bg-blue-600 border-blue-600 text-white font-medium'
                      : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {preset.label}
                </button>
              ))}
              <button type="button" onClick={() => !isSystem && setIntervalKey('custom')} disabled={isSystem} aria-pressed={intervalKey === 'custom'}
                className={`hit-44 px-3 py-1.5 rounded-lg text-base border transition-colors focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 ${
                  intervalKey === 'custom'
                    ? 'bg-blue-600 border-blue-600 text-white font-medium'
                    : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                Custom…
              </button>
            </div>
            {intervalKey === 'custom' && (
              <div className="mt-2 flex items-center gap-2">
                <input type="number" min={1} className="input w-28" aria-label="How many"
                  value={customAmount} onChange={e => setCustomAmount(e.target.value)}
                  disabled={isSystem} placeholder="e.g. 18" />
                <select className="input w-32" aria-label="Unit" value={customUnit}
                  onChange={e => setCustomUnit(e.target.value as IntervalUnit)} disabled={isSystem}>
                  <option value="days">days</option>
                  <option value="months">months</option>
                  <option value="years">years</option>
                </select>
                <span className="text-base text-slate-600 dark:text-slate-300">after the date entered</span>
              </div>
            )}
            <label className="mt-3 flex items-center gap-2 min-h-[44px] text-base text-slate-700 dark:text-slate-300 cursor-pointer">
              <input type="checkbox" className="w-5 h-5" checked={endOfMonth} disabled={isSystem}
                onChange={e => setEndOfMonth(e.target.checked)} />
              Due by the end of that month
            </label>
            {hasInterval(interval) && (
              <p className="mt-2 text-sm text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20 px-3 py-1.5 rounded-lg">
                <strong>{describeInterval(interval)}.</strong> Colors are measured from that deadline.
              </p>
            )}
          </div>
          )}

          {/* A quota's date is the end of its period; moving it would only hide its warnings */}
          {draft.kind !== 'quota' && (
          <label className="flex items-center gap-2 min-h-[44px] text-base text-slate-700 dark:text-slate-300 cursor-pointer">
            <input type="checkbox" className="w-5 h-5" checked={businessDays} disabled={isSystem} onChange={e => setBusinessDays(e.target.checked)} />
            Count working days only <span className="text-sm text-slate-500 dark:text-slate-400">— a due date on a weekend or day off moves to the working day before</span>
          </label>
          )}

          {!ruleList.loading && <ConditionFields d={draft} set={patchDraft} columns={columns} disabled={isSystem} />}

          {/* Name and description, under More: a new rule is named after what it does (D-17) */}
          <details open={!isNew} className="rounded-lg border border-slate-200 dark:border-slate-600 px-3">
            <summary className="hit-44 flex items-center text-base font-medium text-slate-700 dark:text-slate-300 cursor-pointer" style={{ minHeight: 44 }}>
              More: name and description
            </summary>
            <div className="space-y-3 pb-3">
              <div>
                <label htmlFor="alert-rule-name" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">Rule name</label>
                <input id="alert-rule-name" className="input" value={name} onChange={e => setName(e.target.value)}
                  disabled={isSystem} placeholder={autoName} />
              </div>
              <div>
                <label htmlFor="alert-rule-description" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Description <span className="font-normal text-slate-500 dark:text-slate-400">— optional</span>
                </label>
                <input id="alert-rule-description" className="input" value={description} onChange={e => setDescription(e.target.value)}
                  disabled={isSystem} placeholder="Brief description of this rule" />
              </div>
            </div>
          </details>

          {/* Thresholds */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-base font-medium text-slate-700 dark:text-slate-300">Color Thresholds</label>
              {!isSystem && (
                <button onClick={addThreshold}
                  className="hit-44 flex items-center gap-1 text-base text-blue-600 dark:text-blue-400 hover:underline focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 rounded-sm">
                  <Plus className="w-4 h-4" />Add threshold
                </button>
              )}
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-2">
              Click a threshold to expand its color picker.
            </p>

            {thresholds.length === 0 && <p className="text-sm text-slate-500 dark:text-slate-400 py-2">No thresholds yet.</p>}

            <div className="space-y-2">
              {thresholds.map((t, i) => {
                const absValue = Math.abs(t.daysBefore)
                const direction: 'before' | 'after' = t.daysBefore >= 0 ? 'before' : 'after'
                const isOpen = expandedThreshold === i
                const { className: colorClass, style: colorStyle } = resolveAlertColor(t.bgClass)

                return (
                  <div key={i} className="rounded-lg border border-slate-200 dark:border-slate-600 overflow-hidden">
                    {/* Summary row — click to expand/collapse color picker */}
                    <div
                      className={`flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${
                        isOpen ? 'bg-slate-100 dark:bg-slate-700' : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'
                      }`}
                      onClick={() => setExpandedThreshold(isOpen ? null : i)}
                    >
                      {/* Color preview swatch */}
                      <div
                        className={`w-6 h-6 rounded-sm flex-shrink-0 border border-slate-300 dark:border-slate-500 ${colorClass}`}
                        style={colorStyle}
                      />

                      {/* Timing */}
                      <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        {!isSystem ? (
                          <>
                            <input
                              type="number" min={0}
                              className="input w-14 text-center py-0.5 text-base"
                              style={{ minHeight: 30 }}
                              value={absValue}
                              onChange={e => { e.stopPropagation(); setThresholdDays(i, parseInt(e.target.value, 10) || 0, direction) }}
                              onClick={e => e.stopPropagation()}
                              disabled={isSystem}
                            />
                            <select
                              className="input py-0.5 text-base"
                              style={{ minHeight: 30 }}
                              value={direction}
                              onChange={e => { e.stopPropagation(); setThresholdDays(i, absValue, e.target.value as 'before' | 'after') }}
                              onClick={e => e.stopPropagation()}
                              disabled={isSystem}
                            >
                              <option value="before">days before deadline</option>
                              <option value="after">days past deadline</option>
                            </select>
                          </>
                        ) : (
                          <span className="text-sm text-slate-600 dark:text-slate-300">
                            {absValue} {direction === 'before' ? 'days before' : 'days past'} deadline
                          </span>
                        )}
                        <input
                          type="text"
                          className="input flex-1 py-0.5 text-base min-w-0"
                          style={{ minHeight: 30 }}
                          value={t.label}
                          onChange={e => { e.stopPropagation(); updateThreshold(i, { label: e.target.value }) }}
                          onClick={e => e.stopPropagation()}
                          disabled={isSystem}
                          placeholder="Label"
                        />
                      </div>

                      {!isSystem && (
                        <button
                          onClick={e => { e.stopPropagation(); removeThreshold(i) }}
                          className="hit-44 p-1 text-slate-500 dark:text-slate-400 hover:text-red-500 focus:outline-hidden rounded-sm flex-shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {/* Expanded color picker */}
                    {isOpen && !isSystem && (
                      <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800">
                        <ColorPicker
                          value={t.bgClass}
                          onChange={v => updateThreshold(i, { bgClass: v })}
                          disabled={isSystem}
                        />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          <RulePreview key={ruleList.gridId ?? 0} rule={preview} rows={rows} columns={columns} columnId={ownColumnId} />

          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded-lg text-sm">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-700">
          <button onClick={() => onClose()} className="btn-secondary">Cancel</button>
          {!isSystem && (
            <button onClick={handleSave} disabled={isSaving} className="btn-primary">
              {isSaving ? 'Saving…' : isNew ? 'Create Rule' : 'Save Changes'}
            </button>
          )}
        </div>
      </motion.div>
    </div>
  )
}
