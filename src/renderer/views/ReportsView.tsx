/**
 * Reports (W10 §6.3): saved reports on the left, the builder on the right.
 * Opened from the sidebar, the Export menu, a pinned dashboard card (?id=)
 * or the command palette.
 */
import React, { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BarChart3, Plus } from 'lucide-react'
import { IPC } from '../../shared/ipc-channels'
import type { SavedReport } from '../../shared/reports'
import { safeInvoke } from '../utils/safeInvoke'
import { useGridStore } from '../stores/gridStore'
import { ReportBuilder } from '../components/reports/ReportBuilder'

export default function ReportsView(): React.ReactElement {
  const [params, setParams] = useSearchParams()
  const grids = useGridStore(s => s.grids)
  const [reports, setReports] = useState<SavedReport[]>([])
  const openId = Number(params.get('id')) || null
  // Bumped for "New report" so the builder starts fresh even when nothing was open
  const [fresh, setFresh] = useState(0)

  const load = useCallback(async () => {
    const r = await safeInvoke<SavedReport[]>(IPC.REPORT_LIST)
    if (r.ok) setReports(r.data)
  }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => { if (grids.length === 0) void useGridStore.getState().loadGridList() }, [grids.length])

  const current = openId ? reports.find(r => r.id === openId) ?? null : null
  const gridName = (id: number) => grids.find(g => g.id === id)?.name ?? ''

  return (
    <div className="h-full flex flex-col bg-white dark:bg-slate-900">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-700">
        <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2 flex-1"><BarChart3 className="w-5 h-5" aria-hidden="true" />Reports</h1>
        <button type="button" className="btn-primary" onClick={() => { setParams({}); setFresh(n => n + 1) }}><Plus className="w-4 h-4" />New report</button>
      </div>
      <div className="flex-1 min-h-0 flex flex-col md:flex-row">
        <nav aria-label="Saved reports" className="md:w-60 flex-shrink-0 border-b md:border-b-0 md:border-r border-slate-200 dark:border-slate-700 overflow-auto p-2">
          <h2 className="px-2 py-1 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Saved</h2>
          {reports.length === 0 ? (
            <p className="px-2 text-base text-slate-500 dark:text-slate-400">Reports you save show up here.</p>
          ) : (
            <ul>
              {reports.map(r => (
                <li key={r.id}>
                  <button type="button" onClick={() => setParams({ id: String(r.id) })} aria-current={r.id === openId ? 'page' : undefined}
                    className={`w-full text-left px-2 py-1.5 rounded-md focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 ${r.id === openId ? 'bg-blue-50 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                    style={{ minHeight: 44 }}>
                    <span className="block text-base truncate">{r.name}</span>
                    <span className="block text-sm text-slate-500 dark:text-slate-400 truncate">{gridName(r.grid_id)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </nav>
        <div className="flex-1 min-w-0 overflow-auto p-4">
          {openId && !current && reports.length > 0 ? (
            <p className="text-base text-slate-500 dark:text-slate-400">That report is no longer available.</p>
          ) : (
            <ReportBuilder
              key={current ? `r${current.id}` : `new${fresh}`}
              initial={current}
              onSaved={r => { void load(); setParams({ id: String(r.id) }) }}
              onDeleted={() => { void load(); setParams({}) }}
            />
          )}
        </div>
      </div>
    </div>
  )
}
