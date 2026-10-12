import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarCheck, ChevronDown, ChevronRight, Settings2 } from 'lucide-react'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'
import { pulseEvents } from '../../events'
import { contactsComplete, contactsMissing } from '../../../shared/contactRequirements'
import { ContactRequirementsDialog } from '../../components/contact-req/ContactRequirementsDialog'
import type { ContactStatusGrid } from '../../../shared/types'
import { PERIODS, daysLeft, periodRange, type PeriodRange } from '../../../shared/periods'
import { useVocab, useVocabByList } from '../../hooks/useVocab'

/** What to call a period in "3 days left in …": the week, October, Q4, 2026 */
function periodName(r: PeriodRange): string {
  if (r.period === 'week') return 'the week'
  if (r.period === 'month') return r.label.split(' ')[0]!
  if (r.period === 'quarter') return r.label.split(' ')[0]!
  return r.label
}

/** Dashboard card: who still needs their required contacts this week, month, quarter or year. Hidden until set up. */
export function MonthlyContactsCard(): React.ReactElement | null {
  const navigate = useNavigate()
  const { t } = useVocab(null)
  const tFor = useVocabByList()
  const [status, setStatus] = useState<ContactStatusGrid[]>([])
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [editing, setEditing] = useState<{ gridId: number; gridName: string } | null>(null)

  const load = useCallback(async () => {
    const res = await safeInvoke<ContactStatusGrid[]>(IPC.CONTACT_REQ_STATUS)
    if (res.ok) setStatus(res.data)
  }, [])

  useEffect(() => {
    void load()
    const offReq = pulseEvents.on('contact-req:changed', () => { void load() })
    const offLog = window.api.on(IPC.CASE_LOG_CHANGED, () => { void load() })
    // A new day can start a new week, month or quarter (Q-031)
    const offDay = pulseEvents.on('day:changed', () => { void load() })
    return () => { offReq(); offLog(); offDay() }
  }, [load])

  if (status.length === 0) return null

  // One entry per kind of period in use, in calendar order (week before month…)
  const ranges = PERIODS.flatMap(p => {
    const r = status.flatMap(g => g.ranges ?? []).find(x => x.period === p)
    return r ? [r] : []
  })
  if (ranges.length === 0) ranges.push(periodRange('month', new Date()))
  const title = `${t('requirement', { many: true, cap: true })} ${ranges.map(r => `this ${r.period}`).join(' and ')}`
  const timeLeft = ranges.map(r => {
    const n = daysLeft(r)
    const name = periodName(r)
    return n === 0 ? `Last day of ${name}` : `${n} day${n === 1 ? '' : 's'} left in ${name}`
  }).join(' · ')
  // "done for October" when there's one period; otherwise just "done"
  const doneFor = ranges.length === 1 ? ` for ${periodName(ranges[0]!)}` : ''

  return (
    <section aria-labelledby="monthly-contacts-title" className="mb-6 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-700">
        <CalendarCheck className="w-5 h-5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
        <h2 id="monthly-contacts-title" className="text-lg font-semibold text-slate-800 dark:text-slate-100 flex-1">{title}</h2>
        <span className="text-base text-slate-600 dark:text-slate-300">
          {timeLeft}
        </span>
      </div>
      <ul className="divide-y divide-slate-200 dark:divide-slate-700">
        {status.map(g => {
          const behind = g.clients.filter(c => !contactsComplete(c.counts, g.requirements))
          const tg = tFor(g.gridId)
          const open = expanded.has(g.gridId)
          return (
            <li key={g.gridId} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <button type="button" aria-expanded={open} disabled={behind.length === 0}
                  onClick={() => setExpanded(s => { const n = new Set(s); if (n.has(g.gridId)) n.delete(g.gridId); else n.add(g.gridId); return n })}
                  className="hit-44 flex items-center gap-1 text-base font-medium text-slate-800 dark:text-slate-100 disabled:cursor-default">
                  {behind.length > 0 && (open ? <ChevronDown className="w-4 h-4" aria-hidden="true" /> : <ChevronRight className="w-4 h-4" aria-hidden="true" />)}
                  {g.gridName}
                </button>
                <span className={`text-base ${behind.length === 0 ? 'text-green-700 dark:text-green-300 font-medium' : 'text-slate-700 dark:text-slate-200'}`}>
                  {g.clients.length === 0 ? `No ${tg('record', { many: true })} yet`
                    : behind.length === 0 ? `All ${g.clients.length} ${tg('record', { count: g.clients.length })} are done${doneFor}`
                    : `${g.clients.length - behind.length} of ${g.clients.length} done · ${behind.length} still behind`}
                </span>
                <button type="button" className="hit-44 ml-auto flex items-center gap-1 text-sm text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400"
                  onClick={() => setEditing({ gridId: g.gridId, gridName: g.gridName })}>
                  <Settings2 className="w-4 h-4" aria-hidden="true" />Change
                </button>
              </div>
              {open && behind.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {behind.map(c => (
                    <li key={c.rowId}>
                      <button type="button" onClick={() => navigate(`/profile/${c.rowId}?gridId=${g.gridId}`)}
                        className="hit-44 w-full flex flex-wrap items-baseline gap-x-3 px-2 py-1.5 rounded-sm text-left hover:bg-slate-50 dark:hover:bg-slate-700/50">
                        <span className="text-base font-medium text-slate-800 dark:text-slate-100">{c.clientName}</span>
                        <span className="text-sm text-slate-600 dark:text-slate-300">needs {contactsMissing(c.counts, g.requirements).join(', ')}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
      {editing && <ContactRequirementsDialog gridId={editing.gridId} gridName={editing.gridName} onClose={() => setEditing(null)} />}
    </section>
  )
}
