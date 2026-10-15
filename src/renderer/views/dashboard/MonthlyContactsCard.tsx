import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarCheck, ChevronDown, ChevronRight, Settings2 } from 'lucide-react'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'
import { pulseEvents } from '../../events'
import { contactsMissing } from '../../../shared/contactRequirements'
import { ContactRequirementsDialog } from '../../components/contact-req/ContactRequirementsDialog'
import type { ContactStatusClient, ContactStatusGrid } from '../../../shared/types'
import { PERIODS, daysLeft, periodRange, type PeriodRange } from '../../../shared/periods'
import { unhandledCase } from '../../../shared/assertNever'
import { useVocab, useVocabByList } from '../../hooks/useVocab'

/** Under this many days left in a requirement's period, someone who still needs it is "behind" (R6) */
const BEHIND_DAYS = 7

/** What to call a period in "3 days left in …": the week, October, Q4, 2026 */
function periodName(r: PeriodRange): string {
  switch (r.period) {
    case 'week': return 'the week'
    case 'month': return r.label.split(' ')[0]!
    case 'quarter': return r.label.split(' ')[0]!
    case 'year': return r.label
    default:
      unhandledCase(r.period)
      return r.label
  }
}

/** How many days the period has, first and last included */
function periodDays(r: PeriodRange): number {
  const day = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y!, m! - 1, d!).getTime() }
  return Math.max(1, Math.round((day(r.end) - day(r.start)) / 86_400_000) + 1)
}

/** One entry per kind of period in use, in calendar order (week before month…) */
function rangesInUse(status: ContactStatusGrid[]): PeriodRange[] {
  const ranges = PERIODS.flatMap(p => {
    const r = status.flatMap(g => g.ranges ?? []).find(x => x.period === p)
    return r ? [r] : []
  })
  if (ranges.length === 0) ranges.push(periodRange('month', new Date()))
  return ranges
}

/** "this month", "this week and this month" */
const periodsPhrase = (ranges: PeriodRange[]): string => ranges.map(r => `this ${r.period}`).join(' and ')

/** The fewest days left in the period of anything this person still needs; null when they're done */
function daysLeftFor(c: ContactStatusClient, g: ContactStatusGrid): number | null {
  let least: number | null = null
  g.requirements.forEach((r, i) => {
    if ((c.counts[i] ?? 0) >= r.per_month) return
    const n = daysLeft(g.ranges?.[i] ?? periodRange(r.period ?? 'month', new Date()))
    if (least === null || n < least) least = n
  })
  return least
}

/** Who still needs contacts: the ones with the least time left first, then the rest as they came (R6) */
function behindFirst(g: ContactStatusGrid): Array<{ client: ContactStatusClient; left: number }> {
  return g.clients.flatMap(client => {
    const left = daysLeftFor(client, g)
    return left === null ? [] : [{ client, left }]
  }).sort((a, b) => a.left - b.left)
}

// ── Shared between the card and the line under the tiles ──────────────────────

// Both load the same status when the dashboard opens: one request between them
let inflight: Promise<ContactStatusGrid[] | null> | null = null
function fetchStatus(): Promise<ContactStatusGrid[] | null> {
  inflight ??= safeInvoke<ContactStatusGrid[]>(IPC.CONTACT_REQ_STATUS)
    .then(r => (r.ok ? r.data : null))
    .finally(() => { inflight = null })
  return inflight
}

function useContactStatus(): ContactStatusGrid[] {
  const [status, setStatus] = useState<ContactStatusGrid[]>([])
  const load = useCallback(async () => {
    const data = await fetchStatus()
    if (data) setStatus(data)
  }, [])
  useEffect(() => {
    void load()
    const offReq = pulseEvents.on('contact-req:changed', () => { void load() })
    const offLog = window.api.on(IPC.CASE_LOG_CHANGED, () => { void load() })
    // A new day can start a new week, month or quarter (Q-031)
    const offDay = pulseEvents.on('day:changed', () => { void load() })
    return () => { offReq(); offLog(); offDay() }
  }, [load])
  return status
}

// "Show who" on the line opens the card on the people who are behind; the card may be hidden
const showBehindListeners = new Set<() => void>()
let cardsShown = 0
const cardsShownListeners = new Set<() => void>()
function setCardShown(by: 1 | -1) {
  cardsShown += by
  cardsShownListeners.forEach(l => l())
}
function useCardShown(): boolean {
  return useSyncExternalStore(
    cb => { cardsShownListeners.add(cb); return () => { cardsShownListeners.delete(cb) } },
    () => cardsShown > 0,
  )
}

/**
 * One line under the dashboard tiles (persona study R6): how the requirements
 * stand, without scrolling past What's due to the card.
 */
export function RequirementsLine(): React.ReactElement | null {
  const { t } = useVocab(null)
  const status = useContactStatus()
  const cardShown = useCardShown()
  if (status.length === 0) return null

  let total = 0, met = 0, behind = 0
  for (const g of status) {
    for (const c of g.clients) {
      total++
      const left = daysLeftFor(c, g)
      if (left === null) met++
      else if (left < BEHIND_DAYS) behind++
    }
  }
  if (total === 0) return null
  const notDone = total - met
  return (
    <p className="mb-6 -mt-3 flex flex-wrap items-center gap-x-2 text-base text-slate-700 dark:text-slate-200" data-testid="requirements-line">
      <span className="font-semibold">{t('requirement', { many: true, cap: true })} {periodsPhrase(rangesInUse(status))}:</span>
      <span>{met} of {total} {t('record', { count: total })} done</span>
      {notDone > 0 && <span aria-hidden="true">·</span>}
      {notDone > 0 && (behind > 0
        ? <span className="text-red-700 dark:text-red-300">{behind} behind with under {BEHIND_DAYS} days left</span>
        : <span>{notDone} still to do</span>)}
      {notDone > 0 && cardShown && <span aria-hidden="true">·</span>}
      {notDone > 0 && cardShown && (
        <button type="button" onClick={() => showBehindListeners.forEach(l => l())}
          className="hit-44 text-base text-blue-700 dark:text-blue-300 underline hover:no-underline rounded-lg focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
          Show who
        </button>
      )}
    </p>
  )
}

/** Dashboard card: who still needs their required contacts this week, month, quarter or year. Hidden until set up. */
export function MonthlyContactsCard(): React.ReactElement | null {
  const navigate = useNavigate()
  const { t } = useVocab(null)
  const tFor = useVocabByList()
  const status = useContactStatus()
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  // After "Show who": only the people under a week from the end of a period, until "Show everyone"
  const [behindOnly, setBehindOnly] = useState(false)
  const [editing, setEditing] = useState<{ gridId: number; gridName: string } | null>(null)
  const sectionRef = useRef<HTMLElement>(null)
  const statusRef = useRef(status)
  useEffect(() => { statusRef.current = status }, [status])

  const visible = status.length > 0
  useEffect(() => {
    if (!visible) return
    setCardShown(1)
    return () => setCardShown(-1)
  }, [visible])

  useEffect(() => {
    const open = () => {
      const st = statusRef.current
      const lists = st.map(g => ({ g, rows: behindFirst(g) }))
      const anyBehind = lists.some(l => l.rows.some(r => r.left < BEHIND_DAYS))
      setBehindOnly(anyBehind)
      setExpanded(new Set(lists.filter(l => (anyBehind ? l.rows.some(r => r.left < BEHIND_DAYS) : l.rows.length > 0)).map(l => l.g.gridId)))
      const el = sectionRef.current
      if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'start', behavior: 'smooth' })
      el?.focus({ preventScroll: true })
    }
    showBehindListeners.add(open)
    return () => { showBehindListeners.delete(open) }
  }, [])

  if (!visible) return null

  const ranges = rangesInUse(status)
  const title = `${t('requirement', { many: true, cap: true })} ${periodsPhrase(ranges)}`
  const timeLeft = ranges.map(r => {
    const n = daysLeft(r)
    const name = periodName(r)
    return n === 0 ? `Last day of ${name}` : `${n} day${n === 1 ? '' : 's'} left in ${name}`
  }).join(' · ')
  // "done for October" when there's one period; otherwise just "done"
  const doneFor = ranges.length === 1 ? ` for ${periodName(ranges[0]!)}` : ''
  // Halfway through the month nobody is "behind" yet: until the last third it's "still to do" (UX D-27)
  const early = ranges.every(r => daysLeft(r) / periodDays(r) > 1 / 3)
  const notYet = early ? `still to do${ranges.length === 1 ? ` this ${ranges[0]!.period}` : ''}` : 'still behind'

  return (
    <section ref={sectionRef} tabIndex={-1} aria-labelledby="monthly-contacts-title"
      className="mb-6 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 scroll-mt-4 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-700">
        <CalendarCheck className="w-5 h-5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
        <h2 id="monthly-contacts-title" className="text-lg font-semibold text-slate-800 dark:text-slate-100 flex-1">{title}</h2>
        <span className="text-base text-slate-600 dark:text-slate-300">
          {timeLeft}
        </span>
      </div>
      <ul className="divide-y divide-slate-200 dark:divide-slate-700">
        {status.map(g => {
          const behind = behindFirst(g)
          const urgent = behind.filter(b => b.left < BEHIND_DAYS)
          const shown = behindOnly && urgent.length > 0 ? urgent : behind
          const tg = tFor(g.gridId)
          const open = expanded.has(g.gridId)
          return (
            <li key={g.gridId} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                {/* The whole line opens the list of who, and says so (UX D-27) */}
                <button type="button" aria-expanded={open} disabled={behind.length === 0}
                  onClick={() => setExpanded(s => { const n = new Set(s); if (n.has(g.gridId)) n.delete(g.gridId); else n.add(g.gridId); return n })}
                  className="hit-44 flex-1 min-w-0 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-sm px-1 -mx-1 text-left enabled:hover:bg-slate-50 dark:enabled:hover:bg-slate-700/50 disabled:cursor-default focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
                  <span className="flex items-center gap-1 text-base font-medium text-slate-800 dark:text-slate-100">
                    {behind.length > 0 && (open ? <ChevronDown className="w-4 h-4" aria-hidden="true" /> : <ChevronRight className="w-4 h-4" aria-hidden="true" />)}
                    {g.gridName}
                  </span>
                  <span className={`text-base ${behind.length === 0 ? 'text-green-700 dark:text-green-300 font-medium' : 'text-slate-700 dark:text-slate-200'}`}>
                    {g.clients.length === 0 ? `No ${tg('record', { many: true })} yet`
                      : behind.length === 0 ? `All ${g.clients.length} ${tg('record', { count: g.clients.length })} are done${doneFor}`
                      : `${g.clients.length - behind.length} of ${g.clients.length} done · ${behind.length} ${notYet}`}
                  </span>
                  {behind.length > 0 && <span className="text-base text-blue-700 dark:text-blue-300">{open ? 'Hide' : 'Show who'}</span>}
                </button>
                <button type="button" className="hit-44 ml-auto flex items-center gap-1 text-sm text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400"
                  onClick={() => setEditing({ gridId: g.gridId, gridName: g.gridName })}>
                  <Settings2 className="w-4 h-4" aria-hidden="true" />Change
                </button>
              </div>
              {open && shown.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {shown.map(({ client: c, left }) => (
                    <li key={c.rowId}>
                      <button type="button" onClick={() => navigate(`/profile/${c.rowId}?gridId=${g.gridId}`)}
                        className="hit-44 w-full flex flex-wrap items-baseline gap-x-3 px-2 py-1.5 rounded-sm text-left hover:bg-slate-50 dark:hover:bg-slate-700/50">
                        <span className="text-base font-medium text-slate-800 dark:text-slate-100">{c.clientName}</span>
                        <span className="text-sm text-slate-600 dark:text-slate-300">needs {contactsMissing(c.counts, g.requirements).join(', ')}</span>
                        {left < BEHIND_DAYS && <span className="text-sm text-red-700 dark:text-red-300">{left === 0 ? 'last day' : `${left} day${left === 1 ? '' : 's'} left`}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {open && shown.length < behind.length && (
                <button type="button" onClick={() => setBehindOnly(false)}
                  className="hit-44 mt-2 text-base text-blue-700 dark:text-blue-300 underline hover:no-underline rounded-lg focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
                  Show everyone not done ({behind.length})
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {editing && <ContactRequirementsDialog gridId={editing.gridId} gridName={editing.gridName} onClose={() => setEditing(null)} />}
    </section>
  )
}
