/**
 * The dashboard's card area (W10 §4): cards in the order people chose,
 * with a "Customize" panel to show, hide and reorder them.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, X } from 'lucide-react'
import { IPC } from '../../../../shared/ipc-channels'
import { safeInvoke } from '../../../utils/safeInvoke'
import { useWorkspaceStore } from '../../../stores/workspaceStore'
import { useAlertStore } from '../../../stores/alertStore'
import { useVocab } from '../../../hooks/useVocab'
import { isOn } from '../../../../shared/features'
import { CARD_DEFS, layoutToSave, parseLayout, resolveLayout, type CardDef, type CardKey, type SavedLayout } from './layout'
import { MonthlyContactsCard } from '../MonthlyContactsCard'
import { StagesCard } from '../StagesCard'
import { MissingInfoNotice } from '../MissingInfoNotice'
import { DueForServiceCard, QuotasCard } from './RuleKindCards'
import { RecentActivityCard } from './RecentActivityCard'
import { TodayCard } from './TodayCard'
import { SavedReportCard } from './SavedReportCard'
import { loadPinnedReports, setReportPinned } from '../../../utils/pinnedReports'

export function DashboardCards({ summary, whatsDue, recentlyArchived, customizing, onDoneCustomizing }: {
  /** The summary tiles, which use the dashboard's own counts */
  summary: React.ReactNode
  /** The deadline tabs: What's due, Overdue, This week, This month */
  whatsDue: React.ReactNode
  /** Archived records with Reactivate, from the dashboard's own load */
  recentlyArchived: React.ReactNode
  customizing: boolean
  onDoneCustomizing: () => void
}): React.ReactElement {
  const { f } = useVocab(null)
  const features = useWorkspaceStore(s => s.features)
  const rules = useAlertStore(s => s.rules)
  const rulesLoaded = useAlertStore(s => s.isLoaded)
  const [saved, setSaved] = useState<SavedLayout | null | undefined>(undefined)
  const [pinned, setPinned] = useState<number[]>([])
  // Pinned reports are listed in Customize too (D-21)
  const [reportNames, setReportNames] = useState<Record<number, string>>({})
  useEffect(() => {
    if (!customizing || pinned.length === 0) return
    void safeInvoke<Array<{ id: number; name: string }>>(IPC.REPORT_LIST).then(r => {
      if (r.ok && Array.isArray(r.data)) setReportNames(Object.fromEntries(r.data.map(x => [x.id, x.name])))
    })
  }, [customizing, pinned.length])

  useEffect(() => { if (!rulesLoaded) void useAlertStore.getState().loadRules() }, [rulesLoaded])
  useEffect(() => {
    void safeInvoke<string | null>(IPC.SETTINGS_GET, 'dashboard_layout').then(r => setSaved(r.ok ? parseLayout(r.data) : null))
    void loadPinnedReports().then(setPinned)
  }, [])

  const available = (def: CardDef) =>
    (!def.feature || isOn(features, def.feature)) && (!def.needsRuleKind || rules.some(r => r.kind === def.needsRuleKind))
  const cards = useMemo(() => resolveLayout(saved ?? null, available), [saved, features, rules]) // eslint-disable-line react-hooks/exhaustive-deps

  function save(next: Array<{ def: CardDef; on: boolean }>) {
    // Cards not offered right now (feature off) keep their place and setting
    const layout = layoutToSave(next)
    const others = CARD_DEFS.filter(d => !next.some(n => n.def.key === d.key)).map(d => d.key)
    const merged: SavedLayout = { order: [...layout.order, ...others.filter(k => saved?.order.includes(k))], hidden: [...layout.hidden, ...others.filter(k => saved?.hidden.includes(k))] }
    setSaved(merged)
    void safeInvoke(IPC.SETTINGS_UPDATE, 'dashboard_layout', JSON.stringify(merged))
  }
  const move = (i: number, by: -1 | 1) => {
    const j = i + by
    if (j < 0 || j >= cards.length) return
    const next = [...cards]
    ;[next[i], next[j]] = [next[j]!, next[i]!]
    save(next)
  }

  const render: Record<CardKey, () => React.ReactNode> = {
    summary: () => summary,
    whatsDue: () => whatsDue,
    today: () => <TodayCard />,
    requirements: () => <MonthlyContactsCard />,
    stages: () => <StagesCard />,
    missingInfo: () => <MissingInfoNotice />,
    dueForService: () => <DueForServiceCard />,
    quotas: () => <QuotasCard />,
    recentActivity: () => <RecentActivityCard />,
    recentlyArchived: () => recentlyArchived,
  }

  if (saved === undefined) return <>{summary}{whatsDue}</>

  return (
    <>
      {customizing && (
        <section aria-labelledby="customize-title" className="mb-6 rounded-lg border-2 border-blue-300 dark:border-blue-700 bg-blue-50/50 dark:bg-blue-900/20 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h2 id="customize-title" className="text-lg font-semibold text-slate-800 dark:text-slate-100">Customize dashboard</h2>
            <button type="button" className="btn-compact-primary" onClick={onDoneCustomizing}><X className="w-4 h-4" />Done</button>
          </div>
          <p className="text-base text-slate-600 dark:text-slate-300">Choose the cards to show and their order. Cards for features that are off aren't listed.</p>
          <ol className="space-y-1" aria-label="Dashboard cards">
            {cards.map((c, i) => (
              <li key={c.def.key} className="flex items-center gap-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2">
                <label className="flex-1 flex items-center gap-2 text-base text-slate-800 dark:text-slate-100 cursor-pointer" style={{ minHeight: 44 }}>
                  <input type="checkbox" className="w-5 h-5" checked={c.on} onChange={e => save(cards.map(x => x === c ? { ...x, on: e.target.checked } : x))} />
                  {f(c.def.title)}
                  {/* An unticked row is a card you can add, not one that's missing (UX D-46) */}
                  {!c.on && <span className="text-sm text-slate-500 dark:text-slate-400">(off)</span>}
                </label>
                <button type="button" aria-label={`Move ${f(c.def.title)} up`} disabled={i === 0} onClick={() => move(i, -1)}
                  className="hit-44 p-1.5 rounded-sm text-slate-500 disabled:opacity-30 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"><ArrowUp className="w-4 h-4" /></button>
                <button type="button" aria-label={`Move ${f(c.def.title)} down`} disabled={i === cards.length - 1} onClick={() => move(i, 1)}
                  className="hit-44 p-1.5 rounded-sm text-slate-500 disabled:opacity-30 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"><ArrowDown className="w-4 h-4" /></button>
              </li>
            ))}
          </ol>
          {pinned.length > 0 && (
            <>
              <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100 pt-2">Pinned reports</h3>
              <p className="text-sm text-slate-600 dark:text-slate-300">These show at the end. Add one with Show on dashboard on a report.</p>
              <ul className="space-y-1" aria-label="Pinned reports">
                {pinned.map(id => (
                  <li key={id} className="flex items-center gap-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3" style={{ minHeight: 44 }}>
                    <span className="flex-1 text-base text-slate-800 dark:text-slate-100">{reportNames[id] ?? 'Report'}</span>
                    <button type="button" className="btn-compact-secondary" onClick={() => void setReportPinned(id, false).then(ids => { if (ids) setPinned(ids) })}>Unpin</button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
      {cards.filter(c => c.on).map(c => <React.Fragment key={c.def.key}>{render[c.def.key]()}</React.Fragment>)}
      {pinned.map(id => <SavedReportCard key={id} id={id} onUnpin={rid => void setReportPinned(rid, false).then(ids => { if (ids) setPinned(ids) })} />)}
    </>
  )
}
