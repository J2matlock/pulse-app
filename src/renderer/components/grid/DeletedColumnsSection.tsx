/**
 * Deleted columns, in List settings (audit 5.2, Decision D1): each waits 30
 * days with its values and can be restored, or deleted forever.
 */
import React, { useCallback, useEffect, useState } from 'react'
import { RotateCcw, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { IPC } from '../../../shared/ipc-channels'
import { parseDbTimestamp } from '../../../shared/dates'
import { MS_PER_DAY } from '../../../shared/constants'
import { columnTypeLabel } from '../../../shared/columnTypes'
import { safeInvoke } from '../../utils/safeInvoke'
import { friendlyError } from '../../utils/friendlyError'
import { useGridStore } from '../../stores/gridStore'
import { ConfirmDialog } from '../shared/ConfirmDialog'

type Deleted = { id: number; name: string; column_type: string; deleted_at: string; values: number }

export function DeletedColumnsSection({ gridId }: { gridId: number }): React.ReactElement | null {
  const [items, setItems] = useState<Deleted[]>([])
  const [forever, setForever] = useState<Deleted | null>(null)
  const load = useCallback(async () => {
    const r = await safeInvoke(IPC.COLUMN_DELETED_LIST, gridId)
    if (r.ok && Array.isArray(r.data)) setItems(r.data)
  }, [gridId])
  useEffect(() => { void load() }, [load])

  async function restore(d: Deleted) {
    const r = await safeInvoke(IPC.COLUMN_RESTORE, d.id)
    if (!r.ok) { toast.error(friendlyError(r.error)); return }
    toast.success(`"${d.name}" is back, with its values.`)
    if (useGridStore.getState().activeGridId === gridId) await useGridStore.getState().loadGrid(gridId)
    await load()
  }

  if (items.length === 0) return null
  return (
    <section aria-labelledby={`deleted-cols-${gridId}`} className="space-y-2">
      <h3 id={`deleted-cols-${gridId}`} className="text-base font-semibold text-slate-800 dark:text-slate-100">Deleted columns</h3>
      <p className="text-base text-slate-500 dark:text-slate-400">Each is kept with its values for 30 days.</p>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg">
        {items.map(d => {
          const left = Math.max(0, 30 - Math.floor((Date.now() - parseDbTimestamp(d.deleted_at).getTime()) / MS_PER_DAY))
          return (
            <li key={d.id} className="flex flex-wrap items-center gap-2 px-3 py-2" style={{ minHeight: 44 }}>
              <span className="flex-1 min-w-0 text-base text-slate-800 dark:text-slate-100">
                <strong>{d.name}</strong> · {columnTypeLabel(d.column_type)} · {d.values} value{d.values === 1 ? '' : 's'} · {left} day{left === 1 ? '' : 's'} left
              </span>
              <button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={() => void restore(d)}>
                <RotateCcw className="w-4 h-4" />Restore
              </button>
              <button type="button" className="btn-secondary inline-flex items-center gap-1.5 text-red-600 dark:text-red-400" onClick={() => setForever(d)}>
                <Trash2 className="w-4 h-4" />Delete forever
              </button>
            </li>
          )
        })}
      </ul>
      <ConfirmDialog
        open={forever !== null}
        variant="typed"
        requiredPhrase={forever?.name ?? ''}
        title={`Delete "${forever?.name}" forever?`}
        message={`The column and its ${forever?.values ?? 0} values are removed for good. This can't be undone.`}
        confirmLabel="Delete forever"
        onConfirm={async () => {
          if (forever) {
            const r = await safeInvoke(IPC.COLUMN_PURGE, forever.id)
            if (!r.ok) toast.error(friendlyError(r.error))
          }
          setForever(null)
          await load()
        }}
        onCancel={() => setForever(null)}
      />
    </section>
  )
}
