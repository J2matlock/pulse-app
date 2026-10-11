/**
 * Edit a status or dropdown column's choices (audit 1.15 / G-02, G-36).
 * A real dialog (not a panel the header could clip), one box per choice so a
 * rename is a rename: it can carry the records that use it along, and a
 * removed choice says how many records still hold it.
 */
import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react'
import type { Column } from '../../../shared/types'
import { IPC } from '../../../shared/ipc-channels'
import { columnOptionLabels } from '../../../shared/stages'
import { safeInvoke, mustInvoke } from '../../utils/safeInvoke'
import { useUndoStore } from '../../stores/undoStore'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useVocab } from '../../hooks/useVocab'
import { friendlyError } from '../../utils/friendlyError'

interface Row { key: number; original: string | null; value: string }

interface Props {
  column: Column
  onClose: () => void
  /** After a save, so the list can reload */
  onSaved: (updated: number) => void | Promise<void>
}

export function EditOptionsDialog({ column, onClose, onSaved }: Props): React.ReactElement {
  const { t } = useVocab()
  const trapRef = useRef<HTMLDivElement>(null)
  useFocusTrap(trapRef, true)
  const nextKey = useRef(0)
  const [rows, setRows] = useState<Row[]>(() => columnOptionLabels(column).map(o => ({ key: nextKey.current++, original: o, value: o })))
  const [usage, setUsage] = useState<Record<string, number>>({})
  const [updateRecords, setUpdateRecords] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void safeInvoke(IPC.COLUMN_OPTION_USAGE, column.id).then(r => { if (r.ok) setUsage(r.data) })
  }, [column.id])

  const renames = rows.filter(r => r.original !== null && r.value.trim() && r.value.trim() !== r.original)
  const renamedRecords = renames.reduce((n, r) => n + (usage[r.original!] ?? 0), 0)
  const kept = new Set(rows.map(r => r.original).filter((o): o is string => o !== null))
  const removed = columnOptionLabels(column).filter(o => !kept.has(o))
  const removedRecords = removed.reduce((n, o) => n + (usage[o] ?? 0), 0)

  const set = (key: number, value: string) => setRows(rs => rs.map(r => r.key === key ? { ...r, value } : r))
  const move = (i: number, by: -1 | 1) => setRows(rs => {
    const j = i + by
    if (j < 0 || j >= rs.length) return rs
    const next = [...rs]; [next[i], next[j]] = [next[j]!, next[i]!]; return next
  })

  async function save() {
    const options = rows.map(r => r.value.trim()).filter(Boolean)
    if (options.length === 0) { setError('Add at least one choice.'); return }
    setSaving(true)
    const res = await safeInvoke(IPC.COLUMN_SET_OPTIONS, column.id, {
      options,
      renames: Object.fromEntries(renames.map(r => [r.original!, r.value.trim()])),
      updateRecords,
    })
    setSaving(false)
    if (!res.ok) { setError(friendlyError(res.error, "We couldn't save the choices. Please try again.")); return }
    const before = columnOptionLabels(column)
    const back = Object.fromEntries(renames.map(r => [r.value.trim(), r.original!]))
    const carried = res.data.updated > 0
    useUndoStore.getState().pushWithToast({
      id: crypto.randomUUID(),
      description: `Changed the choices for "${column.name}"`,
      timestamp: Date.now(),
      category: 'structural',
      icon: 'list',
      undo: async () => { await mustInvoke(IPC.COLUMN_SET_OPTIONS, column.id, { options: before, renames: back, updateRecords: carried }); await onSaved(0) },
      redo: async () => { await mustInvoke(IPC.COLUMN_SET_OPTIONS, column.id, { options, renames: Object.fromEntries(renames.map(r => [r.original!, r.value.trim()])), updateRecords: carried }); await onSaved(0) },
    })
    await onSaved(res.data.updated)
    onClose()
  }

  return createPortal(
    <div ref={trapRef} className="fixed inset-0 z-[200] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="edit-options-title"
      onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}>
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 p-6">
        <h2 id="edit-options-title" className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-3">
          Choices for “{column.name}”
        </h2>
        <ul className="space-y-2 max-h-80 overflow-y-auto">
          {rows.map((r, i) => (
            <li key={r.key} className="flex items-center gap-1">
              <input className="input flex-1" aria-label={`Choice ${i + 1}`} value={r.value} onChange={e => set(r.key, e.target.value)}
                autoFocus={i === rows.length - 1 && r.original === null} />
              {r.original !== null && (usage[r.original] ?? 0) > 0 && (
                <span className="text-sm text-slate-500 dark:text-slate-400 w-10 text-right" title={`${usage[r.original]} ${t('record', { count: usage[r.original] })} use this`}>{usage[r.original]}</span>
              )}
              <button type="button" className="hit-44 p-1 rounded text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 focus-visible:ring-3 focus-visible:ring-blue-500" aria-label={`Move ${r.value || 'choice'} up`} onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp className="w-4 h-4" /></button>
              <button type="button" className="hit-44 p-1 rounded text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 focus-visible:ring-3 focus-visible:ring-blue-500" aria-label={`Move ${r.value || 'choice'} down`} onClick={() => move(i, 1)} disabled={i === rows.length - 1}><ArrowDown className="w-4 h-4" /></button>
              <button type="button" className="hit-44 p-1 rounded text-slate-500 hover:text-red-600 focus-visible:ring-3 focus-visible:ring-blue-500" aria-label={`Remove ${r.value || 'choice'}`} onClick={() => setRows(rs => rs.filter(x => x.key !== r.key))}><X className="w-4 h-4" /></button>
            </li>
          ))}
        </ul>
        <button type="button" className="btn-secondary mt-3 inline-flex items-center gap-1.5" onClick={() => setRows(rs => [...rs, { key: nextKey.current++, original: null, value: '' }])}>
          <Plus className="w-4 h-4" /> Add a choice
        </button>

        {renamedRecords > 0 && (
          <label className="mt-4 flex items-start gap-2 text-base text-slate-700 dark:text-slate-200 cursor-pointer" style={{ minHeight: 44 }}>
            <input type="checkbox" className="mt-1 w-4 h-4" checked={updateRecords} onChange={e => setUpdateRecords(e.target.checked)} />
            <span>
              Also change {renamedRecords} {t('record', { count: renamedRecords })}: {renames.filter(r => (usage[r.original!] ?? 0) > 0).map(r => `${r.original} → ${r.value.trim()}`).join(', ')}
            </span>
          </label>
        )}
        {removedRecords > 0 && (
          <p className="mt-3 text-base text-amber-700 dark:text-amber-400" role="status">
            {removedRecords} {t('record', { count: removedRecords })} still {removedRecords === 1 ? 'uses' : 'use'} {removed.filter(o => usage[o]).map(o => `“${o}”`).join(', ')}. {removedRecords === 1 ? 'It keeps' : 'They keep'} the value until you change it.
          </p>
        )}
        {error && <p role="alert" className="mt-3 text-base text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex gap-3 justify-end mt-5">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={saving} onClick={() => void save()}>Save</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
