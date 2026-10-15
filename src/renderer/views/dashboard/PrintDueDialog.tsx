/**
 * "Print what's due" (persona study R7): overdue and the next 7, 30 or 90 days
 * as a PDF, the same rows the dashboard's Overdue and Next N days tabs show,
 * worst first, in 12 pt black. The choice of days is remembered.
 */
import React, { useEffect, useRef, useState } from 'react'
import { Printer } from 'lucide-react'
import toast from 'react-hot-toast'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'
import { noteUnencryptedExport } from '../../utils/exportNotice'
import { Dialog } from '../../components/ui/Dialog'
import { PrimaryButton, SecondaryButton } from '../../components/ui/Button'
import { useVocab } from '../../hooks/useVocab'
import { useFeature } from '../../hooks/useFeature'

export const PRINT_DUE_CHOICES = [7, 30, 90] as const
export type PrintDueDays = typeof PRINT_DUE_CHOICES[number]
const DEFAULT_DAYS: PrintDueDays = 30
const SETTING = 'print_due_days'

function readDays(value: string | null | undefined): PrintDueDays {
  const n = Number(value)
  return PRINT_DUE_CHOICES.find(c => c === n) ?? DEFAULT_DAYS
}

export function PrintDueDialog({ onClose }: { onClose: () => void }): React.ReactElement {
  const { t } = useVocab(null)
  const apptsOn = useFeature('appointments')
  const [days, setDays] = useState<PrintDueDays>(DEFAULT_DAYS)
  const [appointments, setAppointments] = useState(true)
  const [working, setWorking] = useState(false)
  // Focus starts on the choice that's selected, so arrow keys move from there
  const checkedRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let live = true
    void safeInvoke<string | null>(IPC.SETTINGS_GET, SETTING).then(r => { if (live && r.ok) setDays(readDays(r.data)) })
    return () => { live = false }
  }, [])

  async function print() {
    setWorking(true)
    try {
      void safeInvoke(IPC.SETTINGS_UPDATE, SETTING, String(days))
      const res = await safeInvoke(IPC.EXPORT_WHATS_DUE, days, { includeAppointments: apptsOn && appointments })
      if (!res.ok) { toast.error("We couldn't make the PDF of what's due. Try again."); return }
      if (!res.data) return
      const n = res.data.count
      toast.success(n === 0 ? `Saved. Nothing is overdue or due in the next ${days} days.` : `Saved the PDF: ${n} thing${n === 1 ? '' : 's'} to do.`)
      noteUnencryptedExport()
      onClose()
    } finally {
      setWorking(false)
    }
  }

  return (
    <Dialog open onClose={onClose} title="Print what's due" initialFocus={checkedRef}
      icon={<Printer className="w-6 h-6 mt-2 text-blue-600 dark:text-blue-400" aria-hidden="true" />}
      footer={<>
        <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
        <PrimaryButton busy={working} onClick={() => void print()}>{working ? 'Saving…' : "Print what's due…"}</PrimaryButton>
      </>}>
      <div className="space-y-3 text-base text-slate-700 dark:text-slate-200">
        <p>Everything overdue, then everything due soon, worst first: the same list as What's due, in large black print.</p>
        <fieldset className="space-y-2">
          <legend className="font-semibold text-slate-900 dark:text-slate-100 mb-1">How far ahead?</legend>
          {PRINT_DUE_CHOICES.map(n => (
            <label key={n} className="flex items-center gap-3 px-3 rounded-lg border-2 border-slate-200 dark:border-slate-600 cursor-pointer has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50 dark:has-[:checked]:bg-blue-900/20" style={{ minHeight: 44 }}>
              <input ref={days === n ? checkedRef : undefined} type="radio" name="print-due-days" className="w-5 h-5" checked={days === n} onChange={() => setDays(n)} />
              <span>Next {n} days</span>
            </label>
          ))}
        </fieldset>
        {apptsOn && (
          <label className="flex items-center gap-3 min-h-[44px] cursor-pointer">
            <input type="checkbox" className="w-5 h-5" checked={appointments} onChange={e => setAppointments(e.target.checked)} />
            <span>Include {t('appointment', { many: true })}</span>
          </label>
        )}
      </div>
    </Dialog>
  )
}
