import React, { useState } from 'react'

export type DateAnswer = { repeat: 'no' } | { repeat: 'due' } | { repeat: 'every'; n: number; unit: 'days' | 'months' | 'years' }

/**
 * The likely answer from a column's name, so most people can just click on:
 * "Due date", "Expires" → it's the due date; "Last contact", "Next visit" →
 * due again every month; "Last service", "Annual review" → every year; a
 * birthday or anything else → no reminder. A contact column guessed as yearly
 * showed no colour for eleven months (UX-A-08), so contacts come first.
 */
export function suggestRepeat(name: string): DateAnswer {
  const n = name.toLowerCase()
  if (/birth|\bdob\b|born/.test(n)) return { repeat: 'no' }
  if (/\bdue\b|expir|deadline|\bends?\b|renew/.test(n)) return { repeat: 'due' }
  if (/contact|visit|\bcall|check[- ]?in|touch/.test(n)) return { repeat: 'every', n: 1, unit: 'months' }
  if (/annual|yearly|review|assess|\blast\b|service|inspect/.test(n)) return { repeat: 'every', n: 1, unit: 'years' }
  return { repeat: 'no' }
}

/**
 * How many days before it's due the cell turns yellow. Mirrors the standard rules
 * setup makes (src/main/builtin-templates.ts): short cycles up to a month warn a
 * week ahead, 90 days two weeks ahead, half a year or more a month ahead.
 */
export function yellowDaysBefore(answer: DateAnswer): number {
  if (answer.repeat === 'no') return 0
  if (answer.repeat === 'due') return 14
  const months = answer.unit === 'years' ? answer.n * 12 : answer.unit === 'months' ? answer.n : null
  if (months === 6 || months === 12) return 30
  if (months === null && (answer.n === 30 || answer.n === 60)) return 7
  if (months === null && answer.n === 90) return 14
  const days = months !== null ? months * 30 : answer.n
  return days <= 31 ? 7 : days <= 120 ? 14 : 30
}

/** A colored chip like the ones the list shows, so the choice has a visible result */
function SampleChip({ answer }: { answer: DateAnswer }): React.ReactElement | null {
  if (answer.repeat === 'no') return null
  const yellow = yellowDaysBefore(answer)
  const next = answer.repeat === 'due' ? 'the date' : `it's next due (${answer.n} ${answer.n === 1 ? answer.unit.slice(0, -1) : answer.unit} after this date)`
  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-base text-slate-600 dark:text-slate-300">
      <span className="px-2 py-0.5 rounded-md font-medium bg-yellow-300 text-slate-900" aria-hidden="true">Due soon</span>
      Turns yellow {yellow} days before {next}, then red on the day.
    </span>
  )
}

/**
 * The "every N" box. What's typed is kept as typed while the box has focus, so
 * it can be cleared and retyped (6, not 16); only a whole number from 1 to 999
 * is passed on, and leaving the box puts back the last good one.
 */
function EveryBox({ id, n, onChange }: { id: string; n: number; onChange: (n: number) => void }): React.ReactElement {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <input id={id} type="number" min={1} max={999} className="input w-24" value={draft ?? String(n)}
      onChange={e => {
        const raw = e.target.value
        setDraft(raw)
        const v = Number(raw)
        if (raw.trim() !== '' && Number.isInteger(v) && v >= 1 && v <= 999) onChange(v)
      }}
      onBlur={() => {
        const v = Number(draft)
        if (draft !== null && draft.trim() !== '' && Number.isFinite(v) && v > 999) onChange(999)
        setDraft(null)
      }} />
  )
}

/**
 * "Which of these dates repeat?" for setup: per date column, no reminder,
 * due again every N days/months/years after the date entered, or "this is
 * when it's due".
 */
export function DateRepeatPicker({ columns, value, onChange }: {
  columns: Array<{ id: number; name: string }>
  value: Record<number, DateAnswer>
  onChange: (next: Record<number, DateAnswer>) => void
}): React.ReactElement {
  return (
    <ul className="space-y-4">
      {columns.map(c => {
        const a = value[c.id] ?? { repeat: 'no' }
        const set = (next: DateAnswer) => onChange({ ...value, [c.id]: next })
        return (
          <li key={c.id} className="space-y-2">
            <label htmlFor={`setup-date-${c.id}`} className="block text-base font-semibold text-slate-800 dark:text-slate-100">{c.name}</label>
            <div className="flex flex-wrap items-center gap-2">
              <select id={`setup-date-${c.id}`} className="input w-auto" value={a.repeat}
                onChange={e => set(e.target.value === 'every' ? { repeat: 'every', n: 1, unit: 'years' } : { repeat: e.target.value as 'no' | 'due' })}>
                <option value="no">No reminder</option>
                <option value="due">Is a due date</option>
                <option value="every">Repeats every…</option>
              </select>
              {a.repeat === 'every' && (
                <>
                  <label className="sr-only" htmlFor={`setup-n-${c.id}`}>How many</label>
                  <EveryBox id={`setup-n-${c.id}`} n={a.n} onChange={n => set({ ...a, n })} />
                  <label className="sr-only" htmlFor={`setup-unit-${c.id}`}>Unit</label>
                  <select id={`setup-unit-${c.id}`} className="input w-auto" value={a.unit} onChange={e => set({ ...a, unit: e.target.value as 'days' | 'months' | 'years' })}>
                    <option value="days">days</option>
                    <option value="months">months</option>
                    <option value="years">years</option>
                  </select>
                </>
              )}
            </div>
            <SampleChip answer={a} />
          </li>
        )
      })}
    </ul>
  )
}
