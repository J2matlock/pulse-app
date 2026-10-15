import React, { useEffect, useState } from 'react'
import type { Column } from '../../../shared/types'
import { IPC } from '../../../shared/ipc-channels'
import { MoveToGridModal, BulkMoveToGridModal } from './MoveToGridModal'
import { useGridStore } from '../../stores/gridStore'
import { safeInvoke, mustInvoke } from '../../utils/safeInvoke'
import { useUndoStore } from '../../stores/undoStore'
import toast from 'react-hot-toast'
import { friendlyError } from '../../utils/friendlyError'
import { useVocab } from '../../hooks/useVocab'
import { pulseEvents } from '../../events'
import { wordNow } from '../../utils/vocab'

// ── Upcoming appointments (archive, handoff) ─────────────────────────────────

/** How many upcoming appointments these records have (0 when it can't tell) */
export function useUpcomingAppointments(rowIds: number[] | null): number {
  const [count, setCount] = useState(0)
  const key = rowIds?.join(',') ?? ''
  useEffect(() => {
    setCount(0)
    if (!key) return
    let live = true
    void safeInvoke<number>(IPC.APPT_UPCOMING_COUNT, key.split(',').map(Number)).then(res => {
      if (live && res.ok) setCount(res.data)
    })
    return () => { live = false }
  }, [key])
  return count
}

/** "Also cancel its 6 upcoming appointments" (ticked by default) */
export function CancelAppointmentsCheckbox({ count, checked, onChange, many = false }: {
  count: number; checked: boolean; onChange: (v: boolean) => void; many?: boolean
}): React.ReactElement | null {
  const { t } = useVocab()
  if (count === 0) return null
  return (
    <label className="flex items-start gap-3 min-h-[44px] text-base text-slate-700 dark:text-slate-200 cursor-pointer">
      <input type="checkbox" className="w-5 h-5 mt-0.5 shrink-0" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span>Also cancel {many ? 'their' : 'its'} {count} upcoming {t('appointment', { count })}</span>
    </label>
  )
}

// ── Move to Grid modal ──────────────────────────────────────────────────────

export interface MoveToGridDialogProps {
  moveToGridTarget: number | null
  activeGridId: number | null
  columns: Column[]
  setMoveToGridTarget: (v: number | null) => void
}

export function MoveToGridDialog({
  moveToGridTarget,
  activeGridId,
  columns,
  setMoveToGridTarget,
}: MoveToGridDialogProps): React.ReactElement | null {
  if (moveToGridTarget === null) return null
  return (
    <MoveToGridModal
      rowId={moveToGridTarget}
      sourceGridId={activeGridId!}
      sourceColumns={columns}
      onDone={() => {
        setMoveToGridTarget(null)
        if (activeGridId) void useGridStore.getState().loadGrid(activeGridId)
      }}
      onCancel={() => setMoveToGridTarget(null)}
    />
  )
}

// ── Bulk move to the Trash ───────────────────────────────────────────────────

/**
 * Move several records to the Trash at once, as one undo step with the Undo
 * toast. It doesn't ask first (Q4): the bulk bar's button names the count, the
 * Trash keeps them 30 days, and Undo (toast, top bar, Ctrl+Z) brings them back.
 * Typing a word stays for deleting forever (G-34). Returns false when it failed.
 */
export async function trashRows(ids: number[]): Promise<boolean> {
  if (ids.length === 0) return false
  const result = await safeInvoke(IPC.ROW_BULK_ACTION, 'delete', ids)
  if (!result.ok) { toast.error(friendlyError(result.error)); return false }
  pulseEvents.emit('records:trashed', { rowIds: ids })
  const reload = async () => { const g = useGridStore.getState().activeGridId; if (g) await useGridStore.getState().loadGrid(g) }
  void reload()
  const label = `${ids.length} ${wordNow('record', { count: ids.length })}`
  useUndoStore.getState().pushWithToast({
    id: crypto.randomUUID(),
    description: `Moved ${label} to the Trash`,
    timestamp: Date.now(),
    category: 'structural',
    icon: 'Trash2',
    undo: async () => { await mustInvoke(IPC.ROW_BULK_ACTION, 'restore', ids); await reload() },
    redo: async () => { await mustInvoke(IPC.ROW_BULK_ACTION, 'delete', ids); await reload() },
  })
  return true
}

// ── Bulk move to grid modal ──────────────────────────────────────────────────

export interface BulkMoveDialogProps {
  open: boolean
  selectedRowIds: Set<number>
  activeGridId: number | null
  columns: Column[]
  setSelectedRowIds: React.Dispatch<React.SetStateAction<Set<number>>>
  setBulkMoveTarget: (v: boolean) => void
}

export function BulkMoveDialog({
  open,
  selectedRowIds,
  activeGridId,
  columns,
  setSelectedRowIds,
  setBulkMoveTarget,
}: BulkMoveDialogProps): React.ReactElement | null {
  if (!open || selectedRowIds.size === 0) return null
  const ids = Array.from(selectedRowIds)
  return (
    <BulkMoveToGridModal
      rowIds={ids}
      sourceGridId={activeGridId!}
      sourceColumns={columns}
      onDone={() => {
        setSelectedRowIds(new Set())
        setBulkMoveTarget(false)
        if (activeGridId) void useGridStore.getState().loadGrid(activeGridId)
      }}
      onCancel={() => setBulkMoveTarget(false)}
    />
  )
}
