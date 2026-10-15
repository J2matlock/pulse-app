import React, { useCallback, useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'
import { pulseEvents } from '../../events'
import { useGridStore } from '../../stores/gridStore'
import { ContactRequirementsDialog } from './ContactRequirementsDialog'
import type { ContactRequirement } from '../../../shared/types'
import { requirementPhrase } from '../../../shared/contactRequirements'
import { useVocab } from '../../hooks/useVocab'

/** Settings → Deadlines: set up monthly contact requirements per caseload. */
export function ContactRequirementsSettings(): React.ReactElement {
  const { t } = useVocab(null)
  const grids = useGridStore(useShallow(s => s.grids))
  const [reqs, setReqs] = useState<ContactRequirement[]>([])
  const [editing, setEditing] = useState<{ gridId: number; gridName: string } | null>(null)
  const close = useCallback(() => setEditing(null), [])

  const load = useCallback(async () => {
    const res = await safeInvoke<ContactRequirement[]>(IPC.CONTACT_REQ_GET)
    if (res.ok) setReqs(res.data)
  }, [])
  useEffect(() => { void load(); return pulseEvents.on('contact-req:changed', () => { void load() }) }, [load])

  return (
    <div className="pb-4 border-b border-slate-200 dark:border-slate-700 space-y-2">
      <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100">{t('requirement', { many: true, cap: true })}</h2>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        How many {t('activity', { many: true })} each {t('record')} needs in a period (a week, month, quarter or year), counted from the {t('activity', { many: true })} you log. The Dashboard shows who is behind.
      </p>
      <ul className="space-y-1">
        {grids.map(g => {
          const mine = reqs.filter(r => r.grid_id === g.id)
          return (
            <li key={g.id} className="flex flex-wrap items-center gap-x-3 min-h-[44px]">
              <span className="text-base font-medium text-slate-800 dark:text-slate-100">{g.name}</span>
              <span className="text-base text-slate-600 dark:text-slate-300 flex-1">
                {mine.length === 0 ? 'Not set up' : mine.map(requirementPhrase).join(', ')}
              </span>
              <button type="button" className="btn-compact-secondary" onClick={() => setEditing({ gridId: g.id, gridName: g.name })}>
                {mine.length === 0 ? 'Set up…' : 'Change…'}
              </button>
            </li>
          )
        })}
      </ul>
      {editing && <ContactRequirementsDialog gridId={editing.gridId} gridName={editing.gridName} onClose={close} />}
    </div>
  )
}
