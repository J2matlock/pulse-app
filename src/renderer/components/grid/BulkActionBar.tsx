import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import type { GridRow, Column, AcuityLevel } from '../../../shared/types'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke, mustInvoke } from '../../utils/safeInvoke'
import { useGridStore } from '../../stores/gridStore'
import { useUndoStore } from '../../stores/undoStore'
import { pulseEvents } from '../../events'
import { getClientName } from '../../utils/clientName'
import { useVocab } from '../../hooks/useVocab'
import { useFeature } from '../../hooks/useFeature'
import { BatchDocumentsDialog } from '../documents/BatchDocumentsDialog'
import { ArchiveDialog } from './GridDialogs'

export interface BulkActionBarProps {
  selectedRowIds: Set<number>
  rowById: Map<number, GridRow>
  columns: Column[]
  activeGridId: number | null
  acuityEnabled: boolean
  acuityLevels: AcuityLevel[]
  bulkSetRowAcuityLevel: (rowIds: number[], levelId: number | null) => Promise<void>
  setSelectedRowIds: React.Dispatch<React.SetStateAction<Set<number>>>
  setBulkDeleteTarget: React.Dispatch<React.SetStateAction<boolean>>
  setBulkMoveTarget: React.Dispatch<React.SetStateAction<boolean>>
  setBulkEditOpen: React.Dispatch<React.SetStateAction<boolean>>
}

export function BulkActionBar({
  selectedRowIds,
  rowById,
  columns,
  activeGridId,
  acuityEnabled,
  acuityLevels,
  bulkSetRowAcuityLevel,
  setSelectedRowIds,
  setBulkDeleteTarget,
  setBulkMoveTarget,
  setBulkEditOpen,
}: BulkActionBarProps): React.ReactElement {
  const lettersOn = useFeature('letters')
  const [batchDocs, setBatchDocs] = useState(false)
  const { t } = useVocab()
  const [bulkAcuityOpen, setBulkAcuityOpen] = useState(false)
  // The same Archive dialog as for one record, reason and upcoming appointments included (audit 1.13, UX-B-26)
  const [archiveIds, setArchiveIds] = useState<number[] | null>(null)
  const [archiveReason, setArchiveReason] = useState('')

  /** With a reason each record keeps it (and its notes say it); without one, one bulk step */
  async function archiveIdsWith(ids: number[], reason: string): Promise<boolean> {
    if (!reason) return (await safeInvoke(IPC.ROW_BULK_ACTION, 'archive', ids)).ok
    let any = false
    for (const id of ids) if ((await safeInvoke(IPC.ROW_ARCHIVE, id, reason)).ok) any = true
    return any
  }

  async function archive(ids: number[], cancelAppointments: boolean, reason: string) {
    const names = ids.map(id => {
      const r = rowById.get(id)
      return r ? getClientName(r, columns, t('record', { cap: true })) : t('record', { cap: true })
    })
    if (!await archiveIdsWith(ids, reason)) return
    pulseEvents.emit('records:archive-changed')
    let apptSnapshot: unknown = null
    if (cancelAppointments) {
      const res = await safeInvoke<{ snapshot: unknown }>(IPC.APPT_CANCEL_UPCOMING, ids)
      if (res.ok) apptSnapshot = res.data.snapshot
    }
    setSelectedRowIds(new Set())
    if (activeGridId) await useGridStore.getState().loadGrid(activeGridId)
    useUndoStore.getState().pushWithToast({
      id: crypto.randomUUID(),
      description: `Archived ${ids.length} ${t('record', { count: ids.length })} (${names.slice(0, 3).join(', ')}${ids.length > 3 ? '…' : ''})`,
      timestamp: Date.now(),
      category: 'structural',
      icon: 'archive',
      undo: async () => {
        await mustInvoke(IPC.ROW_BULK_ACTION, 'unarchive', ids)
        pulseEvents.emit('records:archive-changed')
        if (apptSnapshot) await mustInvoke(IPC.APPT_RESTORE, apptSnapshot)
        if (activeGridId) await useGridStore.getState().loadGrid(activeGridId)
      },
      redo: async () => {
        if (reason) { for (const id of ids) await mustInvoke(IPC.ROW_ARCHIVE, id, reason) } else await mustInvoke(IPC.ROW_BULK_ACTION, 'archive', ids)
        pulseEvents.emit('records:archive-changed')
        if (cancelAppointments) {
          const res = await mustInvoke<{ snapshot: unknown }>(IPC.APPT_CANCEL_UPCOMING, ids)
          if (res.ok) apptSnapshot = res.data.snapshot
        }
        if (activeGridId) await useGridStore.getState().loadGrid(activeGridId)
      },
    })
  }

  const allArchived = Array.from(selectedRowIds).every(id => {
    const r = rowById.get(id)
    return r && r.is_active === 0
  })
  const noneArchived = Array.from(selectedRowIds).every(id => {
    const r = rowById.get(id)
    return r && r.is_active !== 0
  })

  return (
    // Above the list's footer line, so its counts and "Saved" stay readable (UX-B-25)
    <div className="fixed bottom-12 left-1/2 -translate-x-1/2 z-40 max-w-[calc(100vw-2rem)] overflow-x-auto
                    flex items-center gap-3 px-4 py-3 whitespace-nowrap
                    bg-slate-900 dark:bg-slate-700 text-white rounded-xl shadow-2xl
                    border border-slate-700 dark:border-slate-500">
      <span className="text-sm font-medium flex-shrink-0">
        {selectedRowIds.size} {t('record', { count: selectedRowIds.size })} selected
      </span>
      <div className="w-px h-4 bg-slate-600" />
      {allArchived && (
        <button
          className="hit-44 text-base px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 transition-colors font-medium"
          onClick={async () => {
            const ids = Array.from(selectedRowIds)
            const result = await safeInvoke(IPC.ROW_BULK_ACTION, 'unarchive', ids)
            if (result.ok) {
              pulseEvents.emit('records:archive-changed')
              setSelectedRowIds(new Set())
              if (activeGridId) await useGridStore.getState().loadGrid(activeGridId)
              useUndoStore.getState().pushWithToast({
                id: crypto.randomUUID(),
                description: `Unarchived ${ids.length} ${t('record', { count: ids.length })}`,
                timestamp: Date.now(),
                category: 'structural',
                icon: 'archive',
                undo: async () => {
                  await mustInvoke(IPC.ROW_BULK_ACTION, 'archive', ids)
                  pulseEvents.emit('records:archive-changed')
                  if (activeGridId) await useGridStore.getState().loadGrid(activeGridId)
                },
                redo: async () => {
                  await mustInvoke(IPC.ROW_BULK_ACTION, 'unarchive', ids)
                  pulseEvents.emit('records:archive-changed')
                  if (activeGridId) await useGridStore.getState().loadGrid(activeGridId)
                },
              })
            }
          }}
        >
          Unarchive
        </button>
      )}
      {noneArchived && (
        <button
          className="hit-44 text-base px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 transition-colors font-medium"
          onClick={() => { setArchiveReason(''); setArchiveIds(Array.from(selectedRowIds)) }}
        >
          Archive…
        </button>
      )}
      <button
        className="hit-44 text-base px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 transition-colors font-medium"
        onClick={() => setBulkEditOpen(true)}
        title={`Give the selected ${t('record', { many: true })} the same value in one column`}
      >
        Change a column…
      </button>
      <button
        className="hit-44 text-base px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 transition-colors font-medium"
        onClick={() => { setBulkMoveTarget(true) }}
      >
        Move to {t('list')}…
      </button>
      {lettersOn && activeGridId != null && (
        <button
          className="hit-44 text-base px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 transition-colors font-medium"
          onClick={() => setBatchDocs(true)}
        >
          Letters and labels…
        </button>
      )}
      {batchDocs && activeGridId != null && (
        <BatchDocumentsDialog gridId={activeGridId} rowIds={Array.from(selectedRowIds)} onClose={() => setBatchDocs(false)} />
      )}
      {acuityEnabled && (
        <div className="relative">
          <button
            className="hit-44 text-base px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 transition-colors font-medium"
            onClick={() => setBulkAcuityOpen(v => !v)}
          >
            Set {t('priority')}
          </button>
          {bulkAcuityOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setBulkAcuityOpen(false)} />
              <div className="absolute bottom-full mb-2 left-0 z-50 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl py-1 w-44">
                {acuityLevels.map(level => (
                  <button
                    key={level.id}
                    className="flex items-center gap-2.5 w-full px-3 text-left text-base text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                    style={{ minHeight: 44 }}
                    onClick={() => {
                      void bulkSetRowAcuityLevel(Array.from(selectedRowIds), level.id)
                      setBulkAcuityOpen(false)
                    }}
                  >
                    <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: level.color }} />
                    <span className="flex-1">{level.name}</span>
                    <span className="text-slate-500 dark:text-slate-400 text-sm">{level.points} pts</span>
                  </button>
                ))}
                <div className="my-1 border-t border-slate-100 dark:border-slate-700" />
                <button
                  className="flex items-center gap-2.5 w-full px-3 text-left text-base text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700"
                  style={{ minHeight: 44 }}
                  onClick={() => {
                    void bulkSetRowAcuityLevel(Array.from(selectedRowIds), null)
                    setBulkAcuityOpen(false)
                  }}
                >
                  None (remove {t('priority')})
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {/* The bar is transformed, which would pin a fixed dialog to it */}
      {createPortal(<ArchiveDialog
        archiveTarget={archiveIds}
        archiveReason={archiveReason}
        setArchiveReason={setArchiveReason}
        onConfirm={({ cancelAppointments }) => {
          const ids = archiveIds
          setArchiveIds(null)
          if (ids) void archive(ids, cancelAppointments, archiveReason.trim())
        }}
        onCancel={() => setArchiveIds(null)}
      />, document.body)}
      {/* Away from Archive, at the far end after a divider (UX-B-25) */}
      <div className="w-px h-6 bg-slate-600 flex-shrink-0" aria-hidden="true" />
      <button
        className="hit-44 text-base px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 transition-colors font-medium"
        onClick={() => setBulkDeleteTarget(true)}
      >
        Move to the Trash…
      </button>
      <button
        className="hit-44 text-base px-2 py-1.5 rounded-lg hover:bg-slate-700 dark:hover:bg-slate-600 transition-colors text-slate-300"
        onClick={() => setSelectedRowIds(new Set())}
        title="Clear selection (Escape)"
        aria-label="Clear selection"
      >
        ✕
      </button>
    </div>
  )
}
