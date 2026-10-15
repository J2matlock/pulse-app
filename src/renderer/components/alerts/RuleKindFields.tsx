/**
 * Rule editor v2 (W05 §6): "How is this deadline worked out?" cards, the
 * fields for each kind, "Only when…", and a live preview on a real record.
 */
import React, { useId, useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { Column, GridRow, ParsedAlertRule } from '../../../shared/types'
import { RULE_KINDS, type RuleKind } from '../../../shared/deadlineEngine'
import { evaluateRuleForRow } from '../../utils/deadlineCalc'
import { getClientName } from '../../utils/clientName'
import { useActivityTypes } from '../../hooks/useActivityTypes'
import { useVocab } from '../../hooks/useVocab'
import { draftToConfig, draftToCondition, type RuleDraft, type Anchor, type OffsetUnit } from './ruleDraft'

/** Examples carry {word} tokens so they read in the workspace's own words (E-30) */
const KIND_CARD_TEXT = {
  interval: { title: 'After the date in this column', example: 'Every 30 days, 6 months, 1 year' },
  relative: { title: 'From another date', example: '45 days after Referral date · 60 days before Lease end' },
  calendar: { title: 'On fixed dates', example: 'Every Mar 31 · quarterly on the 15th' },
  meter: { title: 'By usage', example: 'Every 5,000 miles or 6 months, whichever is first' },
  quota: { title: 'A limited number of {activity:many}', example: '12 {activity:many} until the authorization ends' },
  sequence: { title: 'A series of steps', example: '30-day review, 90-day review, then every year' },
} satisfies Record<RuleKind, { title: string; example: string }>

/** One card per rule kind, in RULE_KINDS order */
export const KIND_CARDS: Array<{ kind: RuleKind; title: string; example: string }> = RULE_KINDS.map(kind => ({ kind, ...KIND_CARD_TEXT[kind] }))

/**
 * Why a kind can't be used with these columns (null when it can), so the card
 * is greyed out with the reason instead of leading to "add a column first" (E-30).
 */
export function kindUnavailable(columns: Column[]): Record<RuleKind, string | null> {
  const dates = columns.filter(c => c.column_type === 'date').length
  const numbers = columns.filter(c => c.column_type === 'number' || c.column_type === 'currency').length
  return {
    interval: null,
    relative: null,
    calendar: null,
    meter: numbers < 2 ? 'Needs two number columns in this {list}: the current reading and the reading at the last service.' : null,
    quota: dates === 0 ? 'Needs a start and an end date column in this {list}.' : null,
    sequence: null,
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const UNIT_LABELS: Record<OffsetUnit, string> = { days: 'days', months: 'months', businessDays: 'working days' }

const label = 'block text-base font-medium text-slate-700 dark:text-slate-300 mb-1'
const hint = 'text-sm text-slate-500 dark:text-slate-400'

type Set = (patch: Partial<RuleDraft>) => void

export function KindCards({ value, onChange, disabled, columns }: {
  value: RuleKind; onChange: (k: RuleKind) => void; disabled: boolean
  /** The list's columns; kinds they can't support are greyed out with the reason (the chosen kind stays usable) */
  columns?: Column[]
}): React.ReactElement {
  const { f } = useVocab(null)
  const unavailable = columns ? kindUnavailable(columns) : null
  return (
    <div role="radiogroup" aria-label="How is this deadline worked out?" className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {KIND_CARDS.map(c => {
        const reason = value === c.kind ? null : unavailable?.[c.kind] ?? null
        return (
          <button key={c.kind} type="button" role="radio" aria-checked={value === c.kind} disabled={disabled || reason !== null} onClick={() => onChange(c.kind)}
            title={reason ? f(reason) : undefined}
            className={`text-left px-3 py-2 rounded-lg border-2 transition-colors focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 disabled:cursor-not-allowed ${
              value === c.kind ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/30' : reason ? 'border-slate-200 dark:border-slate-700 opacity-60' : 'border-slate-200 dark:border-slate-600 hover:border-blue-400'
            }`} style={{ minHeight: 44 }}>
            <span className="block text-base font-medium text-slate-800 dark:text-slate-100">{f(c.title)}</span>
            <span className={`block ${hint}`}>{reason ? f(reason) : f(c.example)}</span>
          </button>
        )
      })}
    </div>
  )
}

function ColumnSelect({ value, onChange, columns, ariaLabel, allowSelf, disabled, placeholder = 'Choose a column…' }: {
  value: Anchor; onChange: (v: Anchor) => void; columns: Column[]; ariaLabel: string; allowSelf?: boolean; disabled: boolean; placeholder?: string
}): React.ReactElement {
  // A saved column that isn't here any more (deleted, or the wrong kind): say so in red (D-25)
  const missing = typeof value === 'number' && !columns.some(c => c.id === value)
  const msgId = useId()
  return (
    <span className="inline-flex flex-col gap-1 max-w-full">
      <select className={`input ${missing ? 'border-red-500 dark:border-red-400 text-red-700 dark:text-red-300' : ''}`} aria-label={ariaLabel} disabled={disabled}
        aria-invalid={missing || undefined} aria-describedby={missing ? msgId : undefined}
        value={value === null ? '' : String(value)}
        onChange={e => onChange(e.target.value === '' ? null : e.target.value === 'self' ? 'self' : Number(e.target.value))}>
        <option value="">{placeholder}</option>
        {missing && <option value={String(value)}>Missing column</option>}
        {allowSelf && <option value="self">This column (the one the rule is on)</option>}
        {columns.map(c => <option key={c.id} value={c.id}>{c.name}{c.is_visible === 0 ? ' (hidden)' : ''}</option>)}
      </select>
      {missing && <span id={msgId} role="alert" className="text-sm text-red-700 dark:text-red-300">The column this used is gone. Choose another, or the deadline won't work.</span>}
    </span>
  )
}

function NoColumns({ kind }: { kind: string }): React.ReactElement {
  const { t } = useVocab(null)
  return <p className={hint}>This {t('list')} has no {kind} columns yet. Add one first, then come back.</p>
}

function OffsetInput({ amount, unit, onAmount, onUnit, disabled, ariaPrefix }: {
  amount: string; unit: OffsetUnit; onAmount: (v: string) => void; onUnit: (u: OffsetUnit) => void; disabled: boolean; ariaPrefix: string
}): React.ReactElement {
  return (
    <>
      <input type="number" min={0} className="input w-24" aria-label={`${ariaPrefix} amount`} disabled={disabled} value={amount} onChange={e => onAmount(e.target.value)} />
      <select className="input w-40" aria-label={`${ariaPrefix} unit`} disabled={disabled} value={unit} onChange={e => onUnit(e.target.value as OffsetUnit)}>
        {(Object.keys(UNIT_LABELS) as OffsetUnit[]).map(u => <option key={u} value={u}>{UNIT_LABELS[u]}</option>)}
      </select>
    </>
  )
}

/** Fields for the chosen kind (interval keeps the editor's own presets). */
export function KindFields({ d, set, columns, disabled }: { d: RuleDraft; set: Set; columns: Column[]; disabled: boolean }): React.ReactElement | null {
  const dates = columns.filter(c => c.column_type === 'date')
  const numbers = columns.filter(c => c.column_type === 'number' || c.column_type === 'currency')
  const { active: noteTypes } = useActivityTypes()
  const { t } = useVocab(null)

  switch (d.kind) {
    case 'interval':
      return null
    case 'relative':
      return (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <OffsetInput amount={d.relAmount} unit={d.relUnit} onAmount={v => set({ relAmount: v })} onUnit={u => set({ relUnit: u })} disabled={disabled} ariaPrefix="Offset" />
            <select className="input w-28" aria-label="Before or after" disabled={disabled} value={d.relDirection} onChange={e => set({ relDirection: e.target.value as 'after' | 'before' })}>
              <option value="after">after</option>
              <option value="before">before</option>
            </select>
          </div>
          {dates.length === 0 ? <NoColumns kind="date" /> : (
            <ColumnSelect ariaLabel="Worked out from" value={d.relAnchor} onChange={v => set({ relAnchor: v })} columns={dates} allowSelf disabled={disabled} placeholder="Choose the date…" />
          )}
          <p className={hint}>A date typed in this rule's own column counts as done for that cycle.</p>
        </div>
      )
    case 'calendar':
      return (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-4">
            {(['fixed', 'anniversary'] as const).map(m => (
              <label key={m} className="flex items-center gap-2 text-base text-slate-700 dark:text-slate-300 cursor-pointer" style={{ minHeight: 44 }}>
                <input type="radio" name="cal-mode" className="w-5 h-5" disabled={disabled} checked={d.calMode === m} onChange={() => set({ calMode: m })} />
                {m === 'fixed' ? 'Same dates every year' : 'Every year on the date in a column'}
              </label>
            ))}
          </div>
          {d.calMode === 'fixed' ? (
            <>
              <fieldset>
                <legend className={label}>Months</legend>
                <div className="flex flex-wrap gap-1.5">
                  {MONTHS.map((m, i) => {
                    const on = d.calMonths.includes(i + 1)
                    return (
                      <button key={m} type="button" aria-pressed={on} disabled={disabled}
                        onClick={() => set({ calMonths: on ? d.calMonths.filter(x => x !== i + 1) : [...d.calMonths, i + 1] })}
                        className={`hit-44 w-14 py-1.5 rounded-lg border text-base focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 ${on ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300'}`}>
                        {m}
                      </button>
                    )
                  })}
                </div>
              </fieldset>
              <label className="flex flex-wrap items-center gap-2 text-base text-slate-700 dark:text-slate-300">
                Day
                <select className="input w-40" disabled={disabled} value={d.calDay} onChange={e => set({ calDay: e.target.value })}>
                  {Array.from({ length: 31 }, (_, i) => <option key={i} value={String(i + 1)}>{i + 1}</option>)}
                  <option value="last">Last day of the month</option>
                </select>
              </label>
            </>
          ) : dates.length === 0 ? <NoColumns kind="date" /> : (
            <ColumnSelect ariaLabel="Repeat the date in" value={d.calFromColumn} onChange={v => set({ calFromColumn: typeof v === 'number' ? v : null })} columns={dates} disabled={disabled} placeholder="Choose the date…" />
          )}
          <label className="flex flex-wrap items-center gap-2 text-base text-slate-700 dark:text-slate-300">
            Start showing
            <input type="number" min={0} className="input w-24" disabled={disabled} value={d.calLead} onChange={e => set({ calLead: e.target.value })} />
            days ahead
          </label>
        </div>
      )
    case 'meter':
      return (
        <div className="space-y-2">
          {numbers.length < 2 ? <NoColumns kind="number" /> : (
            <>
              <label className={label}>Current reading <ColumnSelect ariaLabel="Current reading column" value={d.meterReading} onChange={v => set({ meterReading: typeof v === 'number' ? v : null })} columns={numbers} disabled={disabled} /></label>
              <label className={label}>Reading at the last service <ColumnSelect ariaLabel="Last service reading column" value={d.meterLast} onChange={v => set({ meterLast: typeof v === 'number' ? v : null })} columns={numbers} disabled={disabled} /></label>
            </>
          )}
          <div className="flex flex-wrap items-center gap-2 text-base text-slate-700 dark:text-slate-300">
            Every
            <input type="text" inputMode="decimal" className="input w-28" aria-label="Every" disabled={disabled} value={d.meterEvery} onChange={e => set({ meterEvery: e.target.value })} />
            <input type="text" className="input w-24" aria-label="Unit" disabled={disabled} value={d.meterUnit} onChange={e => set({ meterUnit: e.target.value })} placeholder="mi" />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-base text-slate-700 dark:text-slate-300">
            or every
            <input type="number" min={0} className="input w-24" aria-label="Time limit" disabled={disabled} value={d.meterFallbackAmount} onChange={e => set({ meterFallbackAmount: e.target.value })} />
            <select className="input w-32" aria-label="Time limit unit" disabled={disabled} value={d.meterFallbackUnit} onChange={e => set({ meterFallbackUnit: e.target.value as 'days' | 'months' })}>
              <option value="days">days</option>
              <option value="months">months</option>
            </select>
            whichever is first <span className={hint}>(optional, counted from this column's date)</span>
          </div>
          <label className="flex flex-wrap items-center gap-2 text-base text-slate-700 dark:text-slate-300">
            Typical use per day
            <input type="text" inputMode="decimal" className="input w-24" disabled={disabled} value={d.meterTypical} onChange={e => set({ meterTypical: e.target.value })} />
            <span className={hint}>until there are enough readings to tell</span>
          </label>
        </div>
      )
    case 'quota':
      return (
        <div className="space-y-2">
          <fieldset>
            <legend className={label}>{t('activity', { many: true, cap: true })} that count</legend>
            <div className="flex flex-wrap gap-x-4">
              {noteTypes.map(nt => (
                <label key={nt.key} className="flex items-center gap-2 text-base text-slate-700 dark:text-slate-300 cursor-pointer" style={{ minHeight: 44 }}>
                  <input type="checkbox" className="w-5 h-5" disabled={disabled} checked={d.quotaTypes.includes(nt.key)}
                    onChange={e => set({ quotaTypes: e.target.checked ? [...d.quotaTypes, nt.key] : d.quotaTypes.filter(k => k !== nt.key) })} />
                  {nt.icon ? `${nt.icon} ` : ''}{nt.label}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-wrap items-center gap-2 text-base text-slate-700 dark:text-slate-300">
            Allowed
            <select className="input w-44" aria-label="How many are allowed" disabled={disabled} value={d.quotaLimitMode} onChange={e => set({ quotaLimitMode: e.target.value as 'fixed' | 'column' })}>
              <option value="fixed">a fixed number</option>
              <option value="column">from a column</option>
            </select>
            {d.quotaLimitMode === 'fixed'
              ? <input type="number" min={1} className="input w-24" aria-label="Number allowed" disabled={disabled} value={d.quotaLimit} onChange={e => set({ quotaLimit: e.target.value })} />
              : <ColumnSelect ariaLabel="Number allowed column" value={d.quotaLimitColumn} onChange={v => set({ quotaLimitColumn: typeof v === 'number' ? v : null })} columns={numbers} disabled={disabled} />}
          </div>
          {dates.length === 0 ? <NoColumns kind="date" /> : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className={label}>Starts <ColumnSelect ariaLabel="Start date column" value={d.quotaStart} onChange={v => set({ quotaStart: typeof v === 'number' ? v : null })} columns={dates} disabled={disabled} /></label>
              <label className={label}>Ends <ColumnSelect ariaLabel="End date column" value={d.quotaEnd} onChange={v => set({ quotaEnd: typeof v === 'number' ? v : null })} columns={dates} disabled={disabled} /></label>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 text-base text-slate-700 dark:text-slate-300">
            Warn when
            <input type="number" min={0} className="input w-20" aria-label="Warn when this many are left" disabled={disabled} value={d.quotaWarnRemaining} onChange={e => set({ quotaWarnRemaining: e.target.value })} />
            or fewer are left, or
            <input type="number" min={0} className="input w-20" aria-label="Warn this many days before the end" disabled={disabled} value={d.quotaWarnDays} onChange={e => set({ quotaWarnDays: e.target.value })} />
            days before the end
          </div>
        </div>
      )
    case 'sequence':
      return (
        <div className="space-y-2">
          {dates.length === 0
            ? <ColumnSelect ariaLabel="Steps count from" value={d.seqAnchor} onChange={v => set({ seqAnchor: v })} columns={[]} allowSelf disabled={disabled} placeholder="Choose the date…" />
            : <label className={label}>Steps count from <ColumnSelect ariaLabel="Steps count from" value={d.seqAnchor} onChange={v => set({ seqAnchor: v })} columns={dates} allowSelf disabled={disabled} placeholder="Choose the date…" /></label>}
          <ol className="space-y-2">
            {d.seqSteps.map((s, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <span className="text-base text-slate-500 dark:text-slate-400 w-6">{i + 1}.</span>
                <input type="text" className="input flex-1 min-w-[10rem]" aria-label={`Step ${i + 1} name`} disabled={disabled} value={s.label} placeholder="e.g. 30-day review"
                  onChange={e => set({ seqSteps: d.seqSteps.map((x, j) => j === i ? { ...x, label: e.target.value } : x) })} />
                <OffsetInput amount={s.amount} unit={s.unit} disabled={disabled} ariaPrefix={`Step ${i + 1}`}
                  onAmount={v => set({ seqSteps: d.seqSteps.map((x, j) => j === i ? { ...x, amount: v } : x) })}
                  onUnit={u => set({ seqSteps: d.seqSteps.map((x, j) => j === i ? { ...x, unit: u } : x) })} />
                <span className="text-base text-slate-600 dark:text-slate-300">after</span>
                {d.seqSteps.length > 1 && (
                  <button type="button" aria-label={`Remove step ${i + 1}`} disabled={disabled} onClick={() => set({ seqSteps: d.seqSteps.filter((_, j) => j !== i) })}
                    className="hit-44 p-2 rounded-sm text-slate-500 hover:text-red-600 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </li>
            ))}
          </ol>
          {d.seqSteps.length < 20 && (
            <button type="button" disabled={disabled} onClick={() => set({ seqSteps: [...d.seqSteps, { label: '', amount: '', unit: 'days' }] })}
              className="hit-44 flex items-center gap-1 text-base text-blue-600 dark:text-blue-400 hover:underline focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 rounded-sm">
              <Plus className="w-4 h-4" />Add a step
            </button>
          )}
          <div className="flex flex-wrap items-center gap-2 text-base text-slate-700 dark:text-slate-300">
            <label className="flex items-center gap-2 cursor-pointer" style={{ minHeight: 44 }}>
              <input type="checkbox" className="w-5 h-5" disabled={disabled} checked={d.seqRepeat} onChange={e => set({ seqRepeat: e.target.checked })} />
              After the last step, repeat every
            </label>
            <input type="number" min={1} className="input w-20" aria-label="Repeat every" disabled={disabled || !d.seqRepeat} value={d.seqRepeatAmount} onChange={e => set({ seqRepeatAmount: e.target.value })} />
            <select className="input w-32" aria-label="Repeat unit" disabled={disabled || !d.seqRepeat} value={d.seqRepeatUnit} onChange={e => set({ seqRepeatUnit: e.target.value as 'days' | 'months' })}>
              <option value="days">days</option>
              <option value="months">months</option>
            </select>
          </div>
        </div>
      )
  }
}

function optionsOf(col: Column | undefined): string[] {
  if (!col || (col.column_type !== 'dropdown' && col.column_type !== 'status')) return []
  try {
    const opts = (JSON.parse(col.config || '{}') as { options?: Array<string | { label: string }> }).options ?? []
    return opts.map(o => typeof o === 'string' ? o : o.label).filter(Boolean)
  } catch { return [] }
}

/** "Only when…": the rule hides or pauses unless a column says so (W05 §3.7). */
export function ConditionFields({ d, set, columns, disabled }: { d: RuleDraft; set: Set; columns: Column[]; disabled: boolean }): React.ReactElement {
  const usable = columns.filter(c => c.column_type !== 'deadline' && c.column_type !== 'calculated_days' && c.column_type !== 'age_from_dob')
  const condCol = columns.find(c => c.id === d.condColumn)
  const options = optionsOf(condCol)
  // A checkbox is stored as true/1, which nobody would think to type (D-26)
  const isCheckbox = condCol?.column_type === 'checkbox'
  const checkedChoice = d.condOp === 'is_not' ? 'unchecked' : 'checked'
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-base font-medium text-slate-700 dark:text-slate-300 cursor-pointer" style={{ minHeight: 44 }}>
        <input type="checkbox" className="w-5 h-5" disabled={disabled} checked={d.condOn} onChange={e => set({ condOn: e.target.checked })} />
        Only when…
      </label>
      {d.condOn && (
        <div className="space-y-2 pl-7">
          <div className="flex flex-wrap items-center gap-2">
            <ColumnSelect ariaLabel="Only when column" value={d.condColumn} disabled={disabled} columns={usable}
              onChange={v => {
                const col = columns.find(c => c.id === v)
                // Picking a checkbox starts at "is checked"
                set(col?.column_type === 'checkbox' ? { condColumn: col.id, condOp: d.condOp === 'is_not' ? 'is_not' : 'is', condValues: 'true, 1' } : { condColumn: typeof v === 'number' ? v : null })
              }} />
            {isCheckbox ? (
              <select className="input w-44" aria-label="Only when test" disabled={disabled} value={checkedChoice}
                onChange={e => set({ condOp: e.target.value === 'unchecked' ? 'is_not' : 'is', condValues: 'true, 1' })}>
                <option value="checked">is checked</option>
                <option value="unchecked">is not checked</option>
              </select>
            ) : (
            <select className="input w-40" aria-label="Only when test" disabled={disabled} value={d.condOp} onChange={e => set({ condOp: e.target.value as RuleDraft['condOp'] })}>
              <option value="is">is</option>
              <option value="is_not">is not</option>
              <option value="empty">is empty</option>
              <option value="not_empty">is filled in</option>
            </select>
            )}
            {!isCheckbox && (d.condOp === 'is' || d.condOp === 'is_not') && (
              <>
                <input type="text" className="input flex-1 min-w-[8rem]" aria-label="Only when value" list="rule-cond-options" disabled={disabled}
                  value={d.condValues} onChange={e => set({ condValues: e.target.value })} placeholder="e.g. Active" />
                <datalist id="rule-cond-options">{options.map(o => <option key={o} value={o} />)}</datalist>
              </>
            )}
          </div>
          {!isCheckbox && <p className={hint}>Separate more than one value with commas. Capital letters and extra spaces don't matter.</p>}
          <div className="flex flex-wrap gap-4">
            {(['pause', 'hide'] as const).map(w => (
              <label key={w} className="flex items-center gap-2 text-base text-slate-700 dark:text-slate-300 cursor-pointer" style={{ minHeight: 44 }}>
                <input type="radio" name="cond-when-false" className="w-5 h-5" disabled={disabled} checked={d.condWhenFalse === w} onChange={() => set({ condWhenFalse: w })} />
                {w === 'pause' ? 'Otherwise show it as paused' : 'Otherwise hide it'}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** The rule as the editor would save it, for the preview. */
export function previewRule(d: RuleDraft, base: Omit<ParsedAlertRule, 'kind' | 'rule_config' | 'rule_condition' | 'business_days'>, businessDays: boolean | 0 | 1 | 2): ParsedAlertRule | { error: string } {
  const cfg = draftToConfig(d)
  if (!cfg.ok) return { error: cfg.error }
  const cond = draftToCondition(d)
  if (!cond.ok) return { error: cond.error }
  return {
    ...base, kind: d.kind, business_days: businessDays === 2 ? 2 : businessDays ? 1 : 0,
    rule_config: cfg.value ? JSON.stringify(cfg.value) : null,
    rule_condition: cond.value ? JSON.stringify(cond.value) : null,
  }
}

/** One line for the preview: "For Jane Smith: Due Mar 3, 2027 (…)". */
export function previewText(rule: ParsedAlertRule, row: GridRow, columns: Column[], columnId: number | undefined): string {
  const name = getClientName(row, columns)
  const own = columnId !== undefined ? (row[`col_${columnId}`] ?? null) : null
  const res = evaluateRuleForRow(rule, own, row, columnId)
  if (res.state === 'paused') return `For ${name}: ${res.detail || 'paused'}`
  if (res.state === 'done') return `For ${name}: done${res.detail ? ` (${res.detail})` : ''}`
  if (!res.due) return `For ${name}: nothing due${res.detail ? ` (${res.detail})` : ''}`
  return `For ${name}: ${res.detail}${res.label && !res.detail.includes(res.label) ? ` · ${res.label}` : ''}`
}

/** Live preview: pick a record (the first one with data by default) and see what the rule says. */
export function RulePreview({ rule, rows, columns, columnId }: {
  rule: ParsedAlertRule | { error: string }; rows: GridRow[]; columns: Column[]; columnId?: number
}): React.ReactElement {
  const { t } = useVocab(null)
  // Default to the first record the rule has something to say about
  const firstWithData = useMemo(() => {
    if ('error' in rule) return rows[0]?.row_id ?? null
    const own = (r: GridRow) => columnId !== undefined ? (r[`col_${columnId}`] ?? null) : null
    const hit = rows.slice(0, 200).find(r => evaluateRuleForRow(rule, own(r), r, columnId).due !== null)
    return (hit ?? rows[0])?.row_id ?? null
  }, [rows, columnId, rule])
  const [picked, setPicked] = useState<number | null>(null)
  const rowId = picked ?? firstWithData
  const row = rows.find(r => r.row_id === rowId)

  let text: string
  if ('error' in rule) text = rule.error
  else if (!row) text = `Add ${t('record', { article: true })} to see a preview.`
  else text = previewText(rule, row, columns, columnId)

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-600 p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-base font-medium text-slate-700 dark:text-slate-300">Preview</span>
        {rows.length > 0 && (
          <select className="input flex-1 min-w-[10rem]" aria-label={`Preview ${t('record')}`} value={rowId ?? ''} onChange={e => setPicked(Number(e.target.value))}>
            {rows.slice(0, 500).map(r => <option key={r.row_id} value={r.row_id}>{getClientName(r, columns)}</option>)}
          </select>
        )}
      </div>
      <p className={`text-base ${'error' in rule ? 'text-slate-500 dark:text-slate-400' : 'text-blue-800 dark:text-blue-200'}`} aria-live="polite" data-testid="rule-preview">{text}</p>
    </div>
  )
}
