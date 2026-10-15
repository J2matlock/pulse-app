/**
 * "Change type…" for a column (audit 3.12 / G-19): pick the new type, see
 * how many values fit it before changing, and undo it afterwards.
 */
import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import toast from 'react-hot-toast'
import type { Column } from '../../../shared/types'
import { canNameRecords } from '../../../shared/types'
import { IPC } from '../../../shared/ipc-channels'
import { CHANGEABLE_TYPES, COLUMN_TYPE_INFO, columnTypeLabel } from '../../../shared/columnTypes'
import { safeInvoke, mustInvoke } from '../../utils/safeInvoke'
import { friendlyError } from '../../utils/friendlyError'
import { Dialog } from '../ui/Dialog'
import { PrimaryButton, SecondaryButton } from '../ui/Button'
import { useUndoStore } from '../../stores/undoStore'
import { useGridStore } from '../../stores/gridStore'

interface Props { column: Column; onClose: () => void }

export function ChangeTypeDialog({ column, onClose }: Props): React.ReactElement {
  // The name column can only become a type that can name records (no checkbox or notes)
  const choices = COLUMN_TYPE_INFO.filter(t => CHANGEABLE_TYPES.has(t.type) && t.type !== column.column_type
    && (column.is_name_column !== 1 || canNameRecords(t.type)))
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
    <Dialog open onClose={onClose} title={<>Change “{column.name}”</>} description={`It's ${columnTypeLabel(column.column_type)} now.`} size="md"
      footer={<>
        <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
        <PrimaryButton disabled={busy || !preview} onClick={() => void change()}>Change type</PrimaryButton>
      </>}>
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
    </Dialog>,
    document.body,
  )
}
