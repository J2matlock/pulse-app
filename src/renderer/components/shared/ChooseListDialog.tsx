/**
 * "Which list?" — for actions on screens that cover every list (the
 * dashboard's reminder letters), so they never act on a hidden "last
 * opened" list without saying so (audit 2.11 / D-35).
 */
import React, { useRef, useState } from 'react'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useVocab } from '../../hooks/useVocab'
import type { Grid } from '../../../shared/types'

export function ChooseListDialog({ title, grids, initialId, confirmLabel, onChoose, onCancel }: {
  title: string
  grids: Grid[]
  initialId: number | null
  confirmLabel: string
  onChoose: (gridId: number) => void
  onCancel: () => void
}): React.ReactElement {
  const { t } = useVocab(null)
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref, true)
  const [id, setId] = useState<number>(initialId && grids.some(g => g.id === initialId) ? initialId : grids[0]!.id)
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4" onKeyDown={e => { if (e.key === 'Escape') onCancel() }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="choose-list-title"
        className="w-full max-w-md rounded-xl bg-white dark:bg-slate-800 shadow-xl border border-slate-200 dark:border-slate-700 p-6 space-y-4">
        <h2 id="choose-list-title" className="text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
        <div>
          <label htmlFor="choose-list" className="block text-base font-medium text-slate-700 dark:text-slate-200 mb-1">Which {t('list')}?</label>
          <select id="choose-list" className="input w-full" value={id} onChange={e => setId(Number(e.target.value))}>
            {grids.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn-primary" onClick={() => onChoose(id)}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
