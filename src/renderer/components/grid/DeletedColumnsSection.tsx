/**
 * Deleted columns: each waits 30 days with its values and can be restored, or
 * deleted forever (audit 5.2, Decision D1). In List settings for one list, and on
 * the Trash page for every list, with the list's name (persona study R3: the
 * Trash said "empty" while a column full of dates waited in List settings).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { RotateCcw, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { IPC } from '../../../shared/ipc-channels'
import { parseDbTimestamp } from '../../../shared/dates'
import { MS_PER_DAY } from '../../../shared/constants'
import { columnTypeLabel } from '../../../shared/columnTypes'
import { safeInvoke } from '../../utils/safeInvoke'
import { friendlyError } from '../../utils/friendlyError'
import { useGridStore } from '../../stores/gridStore'
import { useUndoStore } from '../../stores/undoStore'
import { ConfirmDialog } from '../shared/ConfirmDialog'

type Deleted = { id: number; grid_id: number; name: string; column_type: string; deleted_at: string; values: number }

interface Props {
  /** List settings: this list's deleted columns */
  gridId?: number
  /** The Trash page: every list's, each saying which list it's from */
  lists?: Array<{ id: number; name: string }>
  /** How many there are, so the Trash page knows whether it's empty */
  onCountChange?: (count: number) => void
}

export function DeletedColumnsSection({ gridId, lists, onCountChange }: Props): React.ReactElement | null {
  const [items, setItems] = useState<Deleted[]>([])
  const [forever, setForever] = useState<Deleted | null>(null)
  // The last one was just restored: the heading stays, so focus has somewhere to land
  const [allBack, setAllBack] = useState(false)
  const listRef = useRef<HTMLUListElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const showListName = lists !== undefined
  const gridIds = lists ? lists.map(l => l.id) : gridId !== undefined ? [gridId] : []
  const gridKey = gridIds.join(',')
  const listName = (id: number) => lists?.find(l => l.id === id)?.name ?? ''

  const load = useCallback(async (): Promise<Deleted[]> => {
    const ids = gridKey ? gridKey.split(',').map(Number) : []
    const results = await Promise.all(ids.map(id => safeInvoke(IPC.COLUMN_DELETED_LIST, id)))
    const next = results.flatMap(r => r.ok && Array.isArray(r.data) ? r.data : [])
    setItems(next)
    return next
  }, [gridKey])
  useEffect(() => { void load() }, [load])
  useEffect(() => { onCountChange?.(items.length) }, [items.length, onCountChange])

  async function restore(d: Deleted, index: number) {
    const r = await safeInvoke(IPC.COLUMN_RESTORE, d.id)
    if (!r.ok) { toast.error(friendlyError(r.error)); return }
    // The "Deleted column" undo step points at the Trash entry that's gone now; a failed step stays on
    // top of the stack, so every later Ctrl+Z would hit it (as TrashView does, Q-045)
    useUndoStore.getState().clear()
    toast.success(`"${d.name}" is back, with its values.`)
    if (useGridStore.getState().activeGridId === d.grid_id) await useGridStore.getState().loadGrid(d.grid_id)
    const left = await load()
    if (left.length === 0) setAllBack(true)
    // Focus stays here: on the next one's Restore, or the heading when none are left
    requestAnimationFrame(() => {
      const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('[data-restore-column]')
      const next = buttons?.[Math.min(index, left.length - 1)]
      if (next) next.focus()
      else headingRef.current?.focus()
    })
  }

  const headingId = `deleted-cols-${showListName ? 'all' : gridKey}`
  if (items.length === 0 && !allBack) return null
  const Heading = showListName ? 'h2' : 'h3'
  return (
    <section aria-labelledby={headingId} className={showListName ? 'px-6 pt-4 space-y-2' : 'space-y-2'} data-testid="deleted-columns">
      <Heading id={headingId} ref={headingRef} tabIndex={-1}
        className={`${showListName ? 'text-xl' : 'text-base'} font-semibold text-slate-800 dark:text-slate-100 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 rounded-lg`}>
        Deleted columns
      </Heading>
      <p className="text-base text-slate-500 dark:text-slate-400">{items.length ? 'Each is kept with its values for 30 days.' : 'All of them are back, with their values.'}</p>
      {items.length > 0 && <ul ref={listRef} className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg">
        {items.map((d, i) => {
          const left = Math.max(0, 30 - Math.floor((Date.now() - parseDbTimestamp(d.deleted_at).getTime()) / MS_PER_DAY))
          return (
            <li key={d.id} className="flex flex-wrap items-center gap-2 px-3 py-2" style={{ minHeight: 44 }}>
              <span className="flex-1 min-w-0 text-base text-slate-800 dark:text-slate-100">
                <strong>{d.name}</strong> · {showListName ? `from ${listName(d.grid_id)}` : columnTypeLabel(d.column_type)} · {d.values} value{d.values === 1 ? '' : 's'} · {left} day{left === 1 ? '' : 's'} left
              </span>
              <button type="button" data-restore-column="" className="btn-secondary inline-flex items-center gap-1.5" onClick={() => void restore(d, i)}>
                <RotateCcw className="w-4 h-4" />Restore
              </button>
              <button type="button" className="btn-secondary inline-flex items-center gap-1.5 text-red-600 dark:text-red-400" onClick={() => setForever(d)}>
                <Trash2 className="w-4 h-4" />Delete forever
              </button>
            </li>
          )
        })}
      </ul>}
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
            else useUndoStore.getState().clear()
          }
          setForever(null)
          await load()
        }}
        onCancel={() => setForever(null)}
      />
    </section>
  )
}
