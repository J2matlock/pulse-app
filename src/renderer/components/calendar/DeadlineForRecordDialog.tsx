/**
 * "Deadline for a record" from the Calendar: pick a record and one of its
 * deadline columns, and the chosen day becomes when it's due. Main works the
 * rule backwards to the date to store; the cell is then saved the usual way
 * (history, undo, change notes and alerts as for any edit). Rules that can't
 * be worked backwards are listed but can't be chosen, with the reason.
 */
import React, { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { CalendarCheck, X } from 'lucide-react'
import { IPC } from '../../../shared/ipc-channels'
import type { DeadlineDayOption } from '../../../shared/calendar'
import { formatDue } from '../../../shared/deadlineEngine'
import { safeInvoke } from '../../utils/safeInvoke'
import { friendlyError } from '../../utils/friendlyError'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useVocab } from '../../hooks/useVocab'
import { useGridStore } from '../../stores/gridStore'
import { RecordSearchField, type PickedRecord } from './RecordSearchField'

const label = 'block text-base font-semibold text-slate-800 dark:text-slate-100 mb-1'
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
/** A column that can be set, and isn't already due that day */
const changes = (o: DeadlineDayOption) => !!o.value && o.value !== o.current?.slice(0, 10)
const shortDue = (v: string) => (DATE_RE.test(v.slice(0, 10)) ? formatDue(v.slice(0, 10)) : v)

export interface DeadlineForRecordDialogProps {
  date: string
  onClose: () => void
  /** After the deadline was saved */
  onSaved: () => void
}

export function DeadlineForRecordDialog({ date, onClose, onSaved }: DeadlineForRecordDialogProps): React.ReactElement {
  const { t } = useVocab(null)
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref, true, { onEscape: onClose })
  const [record, setRecord] = useState<PickedRecord | null>(null)
  const [due, setDue] = useState(date)
  const [options, setOptions] = useState<DeadlineDayOption[] | null>(null)
  const [columnId, setColumnId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!record || !DATE_RE.test(due)) { setOptions(null); return }
    let live = true
    void safeInvoke<DeadlineDayOption[]>(IPC.CALENDAR_DEADLINE_OPTIONS, record.rowId, due).then(r => {
      if (!live) return
      if (!r.ok) { setOptions([]); setError(friendlyError(r.error)); return }
      setError(null)
      setOptions(r.data)
      // Keep the choice while it still works; otherwise the only one that does
      setColumnId(prev => {
        if (prev !== null && r.data.some(o => o.columnId === prev && changes(o))) return prev
        const usable = r.data.filter(changes)
        return usable.length === 1 ? usable[0]!.columnId : null
      })
    })
    return () => { live = false }
  }, [record, due])

  const chosen = options?.find(o => o.columnId === columnId && changes(o)) ?? null

  async function save() {
    if (!record || !chosen?.value) return
    setSaving(true)
    try {
      const ok = await useGridStore.getState().updateCell(record.rowId, chosen.columnId, chosen.value, { columnName: chosen.columnName, recordName: record.name })
      if (!ok) return
      toast.success(`${record.name || '(unnamed)'}: ${chosen.columnName} is due ${formatDue(due)}`)
      onSaved()
      onClose()
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="deadline-for-record-title" onClick={e => e.stopPropagation()}
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white dark:bg-slate-800 shadow-xl border border-slate-200 dark:border-slate-700 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 id="deadline-for-record-title" className="text-lg font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <CalendarCheck className="w-5 h-5" aria-hidden="true" />Deadline for {t('record', { article: true })}
          </h2>
          <button type="button" aria-label="Close" onClick={onClose}
            className="hit-44 p-1.5 rounded-sm hover:bg-slate-100 dark:hover:bg-slate-700 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div>
          <span className={label}>{t('record', { cap: true })}</span>
          <RecordSearchField value={record} onChange={r => { setRecord(r); setColumnId(null) }} autoFocus />
        </div>

        <label className="block">
          <span className={label}>Due on</span>
          <input type="date" className="input w-auto" value={due} onChange={e => setDue(e.target.value)} />
        </label>

        {/* The shape of the form shows before a record is picked (UX D-30) */}
        {!record && (
          <div>
            <span className={`${label} text-slate-500 dark:text-slate-400`}>Which deadline</span>
            <select className="input w-full" disabled aria-label="Which deadline">
              <option>Pick {t('record', { article: true })} first</option>
            </select>
          </div>
        )}
        {record && options && (
          options.length === 0 && !error ? (
            <p className="text-base text-slate-600 dark:text-slate-300">{record.gridName ?? `This ${t('list')}`} has no deadline columns.</p>
          ) : (
            <fieldset className="space-y-2">
              <legend className={label}>Which deadline</legend>
              {options.map(o => (
                <div key={o.columnId} className={`rounded-lg border px-3 py-2 ${changes(o) ? 'border-slate-300 dark:border-slate-600' : 'border-dashed border-slate-300 dark:border-slate-600'}`}>
                  <label className={`flex items-start gap-3 ${changes(o) ? 'cursor-pointer' : 'cursor-not-allowed'}`} style={{ minHeight: 44 }}>
                    <input type="radio" name="deadline-column" className="mt-1 w-5 h-5" disabled={!changes(o)} checked={columnId === o.columnId}
                      onChange={() => setColumnId(o.columnId)} aria-labelledby={`deadline-col-${o.columnId}-name`} aria-describedby={`deadline-col-${o.columnId}`} />
                    <span className="flex-1">
                      <span id={`deadline-col-${o.columnId}-name`} className={`block text-base font-medium ${changes(o) ? 'text-slate-800 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400'}`}>{o.columnName}</span>
                      <span id={`deadline-col-${o.columnId}`} className="block text-sm text-slate-600 dark:text-slate-300">
                        {!o.value ? o.reason
                          : !changes(o) ? 'It\'s already due that day.'
                          // The column holds the date it's worked out from (often the last time it was done), not always the due date
                          : `${o.value === due ? `Sets it to ${formatDue(o.value)}` : `Sets it to ${formatDue(o.value)}, so it's due ${formatDue(due)}`}${o.current ? ` (now ${shortDue(o.current)})` : ''}.`}
                      </span>
                    </span>
                  </label>
                  {!o.value && o.nearest.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 pl-8 pb-1">
                      <span className="text-sm text-slate-600 dark:text-slate-300">It can be due:</span>
                      {o.nearest.map(d => (
                        <button key={d} type="button" className="btn-compact-secondary" onClick={() => { setDue(d); setColumnId(o.columnId) }}>{formatDue(d)}</button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </fieldset>
          )
        )}

        {error && <p role="alert" className="text-base text-red-700 dark:text-red-400">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={saving || !chosen} onClick={() => void save()}>Set deadline</button>
        </div>
      </div>
    </div>
  )
}
