import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileWarning, Download } from 'lucide-react'
import toast from 'react-hot-toast'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'
import { Dialog } from '../ui/Dialog'
import { PrimaryButton, SecondaryButton } from '../ui/Button'
import type { MissingInfoGrid } from '../../../shared/types'
import { useVocab } from '../../hooks/useVocab'

/** Clients missing any required field, or with a date Pulse can't read in a column with a deadline rule, for one caseload or all of them. */
export function MissingInfoDialog({ gridId, onClose }: { gridId?: number; onClose: () => void }): React.ReactElement {
  const { t } = useVocab(gridId ?? null)
  const navigate = useNavigate()
  const [data, setData] = useState<MissingInfoGrid[] | null>(null)

  useEffect(() => {
    void safeInvoke<MissingInfoGrid[]>(IPC.MISSING_INFO_GET, gridId).then(r => setData(r.ok ? r.data : []))
  }, [gridId])

  async function saveCsv() {
    const res = await safeInvoke<{ filePath: string; count: number } | null>(IPC.MISSING_INFO_EXPORT_CSV, gridId)
    if (!res.ok) toast.error("We couldn't save the list. Try again.")
    else if (res.data) toast.success(`Saved ${res.data.count} ${t('record', { count: res.data.count })} to CSV`)
  }

  const total = data?.reduce((n, g) => n + g.clients.length, 0) ?? 0

  return (
    <Dialog open onClose={onClose} size="xl" title="Missing information"
      icon={<FileWarning className="w-6 h-6 mt-1 text-amber-700 dark:text-amber-400" aria-hidden="true" />}
      footer={<>
        <span className="flex-1 text-base text-slate-600 dark:text-slate-300">
          {data && data.length > 0 ? `${total} ${t('record', { count: total })} missing information` : ''}
        </span>
        {total > 0 && (
          <SecondaryButton icon={<Download className="w-4 h-4" />} onClick={() => void saveCsv()}>Save as CSV…</SecondaryButton>
        )}
        <PrimaryButton onClick={onClose}>Done</PrimaryButton>
      </>}>
      <div className="space-y-4">
        {data === null && <p className="text-base text-slate-500 dark:text-slate-400">Loading…</p>}
        {data?.length === 0 && (
          <p className="text-base text-slate-700 dark:text-slate-200">
            No columns have to be filled in yet. In {t('list', { article: true })}, click the <strong>⋯</strong> button next to a column's name, choose <strong>Column settings…</strong> and turn on <strong>Must be filled in</strong>. Empty cells in that column then show "Missing" and are listed here.
          </p>
        )}
        {data?.map(g => (
          <section key={g.gridId} aria-labelledby={`missing-${g.gridId}`}>
            <h3 id={`missing-${g.gridId}`} className="text-lg font-semibold text-slate-800 dark:text-slate-100">{g.gridName}</h3>
            {g.requiredColumns.length > 0 && <p className="text-sm text-slate-600 dark:text-slate-300 mb-1">Required: {g.requiredColumns.join(', ')}</p>}
            {g.clients.length === 0
              ? <p className="text-base text-green-700 dark:text-green-300 font-medium">Every {t('record')} has all required information.</p>
              : (
                <ul className="divide-y divide-slate-200 dark:divide-slate-700">
                  {g.clients.map(c => (
                    <li key={c.rowId}>
                      <button type="button" onClick={() => { onClose(); navigate(`/profile/${c.rowId}?gridId=${g.gridId}`) }}
                        className="hit-44 w-full flex flex-wrap items-baseline gap-x-3 px-2 py-2 text-left rounded-sm hover:bg-slate-50 dark:hover:bg-slate-700/50">
                        <span className="text-base font-medium text-slate-800 dark:text-slate-100">{c.clientName}</span>
                        {c.missing.length > 0 && <span className="text-sm text-amber-800 dark:text-amber-300">missing {c.missing.join(', ')}</span>}
                        {/* A date Pulse can't read hides its deadline everywhere (AUDIT-026) */}
                        {(c.notADate ?? []).map(name => (
                          <span key={name} className="text-sm text-red-800 dark:text-red-300">{name}: not a date</span>
                        ))}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
          </section>
        ))}
      </div>
    </Dialog>
  )
}
