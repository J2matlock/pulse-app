import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ShieldCheck, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { monthKey } from '../../../shared/contactRequirements'
import { useVocab, useVocabByList } from '../../hooks/useVocab'

interface Summary {
  month: string
  asOf: string
  requirementsOn: boolean
  grids: Array<{
    gridId: number
    gridName: string
    contacts: null | { total: number; met: number }
    deadlines: { total: number; onTime: number; extended?: number }
    missingInfo: { clients: number }
  }>
}

const pct = (n: number, d: number) => d === 0 ? '—' : `${Math.round((n / d) * 100)}%`

/** Monthly compliance summary: preview the numbers, then save the PDF with the exceptions listed. */
export function ComplianceSummaryDialog({ gridId, gridName, onClose }: {
  gridId?: number
  gridName?: string
  onClose: () => void
}): React.ReactElement {
  const { t } = useVocab(gridId ?? null)
  const tFor = useVocabByList()
  const trapRef = useRef<HTMLDivElement>(null)
  useFocusTrap(trapRef, true)
  const months = useMemo(() => {
    const now = new Date()
    return Array.from({ length: 13 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      return { key: monthKey(d), label: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) }
    })
  }, [])
  // Early in a month, last month is usually the one being reported
  const [month, setMonth] = useState(new Date().getDate() <= 7 ? months[1]!.key : months[0]!.key)
  const [scopeAll, setScopeAll] = useState(gridId == null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [working, setWorking] = useState(false)
  const scopeGrid = scopeAll ? undefined : gridId
  // A few days into this month, low numbers are expected, not a failing grade (UX D-10)
  const monthJustStarted = month === months[0]!.key && new Date().getDate() < 7
  const started = monthJustStarted ? ' (month just started)' : ''

  useEffect(() => {
    setSummary(null)
    void safeInvoke<Summary>(IPC.COMPLIANCE_SUMMARY_GET, month, scopeGrid).then(r => { if (r.ok) setSummary(r.data) })
  }, [month, scopeGrid])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function save() {
    setWorking(true)
    try {
      const res = await safeInvoke<string | null>(IPC.EXPORT_COMPLIANCE_SUMMARY, month, scopeGrid)
      if (!res.ok) toast.error("We couldn't create the summary. Try again.")
      else if (res.data) { toast.success('Saved the monthly summary'); onClose() }
    } finally {
      setWorking(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center-safe justify-center bg-black/50 p-4 overflow-y-auto" onClick={onClose}>
      <div ref={trapRef} role="dialog" aria-modal="true" aria-labelledby="compliance-title" aria-describedby="compliance-sub" onClick={e => e.stopPropagation()}
        className="w-full max-w-2xl rounded-xl bg-white dark:bg-slate-800 shadow-xl border border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <ShieldCheck className="w-6 h-6 text-blue-600 dark:text-blue-400" aria-hidden="true" />
          {/* The same name as the button that opens it (UX D-10) */}
          <div className="flex-1">
            <h2 id="compliance-title" className="text-xl font-semibold text-slate-900 dark:text-slate-100">Monthly summary</h2>
            <p id="compliance-sub" className="text-base text-slate-600 dark:text-slate-300">How the month is going: {t('requirement', { many: true })}, deadlines on time, missing information</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="hit-44 p-2 rounded-sm text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-base text-slate-700 dark:text-slate-200">Month
              <select className="input w-auto" value={month} onChange={e => setMonth(e.target.value)}>
                {months.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
              </select>
            </label>
            {gridId != null && (
              <div className="flex gap-4" role="radiogroup" aria-label={`Which ${t('list', { many: true })}`}>
                <label className="flex items-center gap-2 min-h-[44px] text-base text-slate-700 dark:text-slate-200 cursor-pointer">
                  <input type="radio" name="compliance-scope" className="w-5 h-5" checked={!scopeAll} onChange={() => setScopeAll(false)} />
                  {gridName ?? `This ${t('list')}`}
                </label>
                <label className="flex items-center gap-2 min-h-[44px] text-base text-slate-700 dark:text-slate-200 cursor-pointer">
                  <input type="radio" name="compliance-scope" className="w-5 h-5" checked={scopeAll} onChange={() => setScopeAll(true)} />
                  All {t('list', { many: true })}
                </label>
              </div>
            )}
          </div>

          {summary === null ? <p className="text-base text-slate-500 dark:text-slate-400">Loading…</p> : (
            <table className="w-full text-base">
              <thead>
                <tr className="text-left text-slate-600 dark:text-slate-300 border-b-2 border-slate-300 dark:border-slate-600">
                  <th className="py-2 pr-3 font-medium">{t('list', { cap: true })}</th>
                  {summary.requirementsOn && <th className="py-2 pr-3 font-medium">{t('requirement', { many: true, cap: true })} met</th>}
                  <th className="py-2 pr-3 font-medium">Deadlines on time</th>
                  <th className="py-2 font-medium">Missing info</th>
                </tr>
              </thead>
              <tbody>
                {summary.grids.map(g => (
                  <tr key={g.gridId} className="border-b border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100">
                    <td className="py-2 pr-3">{g.gridName}</td>
                    {summary.requirementsOn && <td className="py-2 pr-3 tabular-nums">{g.contacts ? `${pct(g.contacts.met, g.contacts.total)} (${g.contacts.met}/${g.contacts.total})${started}` : 'Not set up'}</td>}
                    <td className="py-2 pr-3 tabular-nums">{g.deadlines.total ? `${pct(g.deadlines.onTime, g.deadlines.total)} (${g.deadlines.onTime}/${g.deadlines.total})${g.deadlines.extended ? ` · ${g.deadlines.extended} extended` : ''}${started}` : 'None tracked'}</td>
                    <td className="py-2 tabular-nums">{g.missingInfo.clients === 0 ? 'None' : `${g.missingInfo.clients} ${tFor(g.gridId)('record', { count: g.missingInfo.clients })}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Deadlines are checked as of the last day of the month (or today, for this month). The PDF lists who is behind, by {t('record')}.
          </p>
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-200 dark:border-slate-700">
          <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
          <button type="button" className="btn-primary" disabled={working || summary === null} onClick={() => void save()}>{working ? 'Creating…' : 'Save as PDF…'}</button>
        </div>
      </div>
    </div>
  )
}
