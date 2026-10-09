import React, { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'
import { pulseEvents } from '../../events'
import { loadNoteTracking, type NoteTracking } from '../../hooks/useNoteTracking'
import { NoteFormatsDialog } from '../profile/NoteFormatsDialog'
import { parseCustomFormats, type NoteFormat } from '../../../shared/noteFormats'
import { useVocab } from '../../hooks/useVocab'
import { useFeature } from '../../hooks/useFeature'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { ActivityTypesEditor } from './ActivityTypesEditor'
import { MeasuresEditor } from './MeasuresEditor'

/** Settings → Case notes: kinds of notes, time and mileage tracking, note formats. */
export function NotesSection(): React.ReactElement {
  const timeOn = useFeature('timeTracking')
  const mileageOn = useFeature('mileage')
  const measuresOn = useFeature('measures')
  const updateWorkspace = useWorkspaceStore(s => s.update)
  // `t` is taken by the tracking settings below
  const { t: w } = useVocab(null)
  const [t, setT] = useState<NoteTracking | null>(null)
  const [rateText, setRateText] = useState('')
  const [formats, setFormats] = useState<NoteFormat[] | null>(null)
  const closeFormats = useCallback(() => setFormats(null), [])

  useEffect(() => {
    void loadNoteTracking().then(s => { setT(s); setRateText(s.mileageRate ? String(s.mileageRate) : '') })
  }, [])

  async function save(key: string, value: string, patch: Partial<NoteTracking>) {
    setT(prev => prev ? { ...prev, ...patch } : prev)
    const res = await safeInvoke(IPC.SETTINGS_UPDATE, key, value)
    if (res.ok) pulseEvents.emit('note-tracking:changed')
  }

  async function setFeature(key: 'timeTracking' | 'mileage' | 'measures', on: boolean) {
    try {
      await updateWorkspace({ features: { [key]: on } })
      pulseEvents.emit('note-tracking:changed')
    } catch {
      toast.error("We couldn't change that setting. Please try again.")
    }
  }

  async function openFormats() {
    const res = await safeInvoke<string | null>(IPC.SETTINGS_GET, 'note_formats')
    setFormats(res.ok ? parseCustomFormats(res.data) : [])
  }

  if (!t) return <p className="text-base text-slate-500 dark:text-slate-400">Loading…</p>

  // Same switches as Settings → Features
  const toggle = (feature: 'timeTracking' | 'mileage' | 'measures', on: boolean, title: string, desc: string) => (
    <label className="flex items-start gap-3 cursor-pointer select-none" style={{ minHeight: 44 }}>
      <input type="checkbox" checked={on} onChange={e => void setFeature(feature, e.target.checked)}
        className="mt-1 w-5 h-5 rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-3 focus:ring-blue-500 flex-shrink-0" />
      <span>
        <span className="block text-base font-medium text-slate-800 dark:text-slate-100">{title}</span>
        <span className="block text-sm text-slate-600 dark:text-slate-300">{desc}</span>
      </span>
    </label>
  )

  return (
    <div className="space-y-6">
      <ActivityTypesEditor />

      <section className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-700">
        <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Time and mileage</h2>
        {toggle('timeTracking', timeOn, `Record time on ${w('activity', { many: true })}`, 'Adds a Minutes box to each note. Monthly totals and service units appear under Export → Totals.')}
        {timeOn && (
          <label className="flex items-center gap-2 pl-8 text-base text-slate-700 dark:text-slate-200">
            One unit is
            <select className="input w-auto" value={t.unitMinutes}
              onChange={e => void save('unit_minutes', e.target.value, { unitMinutes: Number(e.target.value) })}>
              {[15, 30, 60].map(n => <option key={n} value={n}>{n} minutes</option>)}
            </select>
            <span className="text-sm text-slate-600 dark:text-slate-300">(a unit counts from half: 8 of 15 minutes = 1 unit)</span>
          </label>
        )}
        {toggle('mileage', mileageOn, `Record mileage on ${w('activity', { many: true })}`, 'Adds a Miles box to each note, for your monthly mileage claim.')}
        {mileageOn && (
          <label className="flex items-center gap-2 pl-8 text-base text-slate-700 dark:text-slate-200">
            Rate per mile $
            <input className="input w-28" inputMode="decimal" placeholder="e.g. 0.70" value={rateText}
              onChange={e => setRateText(e.target.value)}
              onBlur={() => {
                const n = Number(rateText)
                const value = rateText.trim() === '' || !(n > 0) ? '' : String(Math.round(n * 1000) / 1000)
                setRateText(value)
                void save('mileage_rate', value, { mileageRate: value ? Number(value) : null })
              }} />
            <span className="text-sm text-slate-600 dark:text-slate-300">(optional; adds amounts to the export)</span>
          </label>
        )}
      </section>

      <section className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-700">
        <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Your own numbers</h2>
        {toggle('measures', measuresOn, `Record your own numbers on ${w('activity', { many: true })}`, 'Like labor hours, parts cost or boxes delivered.')}
        {measuresOn && <MeasuresEditor />}
      </section>

      <section className="space-y-2 pt-4 border-t border-slate-200 dark:border-slate-700">
        <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Note formats</h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">DAP, SOAP, BIRP and contact notes are built in. Add your own with the sections your agency uses.</p>
        <button type="button" className="btn-secondary" onClick={() => void openFormats()}>Edit note formats…</button>
      </section>
      {formats && <NoteFormatsDialog formats={formats} onClose={closeFormats} />}
    </div>
  )
}
