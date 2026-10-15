import React, { useState } from 'react'
import { History } from 'lucide-react'
import toast from 'react-hot-toast'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'
import { Dialog } from '../ui/Dialog'
import { PrimaryButton, SecondaryButton } from '../ui/Button'
import { useVocab } from '../../hooks/useVocab'
import { localDateString, localDateFromToday } from '../../../shared/dates'

type RangeKey = 'all' | 'year' | '12m' | '90d' | 'custom'

const RANGES: Array<{ key: RangeKey; label: string }> = [
  { key: 'all', label: 'All time' },
  { key: '12m', label: 'Last 12 months' },
  { key: 'year', label: 'This year' },
  { key: '90d', label: 'Last 90 days' },
  { key: 'custom', label: 'Choose dates' },
]

/**
 * Audit trail PDF for one client or a caseload: every field change, note
 * (voided ones and earlier versions included) and checklist completion.
 */
export function AuditReportDialog({ rowId, gridId, label, onClose }: {
  rowId?: number
  gridId?: number
  /** e.g. the client's or caseload's name, shown in the title */
  label: string
  onClose: () => void
}): React.ReactElement {
  const { t } = useVocab(gridId ?? null)
  const [range, setRange] = useState<RangeKey>('all')
  const [from, setFrom] = useState(localDateFromToday(-90))
  const [to, setTo] = useState(localDateString())
  const [working, setWorking] = useState(false)

  function dates(): { from?: string; to?: string } {
    const today = localDateString()
    switch (range) {
      case 'all': return {}
      case '12m': return { from: localDateFromToday(-365), to: today }
      case 'year': return { from: `${today.slice(0, 4)}-01-01`, to: today }
      case '90d': return { from: localDateFromToday(-90), to: today }
      case 'custom': return { from, to }
    }
  }

  async function save() {
    const d = dates()
    if (d.from && d.to && d.from > d.to) { toast.error('The start date is after the end date.'); return }
    setWorking(true)
    try {
      const res = await safeInvoke<{ filePath: string; clients: number; events: number } | null>(IPC.EXPORT_AUDIT_REPORT, { rowId, gridId, ...d })
      if (!res.ok) { toast.error("We couldn't create the audit trail. Try again."); return }
      if (res.data) {
        toast.success(`Saved the audit trail (${res.data.events} ${res.data.events === 1 ? 'entry' : 'entries'})`)
        onClose()
      }
    } finally {
      setWorking(false)
    }
  }

  return (
    <Dialog open onClose={onClose} title={`Audit trail: ${label}`} size="lg"
      icon={<History className="w-6 h-6 text-blue-600 dark:text-blue-400" aria-hidden="true" />}
      footer={<>
        <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
        <PrimaryButton busy={working} onClick={() => void save()}>{working ? 'Creating…' : 'Save PDF…'}</PrimaryButton>
      </>}>
      <div className="space-y-4">
        <p className="text-base text-slate-700 dark:text-slate-200">
          A PDF of everything recorded, in time order: changes to each column, {t('activity', { many: true })} (including voided ones and earlier versions of edited ones), and completed checklist items.
        </p>
        <fieldset>
          <legend className="text-base font-medium text-slate-800 dark:text-slate-100 mb-1">Dates</legend>
          <div className="flex flex-wrap gap-x-4">
            {RANGES.map(r => (
              <label key={r.key} className="flex items-center gap-2 min-h-[44px] text-base text-slate-700 dark:text-slate-200 cursor-pointer">
                <input type="radio" name="audit-range" className="w-5 h-5" checked={range === r.key} onChange={() => setRange(r.key)} />
                {r.label}
              </label>
            ))}
          </div>
        </fieldset>
        {range === 'custom' && (
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-base text-slate-700 dark:text-slate-200">From
              <input type="date" className="input w-auto" value={from} onChange={e => setFrom(e.target.value)} />
            </label>
            <label className="flex items-center gap-2 text-base text-slate-700 dark:text-slate-200">To
              <input type="date" className="input w-auto" value={to} onChange={e => setTo(e.target.value)} />
            </label>
          </div>
        )}
      </div>
    </Dialog>
  )
}
