import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Timer, X, Download } from 'lucide-react'
import toast from 'react-hot-toast'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { monthKey } from '../../../shared/contactRequirements'
import { formatMinutes, formatMiles, type TotalsReport } from '../../../shared/timeMileage'
import { formatMeasure } from '../../../shared/measures'
import { useVocab } from '../../hooks/useVocab'

/**
 * Monthly totals from notes — time (service units), mileage and your own
 * numbers — with a CSV for billing or reimbursement.
 */
export function TotalsDialog({ gridId, onClose }: { gridId?: number; onClose: () => void }): React.ReactElement {
  const { t } = useVocab(gridId ?? null)
  const trapRef = useRef<HTMLDivElement>(null)
  useFocusTrap(trapRef, true)
  const months = useMemo(() => {
    const now = new Date()
    return Array.from({ length: 13 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      return { key: monthKey(d), label: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) }
    })
  }, [])
  const [month, setMonth] = useState(new Date().getDate() <= 7 ? months[1]!.key : months[0]!.key)
  const [report, setReport] = useState<TotalsReport | null>(null)
  // Mileage claims usually cover every caseload
  const [scopeAll, setScopeAll] = useState(false)
  const scopeGrid = scopeAll ? undefined : gridId

  useEffect(() => {
    setReport(null)
    void safeInvoke<TotalsReport>(IPC.TOTALS_GET, month, scopeGrid).then(r => { if (r.ok) setReport(r.data) })
  }, [month, scopeGrid])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function saveCsv() {
    const res = await safeInvoke<{ filePath: string; count: number } | null>(IPC.TOTALS_EXPORT_CSV, month, scopeGrid)
    if (!res.ok) toast.error("We couldn't save the file. Try again.")
    else if (res.data) toast.success(`Saved ${res.data.count} ${t('activity', { count: res.data.count })} to CSV`)
  }

  const totals = report?.totals
  // Only columns with something in them this month
  const showTime = !!totals && totals.minutes > 0
  const showMiles = !!totals && totals.miles > 0
  // A number's value without its label, for table cells ("1.5 h", "$84.20")
  const cell = (key: string, value: number | undefined) => {
    const d = report?.measures.find(m => m.key === key)
    return d && value != null ? formatMeasure(d, value).slice(d.label.length + 1) : '—'
  }
  return (
    <div className="fixed inset-0 z-[200] flex items-center-safe justify-center bg-black/50 p-4 overflow-y-auto" onClick={onClose}>
      <div ref={trapRef} role="dialog" aria-modal="true" aria-labelledby="tm-title" onClick={e => e.stopPropagation()}
        className="w-full max-w-2xl rounded-xl bg-white dark:bg-slate-800 shadow-xl border border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <Timer className="w-6 h-6 text-blue-600 dark:text-blue-400" aria-hidden="true" />
          <h2 id="tm-title" className="text-xl font-semibold text-slate-900 dark:text-slate-100 flex-1">Totals</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="hit-44 p-2 rounded-sm text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4 max-h-[65vh] overflow-y-auto">
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-base text-slate-700 dark:text-slate-200">Month
              <select className="input w-auto" value={month} onChange={e => setMonth(e.target.value)}>
                {months.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
              </select>
            </label>
            {gridId != null && (
              <label className="flex items-center gap-2 min-h-[44px] text-base text-slate-700 dark:text-slate-200 cursor-pointer">
                <input type="checkbox" className="w-5 h-5" checked={scopeAll} onChange={e => setScopeAll(e.target.checked)} />
                Include all {t('list', { many: true })}
              </label>
            )}
          </div>
          {report === null ? <p className="text-base text-slate-500 dark:text-slate-400">Loading…</p>
            : report.entries.length === 0 ? (
              <p className="text-base text-slate-700 dark:text-slate-200">
                No {t('activity', { many: true })} with time, miles or your own numbers this month. Turn them on in Settings → {t('activity', { many: true, cap: true })}, then fill them in when you write {t('activity', { article: true })}.
              </p>
            ) : (
              <>
                <p className="text-base text-slate-800 dark:text-slate-100">
                  <strong>Total:</strong> {totals!.minutes > 0 && `${formatMinutes(totals!.minutes)} (${totals!.units} unit${totals!.units === 1 ? '' : 's'} of ${report.unitMinutes} min)`}
                  {totals!.minutes > 0 && totals!.miles > 0 && '  ·  '}
                  {totals!.miles > 0 && `${formatMiles(totals!.miles)}${report.mileageRate ? ` = $${(totals!.miles * report.mileageRate).toFixed(2)}` : ''}`}
                  {(showTime || showMiles) && report.measures.length > 0 && '  ·  '}
                  {report.measures.map(d => formatMeasure(d, totals!.extra[d.key] ?? 0)).join('  ·  ')}
                </p>
                <table className="w-full text-base">
                  <thead>
                    <tr className="text-left text-slate-600 dark:text-slate-300 border-b-2 border-slate-300 dark:border-slate-600">
                      <th className="py-2 pr-3 font-medium">{t('record', { cap: true })}</th>
                      {showTime && <th className="py-2 pr-3 font-medium">Time</th>}
                      {showTime && <th className="py-2 pr-3 font-medium">Units</th>}
                      {showMiles && <th className="py-2 pr-3 font-medium">Miles</th>}
                      {report.measures.map(d => <th key={d.key} className="py-2 pr-3 font-medium">{d.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {report.byClient.map(c => (
                      <tr key={c.rowId} className="border-b border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100">
                        <td className="py-2 pr-3">{c.clientName}</td>
                        {showTime && <td className="py-2 pr-3 tabular-nums">{c.minutes ? formatMinutes(c.minutes) : '—'}</td>}
                        {showTime && <td className="py-2 pr-3 tabular-nums">{c.units || '—'}</td>}
                        {showMiles && <td className="py-2 pr-3 tabular-nums">{c.miles ? formatMiles(c.miles) : '—'}</td>}
                        {report.measures.map(d => <td key={d.key} className="py-2 pr-3 tabular-nums">{cell(d.key, c.extra[d.key])}</td>)}
                      </tr>
                    ))}
                  </tbody>
                  {report.byClient.length > 1 && (
                    <tfoot>
                      <tr className="border-t-2 border-slate-300 dark:border-slate-600 font-semibold text-slate-900 dark:text-slate-100">
                        <td className="py-2 pr-3">Total</td>
                        {showTime && <td className="py-2 pr-3 tabular-nums">{formatMinutes(totals!.minutes)}</td>}
                        {showTime && <td className="py-2 pr-3 tabular-nums">{totals!.units}</td>}
                        {showMiles && <td className="py-2 pr-3 tabular-nums">{formatMiles(totals!.miles)}</td>}
                        {report.measures.map(d => <td key={d.key} className="py-2 pr-3 tabular-nums">{cell(d.key, totals!.extra[d.key])}</td>)}
                      </tr>
                    </tfoot>
                  )}
                </table>
              </>
            )}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-200 dark:border-slate-700">
          {report && report.entries.length > 0 && (
            <button type="button" className="btn-secondary" onClick={() => void saveCsv()}>
              <Download className="w-4 h-4" aria-hidden="true" />Save as CSV…
            </button>
          )}
          <button type="button" className="btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}
