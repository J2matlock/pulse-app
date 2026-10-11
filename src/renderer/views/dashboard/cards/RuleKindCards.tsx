/**
 * Dashboard cards for by-usage and limited-visit deadlines (W10 §4):
 * "Due for service" (meter rules due within 30 days) and "Running low"
 * (quota rules — visits, sessions, lessons — that are low, used up or ending).
 */
import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Gauge, Ticket } from 'lucide-react'
import { IPC } from '../../../../shared/ipc-channels'
import { localDateString } from '../../../../shared/dates'
import type { DeadlineResult, RuleKind } from '../../../../shared/deadlineEngine'
import { safeInvoke } from '../../../utils/safeInvoke'
import { useDeadlinesVersion } from '../useDashboardRefresh'

type Item = DeadlineResult & { row_id: number; grid_id: number; grid_name: string; column_name: string; client_name: string | null; rule_kind: RuleKind }

function useKindDeadlines(kind: RuleKind, withinDays: number | null): Item[] | null {
  const [items, setItems] = useState<Item[] | null>(null)
  // Reload after Done/Undo in the Priority list, a counted note, or sample data changing
  const version = useDeadlinesVersion()
  useEffect(() => {
    let alive = true
    const to = withinDays === null ? undefined : localDateString(new Date(Date.now() + withinDays * 86_400_000))
    void safeInvoke<Item[]>(IPC.DEADLINES_GET, to ? { to } : {}).then(r => { if (alive) setItems(r.ok ? r.data.filter(d => d.rule_kind === kind) : []) })
    return () => { alive = false }
  }, [kind, withinDays, version])
  return items
}

function CardShell({ id, icon, title, empty, children }: { id: string; icon: React.ReactNode; title: string; empty: string | null; children: React.ReactNode }): React.ReactElement {
  return (
    <section aria-labelledby={id} className="mb-6 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 space-y-2">
      <h2 id={id} className="text-lg font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">{icon}{title}</h2>
      {empty ? <p className="text-base text-slate-500 dark:text-slate-400">{empty}</p> : children}
    </section>
  )
}

function ItemList({ items }: { items: Item[] }): React.ReactElement {
  const navigate = useNavigate()
  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-700">
      {items.slice(0, 10).map(d => (
        <li key={`${d.row_id}-${d.column_name}`}>
          <button type="button" onClick={() => navigate(`/profile/${d.row_id}?gridId=${d.grid_id}`)}
            className="w-full text-left flex flex-wrap items-baseline gap-x-2 py-2 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-sm focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
            style={{ minHeight: 44 }}>
            <span className="text-base font-medium text-slate-800 dark:text-slate-100">{d.client_name || '(unnamed)'}</span>
            <span className="text-base text-slate-600 dark:text-slate-300">{d.column_name}</span>
            <span className={`text-sm ml-auto ${(d.daysUntil ?? 1) <= 0 ? 'text-red-700 dark:text-red-400 font-medium' : 'text-slate-500 dark:text-slate-400'}`}>{d.label ?? d.detail}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

export function DueForServiceCard(): React.ReactElement | null {
  const items = useKindDeadlines('meter', 30)
  if (items === null) return null
  const sorted = [...items].sort((a, b) => (a.daysUntil ?? 0) - (b.daysUntil ?? 0))
  return (
    <CardShell id="due-service-title" icon={<Gauge className="w-5 h-5" aria-hidden="true" />} title="Due for service"
      empty={sorted.length ? null : 'Nothing is due for service in the next 30 days.'}>
      <ItemList items={sorted} />
    </CardShell>
  )
}

export function QuotasCard(): React.ReactElement | null {
  const items = useKindDeadlines('quota', null)
  if (items === null) return null
  const low = items.filter(d => d.state === 'soon' || d.state === 'due' || d.state === 'overdue').sort((a, b) => (a.daysUntil ?? 0) - (b.daysUntil ?? 0))
  return (
    <CardShell id="quotas-title" icon={<Ticket className="w-5 h-5" aria-hidden="true" />} title="Running low"
      empty={low.length ? null : 'Nothing is running low or ending soon.'}>
      <ItemList items={low} />
    </CardShell>
  )
}
