import React from 'react'

export type DateAnswer = { repeat: 'no' } | { repeat: 'due' } | { repeat: 'every'; n: number; unit: 'days' | 'months' | 'years' }

/**
 * "Which of these dates repeat?" for setup: per date column, no reminder,
 * due again every N days/months/years after the date entered, or "it's the
 * due date".
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
                <option value="every">Repeats: due again every…</option>
                <option value="due">It's the due date</option>
              </select>
              {a.repeat === 'every' && (
                <>
                  <label className="sr-only" htmlFor={`setup-n-${c.id}`}>How many</label>
                  <input id={`setup-n-${c.id}`} type="number" min={1} max={999} className="input w-24" value={a.n}
                    onChange={e => set({ ...a, n: Math.max(1, Math.min(999, Number(e.target.value) || 1)) })} />
                  <label className="sr-only" htmlFor={`setup-unit-${c.id}`}>Unit</label>
                  <select id={`setup-unit-${c.id}`} className="input w-auto" value={a.unit} onChange={e => set({ ...a, unit: e.target.value as 'days' | 'months' | 'years' })}>
                    <option value="days">days</option>
                    <option value="months">months</option>
                    <option value="years">years</option>
                  </select>
                  <span className="text-base text-slate-600 dark:text-slate-300">after the date entered</span>
                </>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
