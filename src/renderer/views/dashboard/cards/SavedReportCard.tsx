/** A saved report pinned to the dashboard (W10 §4 `savedReport:<id>`): its first lines, open or unpin. */
import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BarChart3, PinOff } from 'lucide-react'
import { IPC } from '../../../../shared/ipc-channels'
import { chartableReport, type ReportResult, type SavedReport } from '../../../../shared/reports'
import { safeInvoke } from '../../../utils/safeInvoke'
import { ReportTable } from '../../../components/reports/ReportTable'
import { ReportChart } from '../../../components/reports/ReportChart'
import { useDeadlinesVersion } from '../useDashboardRefresh'
import { friendlyError } from '../../../utils/friendlyError'

export function SavedReportCard({ id, onUnpin }: { id: number; onUnpin: (id: number) => void }): React.ReactElement | null {
  const navigate = useNavigate()
  const [data, setData] = useState<{ report: SavedReport; result: ReportResult; explanation?: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Its rows change with deadlines marked done, sample data and lists going to the Trash
  const version = useDeadlinesVersion()
  useEffect(() => {
    let alive = true
    void safeInvoke<{ report: SavedReport; result: ReportResult; explanation?: string }>(IPC.REPORT_RUN_SAVED, id).then(r => {
      if (!alive) return
      if (r.ok) { setData(r.data); setError(null) } else setError(friendlyError(r.error, "We couldn't show this report — try again"))
    })
    return () => { alive = false }
  }, [id, version])
  if (error === 'That report is no longer available.') return null
  return (
    <section aria-labelledby={`saved-report-${id}`} className="mb-6 rounded-lg border-2 border-slate-200 dark:border-slate-700 p-4 space-y-2">
      <div className="flex items-center gap-2">
        <h2 id={`saved-report-${id}`} className="flex-1 text-lg font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <BarChart3 className="w-5 h-5" aria-hidden="true" />{data?.report.name ?? 'Report'}
        </h2>
        <button type="button" className="btn-compact-secondary" onClick={() => navigate(`/reports?id=${id}`)}>Open</button>
        <button type="button" aria-label={`Unpin ${data?.report.name ?? 'report'} from the dashboard`} className="hit-44 p-2 rounded-sm text-slate-500 hover:text-red-600 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500" onClick={() => onUnpin(id)}>
          <PinOff className="w-4 h-4" />
        </button>
      </div>
      {error ? <p className="text-base text-red-700 dark:text-red-300">{error}</p>
        : data ? (
          <>
            {(data.report.config.about || data.explanation) && <p className="text-sm text-slate-600 dark:text-slate-300">{data.report.config.about ?? data.explanation}</p>}
            {/* Grouped reports read best as bars; the full table is one click away */}
            {chartableReport(data.report.config, data.result)
              ? <ReportChart result={data.result} maxBars={10} />
              : <ReportTable result={data.result} maxRows={10} caption={data.report.name} />}
          </>
        )
        : <p className="text-base text-slate-500 dark:text-slate-400">Working…</p>}
    </section>
  )
}
