import React, { useEffect, useRef, useState } from 'react'
import type { Column } from '../../../shared/types'
import { IPC } from '../../../shared/ipc-channels'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { MoveToGridModal, BulkMoveToGridModal } from './MoveToGridModal'
import { useGridStore } from '../../stores/gridStore'
import { safeInvoke, mustInvoke } from '../../utils/safeInvoke'
import { useUndoStore } from '../../stores/undoStore'
import toast from 'react-hot-toast'
import { friendlyError } from '../../utils/friendlyError'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useVocab } from '../../hooks/useVocab'
import { pulseEvents } from '../../events'

// ── Archive dialog ───────────────────────────────────────────────────────────

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

export interface ArchiveDialogProps {
  archiveTarget: number | null
  archiveReason: string
  setArchiveReason: (v: string) => void
  onConfirm: (opts: { cancelAppointments: boolean }) => void
  onCancel: () => void
}

export function ArchiveDialog({
  archiveTarget,
  archiveReason,
  setArchiveReason,
  onConfirm,
  onCancel,
}: ArchiveDialogProps): React.ReactElement | null {
  const { t } = useVocab()
  const trapRef = useRef<HTMLDivElement>(null)
  useFocusTrap(trapRef, archiveTarget != null, { onEscape: onCancel })
  const upcoming = useUpcomingAppointments(archiveTarget == null ? null : [archiveTarget])
  const [cancelAppts, setCancelAppts] = useState(true)
  useEffect(() => { setCancelAppts(true) }, [archiveTarget])
  const confirm = () => onConfirm({ cancelAppointments: upcoming > 0 && cancelAppts })

  if (archiveTarget == null) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="archive-record-title">
      <div ref={trapRef} className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <h2 id="archive-record-title" className="text-lg font-semibold text-slate-800 dark:text-slate-100">Archive {t('record')}</h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          This {t('record')} will be hidden from the {t('list')}. Reactivating brings everything back.
        </p>
        <div>
          <label htmlFor="archive-reason" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1">
            Reason (optional)
          </label>
          <input
            id="archive-reason"
            autoFocus
            className="input w-full"
            style={{ minHeight: 44 }}
            value={archiveReason}
            onChange={e => setArchiveReason(e.target.value)}
            placeholder="e.g. Case closed, Transferred, etc."
            onKeyDown={e => { if (e.key === 'Enter') confirm() }}
          />
        </div>
        <CancelAppointmentsCheckbox count={upcoming} checked={cancelAppts} onChange={setCancelAppts} />
        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} className="btn-secondary" style={{ minHeight: 44 }}>
            Cancel
          </button>
          <button onClick={confirm} className="btn-primary" style={{ minHeight: 44 }}>
            Archive
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Delete row confirmation ──────────────────────────────────────────────────

export interface DeleteRowDialogProps {
  deleteTarget: number | null
  deleteRow: (id: number) => Promise<void>
  setDeleteTarget: (v: number | null) => void
  setSelectedRowIds: React.Dispatch<React.SetStateAction<Set<number>>>
}

export function DeleteRowDialog({
  deleteTarget,
  deleteRow,
  setDeleteTarget,
  setSelectedRowIds,
}: DeleteRowDialogProps): React.ReactElement {
  const { t } = useVocab()
  return (
    <ConfirmDialog
      open={deleteTarget != null}
      title={`Move this ${t('record')} to the Trash?`}
      message="You can undo this, or bring it back from the Trash within 30 days."
      confirmLabel="Move to the Trash"
      onConfirm={async () => {
        if (deleteTarget != null) {
          await deleteRow(deleteTarget)
          setSelectedRowIds(prev => {
            if (!prev.has(deleteTarget)) return prev
            const next = new Set(prev)
            next.delete(deleteTarget)
            return next
          })
        }
        setDeleteTarget(null)
      }}
      onCancel={() => setDeleteTarget(null)}
    />
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

// ── Bulk delete confirmation ─────────────────────────────────────────────────

export interface BulkDeleteDialogProps {
  open: boolean
  selectedCount: number
  selectedRowIds: Set<number>
  activeGridId: number | null
  setSelectedRowIds: React.Dispatch<React.SetStateAction<Set<number>>>
  setBulkDeleteTarget: (v: boolean) => void
}

export function BulkDeleteDialog({
  open,
  selectedCount,
  selectedRowIds,
  activeGridId,
  setSelectedRowIds,
  setBulkDeleteTarget,
}: BulkDeleteDialogProps): React.ReactElement {
  const { t } = useVocab()
  // Trash can be emptied later, so this is a plain confirm with one Undo; typing is for permanent deletes (G-34)
  return (
    <ConfirmDialog
      open={open}
      title={`Move ${selectedCount} ${t('record', { count: selectedCount })} to the Trash?`}
      message={`You can undo this, or bring them back from the Trash within 30 days.`}
      confirmLabel="Move to the Trash"
      onConfirm={async () => {
        const ids = Array.from(selectedRowIds)
        const result = await safeInvoke(IPC.ROW_BULK_ACTION, 'delete', ids)
        if (!result.ok) { toast.error(friendlyError(result.error)); return }
        pulseEvents.emit('records:trashed', { rowIds: ids })
        setSelectedRowIds(new Set())
        setBulkDeleteTarget(false)
        const reload = async () => { const g = useGridStore.getState().activeGridId; if (g) await useGridStore.getState().loadGrid(g) }
        if (activeGridId) void useGridStore.getState().loadGrid(activeGridId)
        const label = `${ids.length} ${t('record', { count: ids.length })}`
        useUndoStore.getState().pushWithToast({
          id: crypto.randomUUID(),
          description: `Moved ${label} to the Trash`,
          timestamp: Date.now(),
          category: 'structural',
          icon: 'Trash2',
          undo: async () => { await mustInvoke(IPC.ROW_BULK_ACTION, 'restore', ids); await reload() },
          redo: async () => { await mustInvoke(IPC.ROW_BULK_ACTION, 'delete', ids); await reload() },
        })
      }}
      onCancel={() => setBulkDeleteTarget(false)}
    />
  )
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
