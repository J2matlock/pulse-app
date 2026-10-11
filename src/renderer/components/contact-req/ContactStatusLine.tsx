import React, { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, CircleDashed } from 'lucide-react'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'
import { pulseEvents } from '../../events'
import type { ContactStatusGrid } from '../../../shared/types'
import { useVocab } from '../../hooks/useVocab'
import { useFeature } from '../../hooks/useFeature'
import type { Appointment } from '../../../shared/appointments'
import { daysLeft } from '../../../shared/periods'
import { localDateString } from '../../../shared/dates'
import { ymdToDate } from '../../../shared/deadlineEngine'

const formatShort = (ymd: string) => ymdToDate(ymd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

/** Profile: one record's requirements in their current periods, e.g. "Visit 1 of 1 this month ✓ · Check-ins 0 of 2 this week". */
export function ContactStatusLine({ rowId, gridId }: { rowId: number; gridId: number }): React.ReactElement | null {
  const { t } = useVocab(gridId)
  const [grid, setGrid] = useState<ContactStatusGrid | null>(null)
  // What's already booked toward each requirement (S-27)
  const [booked, setBooked] = useState<Appointment[]>([])
  const apptsOn = useFeature('appointments')

  const load = useCallback(async () => {
    const res = await safeInvoke<ContactStatusGrid[]>(IPC.CONTACT_REQ_STATUS, undefined, gridId)
    const g = res.ok ? res.data[0] ?? null : null
    setGrid(g)
    const lastEnd = g?.ranges.reduce((m, r) => r.end > m ? r.end : m, '') ?? ''
    if (apptsOn && lastEnd) {
      const today = localDateString()
      const a = await safeInvoke<Appointment[]>(IPC.APPT_LIST, { from: today, to: lastEnd }, { rowId, status: ['scheduled'] })
      setBooked(a.ok && Array.isArray(a.data) ? a.data : [])
    } else setBooked([])
  }, [gridId, rowId, apptsOn])

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
        const range = grid.ranges[i]
        const planned = range ? booked.filter(a => a.start_at.slice(0, 10) <= range.end && !!a.activity_type_key && r.note_types.includes(a.activity_type_key)) : []
        const left = range ? daysLeft(range) : null
        const extra = done ? '' : [
          planned.length ? `${planned.length} scheduled ${formatShort(planned[0]!.start_at.slice(0, 10))}${planned.length > 1 ? '…' : ''}` : '',
          left !== null ? `${left} day${left === 1 ? '' : 's'} left` : '',
        ].filter(Boolean).join(' · ')
        return (
          <span key={r.id ?? i} className={`flex items-center gap-1 text-base ${done ? 'text-green-700 dark:text-green-300' : 'text-slate-700 dark:text-slate-200'}`}>
            {done ? <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> : <CircleDashed className="w-4 h-4" aria-hidden="true" />}
            {r.label} {n} of {r.per_month} this {r.period ?? 'month'}{extra ? ` · ${extra}` : ''}
            <span className="sr-only">{done ? '(done)' : '(still needed)'}</span>
          </span>
        )
      })}
    </div>
  )
}
