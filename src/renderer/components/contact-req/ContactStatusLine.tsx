import React, { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, CircleDashed } from 'lucide-react'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'
import { pulseEvents } from '../../events'
import type { ContactStatusGrid } from '../../../shared/types'
import { useVocab } from '../../hooks/useVocab'

/** Profile: one record's requirements in their current periods, e.g. "Visit 1 of 1 this month ✓ · Check-ins 0 of 2 this week". */
export function ContactStatusLine({ rowId, gridId }: { rowId: number; gridId: number }): React.ReactElement | null {
  const { t } = useVocab(gridId)
  const [grid, setGrid] = useState<ContactStatusGrid | null>(null)

  const load = useCallback(async () => {
    const res = await safeInvoke<ContactStatusGrid[]>(IPC.CONTACT_REQ_STATUS, undefined, gridId)
    setGrid(res.ok ? res.data[0] ?? null : null)
  }, [gridId])

  useEffect(() => {
    void load()
    const offReq = pulseEvents.on('contact-req:changed', () => { void load() })
    const offLog = window.api.on(IPC.CASE_LOG_CHANGED, (changed: unknown) => { if (changed === rowId) void load() })
    return () => { offReq(); offLog() }
  }, [load, rowId])

  const client = grid?.clients.find(c => c.rowId === rowId)
  if (!grid || !client) return null

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
      <span className="text-base font-medium text-slate-700 dark:text-slate-200">{t('requirement', { many: true, cap: true })}:</span>
      {grid.requirements.map((r, i) => {
        const n = client.counts[i] ?? 0
        const done = n >= r.per_month
        return (
          <span key={r.id ?? i} className={`flex items-center gap-1 text-base ${done ? 'text-green-700 dark:text-green-300' : 'text-slate-700 dark:text-slate-200'}`}>
            {done ? <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> : <CircleDashed className="w-4 h-4" aria-hidden="true" />}
            {r.label} {n} of {r.per_month} this {r.period ?? 'month'}
            <span className="sr-only">{done ? '(done)' : '(still needed)'}</span>
          </span>
        )
      })}
    </div>
  )
}
