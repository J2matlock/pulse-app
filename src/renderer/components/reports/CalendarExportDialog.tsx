import React, { useEffect, useState } from 'react'
import { CalendarPlus } from 'lucide-react'
import toast from 'react-hot-toast'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'
import { Dialog } from '../ui/Dialog'
import { PrimaryButton, SecondaryButton } from '../ui/Button'
import { useVocab } from '../../hooks/useVocab'
import { useGridStore } from '../../stores/gridStore'
import { useShallow } from 'zustand/react/shallow'
import { isPersonKind } from '../../../shared/types'
import { useFeature } from '../../hooks/useFeature'

/** Save upcoming deadlines and follow-ups as a calendar file for Outlook or Google Calendar. */
export function CalendarExportDialog({ onClose }: { onClose: () => void }): React.ReactElement {
  const { t } = useVocab(null)
  const noteText = `${t('activity', { cap: true })} text is never included.`
  // Only lists of people use initials; things and jobs are shown by name
  const kinds = useGridStore(useShallow(s => s.grids.map(g => isPersonKind(g.record_kind))))
  const anyPeople = kinds.length === 0 || kinds.some(Boolean)
  const anyOther = kinds.some(k => !k)
  const apptsOn = useFeature('appointments')
  const [fullNames, setFullNames] = useState(false)
  const [working, setWorking] = useState(false)

  useEffect(() => {
    void safeInvoke<string | null>(IPC.SETTINGS_GET, 'ics_full_names').then(r => { if (r.ok) setFullNames(r.data === 'true') })
  }, [])

  async function save() {
    setWorking(true)
    try {
      void safeInvoke(IPC.SETTINGS_UPDATE, 'ics_full_names', fullNames ? 'true' : 'false')
      const res = await safeInvoke<{ filePath: string; count: number } | null>(IPC.EXPORT_ICS, { fullNames })
      if (!res.ok) { toast.error("We couldn't save the calendar file. Try again."); return }
      if (res.data) { toast.success(`Saved ${res.data.count} event${res.data.count === 1 ? '' : 's'}. Now import the file into your calendar.`); onClose() }
    } finally {
      setWorking(false)
    }
  }

  return (
    <Dialog open onClose={onClose} size="lg" title="Add to your calendar"
      icon={<CalendarPlus className="w-6 h-6 mt-1 text-blue-600 dark:text-blue-400" aria-hidden="true" />}
      footer={<>
        <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
        <PrimaryButton disabled={working} onClick={() => void save()}>{working ? 'Saving…' : 'Save calendar file…'}</PrimaryButton>
      </>}>
      <div className="space-y-3 text-base text-slate-700 dark:text-slate-200">
        <p>Saves a calendar file with your {apptsOn ? `${t('appointment', { many: true })}, ` : ''}events, deadlines and follow-ups for the next six months, each with a reminder. Open it in Outlook, or import it in Google Calendar (Settings → Import).</p>
        {anyPeople && !anyOther && <p>{t('record', { many: true, cap: true })} are shown by initials, like <strong>J.S.: Annual Review</strong>. {noteText}</p>}
        {anyPeople && anyOther && <p>People are shown by initials, like <strong>J.S.: Annual Review</strong>; things and jobs by name. {noteText}</p>}
        {!anyPeople && <p>Each one is shown by name. {noteText}</p>}
        <label className="flex items-start gap-3 min-h-[44px] cursor-pointer">
          <input type="checkbox" className="mt-1 w-5 h-5" checked={fullNames} onChange={e => setFullNames(e.target.checked)} />
          {anyPeople ? (
            <span>
              Use full {t('record')} names and include task and event titles
              <span className="block text-sm text-slate-600 dark:text-slate-300">Only if your workplace allows {t('record')} names in your work calendar.</span>
            </span>
          ) : (
            <span>Include task and event titles</span>
          )}
        </label>
        <p className="text-sm text-slate-600 dark:text-slate-300">The calendar doesn't update by itself. Save a new file when things change; importing it again updates the same events{apptsOn ? ` and cancels ${t('appointment', { many: true })} you've cancelled or removed` : ''}.</p>
      </div>
    </Dialog>
  )
}
