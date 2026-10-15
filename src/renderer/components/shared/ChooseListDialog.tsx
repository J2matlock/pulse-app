/**
 * "Which list?" — for actions on screens that cover every list (the
 * dashboard's reminder letters), so they never act on a hidden "last
 * opened" list without saying so (audit 2.11 / D-35).
 */
import React, { useState } from 'react'
import { Dialog } from '../ui/Dialog'
import { PrimaryButton, SecondaryButton } from '../ui/Button'
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
  const [id, setId] = useState<number>(initialId && grids.some(g => g.id === initialId) ? initialId : grids[0]!.id)
  return (
    <Dialog open onClose={onCancel} title={title} size="md"
      footer={<>
        <SecondaryButton onClick={onCancel}>Cancel</SecondaryButton>
        <PrimaryButton onClick={() => onChoose(id)}>{confirmLabel}</PrimaryButton>
      </>}>
      <label htmlFor="choose-list" className="block text-base font-medium text-slate-700 dark:text-slate-200 mb-1">Which {t('list')}?</label>
      <select id="choose-list" className="input w-full" value={id} onChange={e => setId(Number(e.target.value))}>
        {grids.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select>
    </Dialog>
  )
}
