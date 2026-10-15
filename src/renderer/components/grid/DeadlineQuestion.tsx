import React from 'react'
import type { DeadlineChoice } from '../alerts/plainRule'

/**
 * Add Column, for a Date or Deadline column: "Does this date come due
 * again?" (D-15, G-20). A Deadline column has no date of its own to be the
 * due date, so it offers only a repeat or the full rule editor. The answers
 * say what each does (B-31); "More options…" is a link under them, not an answer.
 * The import results ask it once per new date column (UX-B-06), so each one
 * names its column and has its own radio group, and there's no rule editor to open.
 */
export function DeadlineQuestion({ type, value, onChange, name = 'new-col-deadline', legend, allowMore = true }: {
  type: 'date' | 'deadline'
  value: DeadlineChoice
  onChange: (c: DeadlineChoice) => void
  /** The radio group's name: unique when several questions show at once */
  name?: string
  /** In place of "Does this date come due again?" */
  legend?: string
  /** Offer "More options…" (the full rule editor opens after adding) */
  allowMore?: boolean
}): React.ReactElement {
  const every = value.mode === 'every' ? value : { mode: 'every' as const, n: 12, unit: 'months' as const }
  const radio = (mode: DeadlineChoice['mode'], label: React.ReactNode, next: DeadlineChoice) => (
    <label className="flex items-center gap-2 text-base text-slate-700 dark:text-slate-300 cursor-pointer" style={{ minHeight: 44 }}>
      <input type="radio" name={name} className="w-5 h-5" checked={value.mode === mode} onChange={() => onChange(next)} />
      {label}
    </label>
  )
  return (
    <fieldset className="space-y-0.5">
      <legend className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">
        {legend ?? (type === 'date' ? 'Does this date come due again?' : 'How is it worked out?')}
      </legend>
      {type === 'date' && radio('none', 'No, it\'s just a date', { mode: 'none' })}
      <div className="flex flex-wrap items-center gap-2">
        {radio('every', type === 'date' ? 'Yes, every' : 'Every', every)}
        <input type="number" min={1} max={120} className="input w-20" aria-label="How often" style={{ minHeight: 36 }}
          value={every.n} onChange={e => onChange({ mode: 'every', n: Math.max(1, Math.min(120, parseInt(e.target.value, 10) || 1)), unit: every.unit })} />
        <select className="input w-28" aria-label="Months or years" style={{ minHeight: 36 }} value={every.unit}
          onChange={e => onChange({ mode: 'every', n: every.n, unit: e.target.value as 'months' | 'years' })}>
          <option value="months">months</option>
          <option value="years">years</option>
        </select>
        {type === 'deadline' && <span className="text-base text-slate-600 dark:text-slate-300">after it's done</span>}
      </div>
      {type === 'date' && radio('due', 'It\'s a one-off due date (color it as it gets close)', { mode: 'due' })}
      {!allowMore ? null : value.mode === 'more' ? (
        <p className="flex flex-wrap items-center gap-x-2 text-base text-slate-700 dark:text-slate-300" style={{ minHeight: 44 }}>
          <span>The full rule editor opens after adding.</span>
          <button type="button" className="hit-44 text-blue-700 dark:text-blue-300 underline rounded-sm"
            onClick={() => onChange(type === 'date' ? { mode: 'none' } : every)}>
            Never mind
          </button>
        </p>
      ) : (
        <button type="button" className="hit-44 text-base text-blue-700 dark:text-blue-300 underline rounded-sm text-left"
          style={{ minHeight: 44 }}
          onClick={() => onChange({ mode: 'more' })}>
          More options… (set it up in detail after adding)
        </button>
      )}
    </fieldset>
  )
}
