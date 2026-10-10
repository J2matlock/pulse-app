/**
 * Reports (W10 §6.3). The home page shows your reports as cards: what each
 * one answers and a glance at its result. Opening one, or "New report",
 * shows the builder. Reached from the sidebar, the Export menu, a pinned
 * dashboard card (?id=) or the command palette.
 */
import React, { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowLeft, BarChart3, Plus } from 'lucide-react'
import { IPC } from '../../shared/ipc-channels'
import { chartableReport, formatReportCell, type ReportResult, type SavedReport } from '../../shared/reports'
import { safeInvoke } from '../utils/safeInvoke'
import { useGridStore } from '../stores/gridStore'
import { ReportBuilder } from '../components/reports/ReportBuilder'
import { ReportChart } from '../components/reports/ReportChart'
import { ConfirmDialog } from '../components/shared/ConfirmDialog'

interface RunSaved { report: SavedReport; result: ReportResult; explanation?: string; listName?: string }

/** One saved report on the home page: what it answers and a glance at the answer */
function ReportCard({ report, onOpen }: { report: SavedReport; onOpen: () => void }): React.ReactElement {
  const [run, setRun] = useState<RunSaved | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    let alive = true
    void safeInvoke<RunSaved>(IPC.REPORT_RUN_SAVED, report.id).then(r => {
      if (!alive) return
      if (r.ok) setRun(r.data); else setError(true)
    })
    return () => { alive = false }
  }, [report.id, report.updated_at])
  const first = run?.result.columns.find(c => /^v\d+$/.test(c.key))
  return (
    <button type="button" onClick={onOpen}
      className="text-left flex flex-col items-stretch justify-start rounded-xl border-2 border-slate-200 dark:border-slate-700 hover:border-blue-400 dark:hover:border-blue-500 p-4 space-y-2 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 bg-white dark:bg-slate-800/40">
      <span className="block text-lg font-semibold text-slate-800 dark:text-slate-100">{report.name}</span>
      {run?.listName && <span className="block text-sm text-slate-500 dark:text-slate-400">{run.listName}</span>}
      <span className="block text-base text-slate-600 dark:text-slate-300">{report.config.about ?? run?.explanation ?? ''}</span>
      <span className="block pt-1">
        {error ? <span className="text-sm text-red-700 dark:text-red-300">This report can’t run right now. Open it to see why.</span>
          : !run ? <span className="text-sm text-slate-500 dark:text-slate-400">Working…</span>
          : chartableReport(report.config, run.result) ? <ReportChart result={run.result} maxBars={4} />
          : (
            <span className="flex items-baseline gap-2">
              <span className="text-3xl font-bold tabular-nums text-slate-800 dark:text-slate-100">
                {report.config.columns?.length || !first ? run.result.matched.toLocaleString('en-US') : formatReportCell(run.result.totals[first.key] ?? null, first.kind)}
              </span>
              <span className="text-base text-slate-500 dark:text-slate-400">{report.config.columns?.length || !first ? 'found' : first.label.toLowerCase()}</span>
            </span>
          )}
      </span>
    </button>
  )
}

export default function ReportsView(): React.ReactElement {
  const [params, setParams] = useSearchParams()
  const grids = useGridStore(s => s.grids)
  const [reports, setReports] = useState<SavedReport[] | null>(null)
  const openId = Number(params.get('id')) || null
  const building = openId !== null || params.get('new') === '1'
  // Bumped for "New report" so the builder starts fresh each time
  const [fresh, setFresh] = useState(0)
  const [dirty, setDirty] = useState(false)
  // Where to go once the person agrees to drop unsaved changes ('home', a report id, or a new report)
  const [leaving, setLeaving] = useState<null | { to: 'home' | 'new' | number }>(null)

  const load = useCallback(async () => {
    const r = await safeInvoke<SavedReport[]>(IPC.REPORT_LIST)
    if (r.ok) setReports(r.data)
  }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => { if (grids.length === 0) void useGridStore.getState().loadGridList() }, [grids.length])

  const current = openId ? reports?.find(r => r.id === openId) ?? null : null

  function go(to: 'home' | 'new' | number) {
    setDirty(false)
    if (to === 'home') { setParams({}); void load() }
    else if (to === 'new') { setParams({ new: '1' }); setFresh(n => n + 1) }
    else setParams({ id: String(to) })
  }
  function request(to: 'home' | 'new' | number) {
    if (to === openId) return
    if (building && dirty) setLeaving({ to })
    else go(to)
  }

  return (
    <div className="h-full flex flex-col bg-white dark:bg-slate-900">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-700">
        {building && (
          <button type="button" className="btn-compact-secondary" onClick={() => request('home')}><ArrowLeft className="w-4 h-4" />All reports</button>
        )}
        <h1 className="flex-1 text-xl font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2"><BarChart3 className="w-5 h-5" aria-hidden="true" />Reports</h1>
        <button type="button" className="btn-primary" onClick={() => request('new')}><Plus className="w-4 h-4" />New report</button>
      </div>

      {!building ? (
        <div className="flex-1 min-h-0 overflow-auto p-4 space-y-4">
          <p className="text-base text-slate-600 dark:text-slate-300 max-w-3xl">
            A report answers a question about your work, like “how many are at each stage?” or “how busy was each month?”.
            Open one below to see the whole answer, change it, print it or pin it to the dashboard, or click New report to ask your own.
          </p>
          {reports === null ? <p className="text-base text-slate-500 dark:text-slate-400">Working…</p>
            : reports.length === 0 ? (
              <div className="rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-600 p-6 text-center space-y-3">
                <p className="text-base text-slate-700 dark:text-slate-200">You don’t have any reports yet.</p>
                <button type="button" className="btn-primary" onClick={() => request('new')}><Plus className="w-4 h-4" />Make your first report</button>
              </div>
            ) : (
              <div className="grid gap-4 grid-cols-1 md:grid-cols-2 2xl:grid-cols-3">
                {reports.map(r => <ReportCard key={r.id} report={r} onOpen={() => request(r.id)} />)}
              </div>
            )}
        </div>
      ) : openId && reports !== null && !current ? (
        <p className="p-4 text-base text-slate-500 dark:text-slate-400">That report is no longer available.</p>
      ) : openId && reports === null ? (
        <p className="p-4 text-base text-slate-500 dark:text-slate-400">Working…</p>
      ) : (
        <div className="flex-1 min-h-0">
          <ReportBuilder
            key={current ? `r${current.id}` : `new${fresh}`}
            initial={current}
            onDirtyChange={setDirty}
            onSaved={r => { void load(); setDirty(false); setParams({ id: String(r.id) }) }}
            onDeleted={() => go('home')}
          />
        </div>
      )}
      <ConfirmDialog
        open={leaving !== null}
        title="Leave without saving?"
        message="Your changes to this report haven't been saved. If you leave now, they're lost."
        confirmLabel="Leave without saving"
        destructive
        onConfirm={() => { const to = leaving!.to; setLeaving(null); go(to) }}
        onCancel={() => setLeaving(null)}
      />
    </div>
  )
}
