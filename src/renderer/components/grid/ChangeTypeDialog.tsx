/**
 * "Change type…" for a column (audit 3.12 / G-19): pick the new type, see
 * how many values fit it before changing, and undo it afterwards.
 */
import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import toast from 'react-hot-toast'
import type { Column } from '../../../shared/types'
import { IPC } from '../../../shared/ipc-channels'
import { CHANGEABLE_TYPES, COLUMN_TYPE_INFO, columnTypeLabel } from '../../../shared/columnTypes'
import { safeInvoke, mustInvoke } from '../../utils/safeInvoke'
import { friendlyError } from '../../utils/friendlyError'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useUndoStore } from '../../stores/undoStore'
import { useGridStore } from '../../stores/gridStore'

interface Props { column: Column; onClose: () => void }

export function ChangeTypeDialog({ column, onClose }: Props): React.ReactElement {
  const trapRef = useRef<HTMLDivElement>(null)
  useFocusTrap(trapRef, true)
  const choices = COLUMN_TYPE_INFO.filter(t => CHANGEABLE_TYPES.has(t.type) && t.type !== column.column_type)
  const [to, setTo] = useState(choices[0]?.type ?? 'text')
  const [preview, setPreview] = useState<{ total: number; clean: number; examples: string[] } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setPreview(null)
    void safeInvoke(IPC.COLUMN_TYPE_PREVIEW, column.id, to).then(r => { if (r.ok) setPreview(r.data) })
  }, [column.id, to])

  async function change() {
    setBusy(true)
    const res = await safeInvoke(IPC.COLUMN_CHANGE_TYPE, column.id, to)
    setBusy(false)
    if (!res.ok) { toast.error(friendlyError(res.error)); return }
    const snap = res.data
    const reload = async () => { const g = useGridStore.getState().activeGridId; if (g) await useGridStore.getState().loadGrid(g) }
    await reload()
    useUndoStore.getState().pushWithToast({
      id: crypto.randomUUID(),
      description: `Changed "${column.name}" to ${columnTypeLabel(to)}`,
      timestamp: Date.now(),
      category: 'structural',
      icon: 'type',
      undo: async () => { await mustInvoke(IPC.COLUMN_CHANGE_TYPE_UNDO, column.id, snap); await reload() },
      redo: async () => { await mustInvoke(IPC.COLUMN_CHANGE_TYPE, column.id, to); await reload() },
    })
    onClose()
  }

  const info = COLUMN_TYPE_INFO.find(t => t.type === to)
  const misfits = preview ? preview.total - preview.clean : 0
  return createPortal(
    <div ref={trapRef} className="fixed inset-0 z-[200] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="change-type-title"
      onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}>
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 p-6">
        <h2 id="change-type-title" className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-1">Change “{column.name}”</h2>
        <p className="text-base text-slate-600 dark:text-slate-300 mb-4">It's {columnTypeLabel(column.column_type)} now.</p>
        <label htmlFor="change-type-to" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">New type</label>
        <select id="change-type-to" className="input w-full" value={to} onChange={e => setTo(e.target.value as typeof to)}>
          {choices.map(c => <option key={c.type} value={c.type}>{c.label}</option>)}
        </select>
        {info && <p className="mt-1 text-base text-slate-500 dark:text-slate-400">{info.description}</p>}
        <div className="mt-4 text-base text-slate-700 dark:text-slate-200" role="status" data-testid="type-preview">
          {!preview ? 'Checking the values…'
            : preview.total === 0 ? 'This column is empty, so nothing needs converting.'
            : misfits === 0 ? `All ${preview.total} values fit.`
            : <>
                {preview.clean} of {preview.total} values fit. The other {misfits} stay as they are, and may not show or sort as {columnTypeLabel(to)}
                {preview.examples.length > 0 && <>, for example: {preview.examples.map(e => `“${e}”`).join(', ')}</>}.
              </>}
        </div>
        <div className="flex gap-3 justify-end mt-5">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={busy || !preview} onClick={() => void change()}>Change type</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
