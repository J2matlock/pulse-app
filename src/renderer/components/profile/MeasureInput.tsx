import React from 'react'
import { measureStep, type MeasureDef } from '../../../shared/measures'

/** A labelled number box for one of your own numbers: "$" before money, "h" or the unit after. */
export function MeasureInput({ def, value, onChange }: { def: MeasureDef; value: string; onChange: (v: string) => void }): React.ReactElement {
  const suffix = def.kind === 'hours' ? 'h' : def.kind === 'number' ? def.unit : undefined
  return (
    <label className="flex items-center gap-2 text-base text-slate-700 dark:text-slate-200">
      {def.label}
      <span className="flex items-center gap-1">
        {def.kind === 'currency' && <span aria-hidden="true">$</span>}
        <input type="number" aria-label={def.label} min={0} max={def.kind === 'hours' ? 24 : undefined} step={measureStep(def)}
          className="input w-24" value={value} onChange={e => onChange(e.target.value)} />
        {suffix && <span className="text-slate-600 dark:text-slate-300" aria-hidden="true">{suffix}</span>}
      </span>
    </label>
  )
}
