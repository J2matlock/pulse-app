import React, { useEffect, useRef, useState } from 'react'
import { CalendarPlus, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useVocab } from '../../hooks/useVocab'
import { useGridStore } from '../../stores/gridStore'
import { useShallow } from 'zustand/react/shallow'
import { isPersonKind } from '../../../shared/types'

/** Save upcoming deadlines and follow-ups as a calendar file for Outlook or Google Calendar. */
export function CalendarExportDialog({ onClose }: { onClose: () => void }): React.ReactElement {
  const { t } = useVocab(null)
  // Only lists of people use initials; things and jobs are shown by name
  const kinds = useGridStore(useShallow(s => s.grids.map(g => isPersonKind(g.record_kind))))
  const anyPeople = kinds.length === 0 || kinds.some(Boolean)
  const anyOther = kinds.some(k => !k)
  const trapRef = useRef<HTMLDivElement>(null)
  useFocusTrap(trapRef, true)
  const [fullNames, setFullNames] = useState(false)
  const [working, setWorking] = useState(false)

  useEffect(() => {
    void safeInvoke<string | null>(IPC.SETTINGS_GET, 'ics_full_names').then(r => { if (r.ok) setFullNames(r.data === 'true') })
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

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
    <div className="fixed inset-0 z-[200] flex items-center-safe justify-center bg-black/50 p-4 overflow-y-auto" onClick={onClose}>
      <div ref={trapRef} role="dialog" aria-modal="true" aria-labelledby="ics-title" onClick={e => e.stopPropagation()}
        className="w-full max-w-lg rounded-xl bg-white dark:bg-slate-800 shadow-xl border border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <CalendarPlus className="w-6 h-6 text-blue-600 dark:text-blue-400" aria-hidden="true" />
          <h2 id="ics-title" className="text-xl font-semibold text-slate-900 dark:text-slate-100 flex-1">Add to your calendar</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="hit-44 p-2 rounded-sm text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-6 py-5 space-y-3 text-base text-slate-700 dark:text-slate-200">
          <p>Saves a calendar file with your deadlines and follow-ups for the next six months, each with a reminder the day before. Open it in Outlook, or import it in Google Calendar (Settings → Import).</p>
          {anyPeople && !anyOther && <p>{t('record', { many: true, cap: true })} are shown by initials, like <strong>J.S.: Annual Review</strong>. Note text is never included.</p>}
          {anyPeople && anyOther && <p>People are shown by initials, like <strong>J.S.: Annual Review</strong>; things and jobs by name. Note text is never included.</p>}
          {!anyPeople && <p>Each one is shown by name. Note text is never included.</p>}
          <label className="flex items-start gap-3 min-h-[44px] cursor-pointer">
            <input type="checkbox" className="mt-1 w-5 h-5" checked={fullNames} onChange={e => setFullNames(e.target.checked)} />
            {anyPeople ? (
              <span>
                Use full {t('record')} names and include task titles
                <span className="block text-sm text-slate-600 dark:text-slate-300">Only if your workplace allows {t('record')} names in your work calendar.</span>
              </span>
            ) : (
              <span>Include task titles</span>
            )}
          </label>
          <p className="text-sm text-slate-600 dark:text-slate-300">The calendar doesn't update by itself. Save a new file when things change; importing it again updates the same events.</p>
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-200 dark:border-slate-700">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={working} onClick={() => void save()}>{working ? 'Saving…' : 'Save calendar file…'}</button>
        </div>
      </div>
    </div>
  )
}
