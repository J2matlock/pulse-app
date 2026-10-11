/**
 * Settings → Alerts → "Reminders": a desktop notification each morning with
 * how much is due (W11 §2). Shown when the Reminders feature is on.
 */
import React, { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { BellRing } from 'lucide-react'
import { IPC } from '../../../shared/ipc-channels'
import type { ReminderSettings } from '../../../shared/ipc-contract'
import { safeInvoke } from '../../utils/safeInvoke'
import { useFeature } from '../../hooks/useFeature'
import { useVocab } from '../../hooks/useVocab'
import { friendlyError } from '../../utils/friendlyError'

const LEADS = [0, 5, 10, 15, 30, 60]

export function RemindersSection(): React.ReactElement {
  const [settings, setSettings] = useState<ReminderSettings | null>(null)
  const apptsOn = useFeature('appointments')
  const { t } = useVocab(null)

  useEffect(() => {
    void safeInvoke<ReminderSettings>(IPC.REMINDERS_GET).then(r => { if (r.ok) setSettings(r.data) })
  }, [])

  async function save(patch: Partial<ReminderSettings>) {
    const res = await safeInvoke<ReminderSettings>(IPC.REMINDERS_SET, patch)
    if (res.ok) setSettings(res.data)
    else toast.error(friendlyError(res.error))
  }

  async function test() {
    const res = await safeInvoke(IPC.REMINDERS_TEST)
    if (!res.ok) toast.error(friendlyError(res.error), { duration: 8000 })
  }

  return (
    <section className="space-y-3 pb-4 border-b border-slate-200 dark:border-slate-700" aria-labelledby="reminders-heading">
      <h2 id="reminders-heading" className="text-xl font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
        <BellRing className="w-5 h-5" aria-hidden="true" />Reminders
      </h2>
      <label className="flex items-start gap-3 cursor-pointer select-none" style={{ minHeight: 44 }}>
        <input type="checkbox" className="mt-1 w-5 h-5 flex-shrink-0" disabled={!settings} checked={!!settings?.dailyEnabled}
          onChange={e => void save({ dailyEnabled: e.target.checked })} />
        <span>
          <span className="block text-base font-medium text-slate-800 dark:text-slate-100">Desktop reminder each morning</span>
          <span className="block text-sm text-slate-600 dark:text-slate-300">
            A notification like "3 due today, 1 overdue" while Pulse is open and unlocked. It never shows names.
          </span>
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-3 pl-8">
        <label className="flex items-center gap-2 text-base text-slate-700 dark:text-slate-200">
          At
          <input type="time" className="input w-auto" disabled={!settings?.dailyEnabled} value={settings?.dailyTime ?? '08:30'}
            onChange={e => { if (/^\d{2}:\d{2}$/.test(e.target.value)) void save({ dailyTime: e.target.value }) }} />
        </label>
        <button type="button" className="btn-secondary" onClick={() => void test()}>Send a test reminder</button>
      </div>
      {apptsOn && (
        <>
          <label className="flex flex-wrap items-center gap-2 text-base text-slate-700 dark:text-slate-200">
            Before each {t('appointment')}
            <select className="input w-auto" disabled={!settings} value={settings?.apptLeadMinutes ?? 0}
              onChange={e => void save({ apptLeadMinutes: Number(e.target.value) })}>
              {LEADS.map(m => <option key={m} value={m}>{m === 0 ? 'No reminder' : m === 60 ? '1 hour before' : `${m} minutes before`}</option>)}
            </select>
          </label>
          <label className="flex items-start gap-3 cursor-pointer select-none" style={{ minHeight: 44 }}>
            <input type="checkbox" className="mt-1 w-5 h-5 flex-shrink-0" disabled={!settings || settings.apptLeadMinutes === 0} checked={!!settings?.showNames}
              onChange={e => void save({ showNames: e.target.checked })} />
            <span>
              <span className="block text-base font-medium text-slate-800 dark:text-slate-100">Show who it's with</span>
              <span className="block text-sm text-slate-600 dark:text-slate-300">
                Adds initials (or a thing's name), like "{t('appointment', { cap: true })} at 3:00 pm with J.S." Names can appear on your lock screen and in notification history.
              </span>
            </span>
          </label>
        </>
      )}
    </section>
  )
}
