import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileWarning, X, Download } from 'lucide-react'
import toast from 'react-hot-toast'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import type { MissingInfoGrid } from '../../../shared/types'
import { useVocab } from '../../hooks/useVocab'

/** Clients missing any required field, for one caseload or all of them. */
export function MissingInfoDialog({ gridId, onClose }: { gridId?: number; onClose: () => void }): React.ReactElement {
  const { t } = useVocab(gridId ?? null)
  const trapRef = useRef<HTMLDivElement>(null)
  useFocusTrap(trapRef, true)
  const navigate = useNavigate()
  const [data, setData] = useState<MissingInfoGrid[] | null>(null)

  useEffect(() => {
    void safeInvoke<MissingInfoGrid[]>(IPC.MISSING_INFO_GET, gridId).then(r => setData(r.ok ? r.data : []))
  }, [gridId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function saveCsv() {
    const res = await safeInvoke<{ filePath: string; count: number } | null>(IPC.MISSING_INFO_EXPORT_CSV, gridId)
    if (!res.ok) toast.error("We couldn't save the list. Try again.")
    else if (res.data) toast.success(`Saved ${res.data.count} ${t('record', { count: res.data.count })} to CSV`)
  }

  const total = data?.reduce((n, g) => n + g.clients.length, 0) ?? 0

  return (
    <div className="fixed inset-0 z-[200] flex items-center-safe justify-center bg-black/50 p-4 overflow-y-auto" onClick={onClose}>
      <div ref={trapRef} role="dialog" aria-modal="true" aria-labelledby="missing-title" onClick={e => e.stopPropagation()}
        className="w-full max-w-2xl rounded-xl bg-white dark:bg-slate-800 shadow-xl border border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <FileWarning className="w-6 h-6 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          <h2 id="missing-title" className="text-xl font-semibold text-slate-900 dark:text-slate-100 flex-1">Missing information</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="hit-44 p-2 rounded-sm text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4 max-h-[65vh] overflow-y-auto">
          {data === null && <p className="text-base text-slate-500 dark:text-slate-400">Loading…</p>}
          {data?.length === 0 && (
            <p className="text-base text-slate-700 dark:text-slate-200">
              No columns are marked required yet. In {t('list', { article: true })}, open a column's menu and turn on <strong>Required field</strong>. Empty cells in that column then show "Missing" and are listed here.
            </p>
          )}
          {data?.map(g => (
            <section key={g.gridId} aria-labelledby={`missing-${g.gridId}`}>
              <h3 id={`missing-${g.gridId}`} className="text-lg font-semibold text-slate-800 dark:text-slate-100">{g.gridName}</h3>
              <p className="text-sm text-slate-600 dark:text-slate-300 mb-1">Required: {g.requiredColumns.join(', ')}</p>
              {g.clients.length === 0
                ? <p className="text-base text-green-700 dark:text-green-300 font-medium">Every {t('record')} has all required information.</p>
                : (
                  <ul className="divide-y divide-slate-200 dark:divide-slate-700">
                    {g.clients.map(c => (
                      <li key={c.rowId}>
                        <button type="button" onClick={() => { onClose(); navigate(`/profile/${c.rowId}?gridId=${g.gridId}`) }}
                          className="hit-44 w-full flex flex-wrap items-baseline gap-x-3 px-2 py-2 text-left rounded-sm hover:bg-slate-50 dark:hover:bg-slate-700/50">
                          <span className="text-base font-medium text-slate-800 dark:text-slate-100">{c.clientName}</span>
                          <span className="text-sm text-amber-800 dark:text-amber-300">missing {c.missing.join(', ')}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
            </section>
          ))}
        </div>
        <div className="flex items-center gap-2 px-6 py-4 border-t border-slate-200 dark:border-slate-700">
          <span className="flex-1 text-base text-slate-600 dark:text-slate-300">
            {data && data.length > 0 ? `${total} ${t('record', { count: total })} missing information` : ''}
          </span>
          {total > 0 && (
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
