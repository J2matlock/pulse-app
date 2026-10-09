import React, { useRef } from 'react'
import type { Column } from '../../../shared/types'
import { IPC } from '../../../shared/ipc-channels'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { MoveToGridModal, BulkMoveToGridModal } from './MoveToGridModal'
import { useGridStore } from '../../stores/gridStore'
import { safeInvoke } from '../../utils/safeInvoke'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useVocab } from '../../hooks/useVocab'

// ── Archive dialog ───────────────────────────────────────────────────────────

export interface ArchiveDialogProps {
  archiveTarget: number | null
  archiveReason: string
  setArchiveReason: (v: string) => void
  onConfirm: () => void
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
  useFocusTrap(trapRef, archiveTarget != null)

  if (archiveTarget == null) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="archive-record-title">
      <div ref={trapRef} className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <h2 id="archive-record-title" className="text-lg font-semibold text-slate-800 dark:text-slate-100">Archive {t('record')}</h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          This {t('record')} will be hidden from the main grid. Reactivating brings everything back.
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
            onKeyDown={e => { if (e.key === 'Enter') onConfirm() }}
          />
        </div>
        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} className="btn-secondary" style={{ minHeight: 44 }}>
            Cancel
          </button>
          <button onClick={onConfirm} className="btn-primary" style={{ minHeight: 44 }}>
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
      title="Move to trash?"
      message={`This will move the ${t('record')} to Trash. Anything in Trash can be recovered within 30 days.`}
      confirmLabel="Move to Trash"
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
  return (
    <ConfirmDialog
      open={open}
      variant="typed"
      requiredPhrase={`TRASH ${selectedCount}`}
      title={`Move ${selectedCount} ${t('record', { count: selectedCount })} to trash?`}
      message={`This will move ${selectedCount} ${t('record', { count: selectedCount })} to Trash. You can recover them within 30 days. Type TRASH ${selectedCount} to confirm.`}
      confirmLabel="Move to Trash"
      onConfirm={async () => {
        const ids = Array.from(selectedRowIds)
        const result = await safeInvoke(IPC.ROW_BULK_ACTION, 'delete', ids)
        if (result.ok) {
          setSelectedRowIds(new Set())
          setBulkDeleteTarget(false)
          if (activeGridId) void useGridStore.getState().loadGrid(activeGridId)
        }
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
