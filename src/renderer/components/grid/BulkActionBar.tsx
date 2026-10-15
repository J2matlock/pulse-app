import React, { useRef, useState } from 'react'
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
import { trashRows } from './GridDialogs'
import { archiveReasonAction, voidReasonNotes } from '../../stores/archiveReasonStore'
import type { ArchiveReasonState } from '../../stores/archiveReasonStore'
import { Trash2, X } from 'lucide-react'
import { SecondaryButton, IconButton } from '../ui/Button'
import { Tooltip } from '../shared/Tooltip'
import { useLiftToastsAbove } from '../shared/toastLift'

type Words = ReturnType<typeof useVocab>['t']

const MAX_NAME = 30
const short = (name: string) => name.length > MAX_NAME ? `${name.slice(0, MAX_NAME - 1).trimEnd()}…` : name

/**
 * Which records a bulk action is about, said by name (persona study R3: "Move 5 to the
 * Trash" took a real home along with four nameless ones). Up to two names, then a count;
 * records with no name are counted apart while the rest are named: "Bergstrom home and
 * 4 unnamed", "Bergstrom home, Nowak home and 3 more", "3 unnamed clients".
 * names: each record's name, '' for one with none.
 */
export function namedRecords(names: string[], t: Words): string {
  const named = names.filter(n => n.trim() !== '').map(n => short(n.trim()))
  const unnamed = names.length - named.length
  const shown = named.slice(0, 2)
  const moreNamed = named.length - shown.length
  const parts = [...shown]
  if (moreNamed > 0) parts.push(`${moreNamed + unnamed} more`)
  else if (unnamed > 0) parts.push(shown.length ? `${unnamed} unnamed` : `${unnamed} unnamed ${t('record', { count: unnamed })}`)
  return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

export interface BulkActionBarProps {
  selectedRowIds: Set<number>
  rowById: Map<number, GridRow>
  columns: Column[]
  activeGridId: number | null
  acuityEnabled: boolean
  acuityLevels: AcuityLevel[]
  bulkSetRowAcuityLevel: (rowIds: number[], levelId: number | null) => Promise<void>
  setSelectedRowIds: React.Dispatch<React.SetStateAction<Set<number>>>
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
  setBulkMoveTarget,
  setBulkEditOpen,
}: BulkActionBarProps): React.ReactElement {
  const barRef = useRef<HTMLDivElement>(null)
  // Toasts stay above the bar, 8 px clear of it, while it shows (Q6)
  useLiftToastsAbove(barRef, 8)
  const lettersOn = useFeature('letters')
  const [batchDocs, setBatchDocs] = useState(false)
  const { t } = useVocab()
  const [bulkAcuityOpen, setBulkAcuityOpen] = useState(false)
  /**
   * Archive at once, no dialog (Q4): upcoming appointments are cancelled with
   * them, as the dialog did by default, and the toast offers "Add a reason…".
   * One undo step brings back both.
   */
  async function archive(ids: number[]) {
    const names = ids.map(id => {
      const r = rowById.get(id)
      return r ? getClientName(r, columns, t('record', { cap: true })) : t('record', { cap: true })
    })
    if (!(await safeInvoke(IPC.ROW_BULK_ACTION, 'archive', ids)).ok) return
    pulseEvents.emit('records:archive-changed')
    let apptSnapshot: unknown = null
    let cancelled = 0
    const upcoming = await safeInvoke<number>(IPC.APPT_UPCOMING_COUNT, ids)
    if (upcoming.ok && upcoming.data > 0) {
      const res = await safeInvoke<{ snapshot: unknown; ids?: number[] }>(IPC.APPT_CANCEL_UPCOMING, ids)
      if (res.ok) { apptSnapshot = res.data.snapshot; cancelled = res.data.ids?.length ?? 0 }
    }
    setSelectedRowIds(new Set())
    if (activeGridId) await useGridStore.getState().loadGrid(activeGridId)
    const reasonStep: ArchiveReasonState = { noteIds: [] }
    const label = `${ids.length} ${t('record', { count: ids.length })}`
    const apptText = cancelled > 0 ? `; ${cancelled} upcoming ${t('appointment', { count: cancelled })} cancelled` : ''
    useUndoStore.getState().pushWithToast({
      id: crypto.randomUUID(),
      description: `Archived ${label} (${names.slice(0, 3).join(', ')}${ids.length > 3 ? '…' : ''})${apptText}`,
      timestamp: Date.now(),
      category: 'structural',
      icon: 'archive',
      undo: async () => {
        await mustInvoke(IPC.ROW_BULK_ACTION, 'unarchive', ids)
        pulseEvents.emit('records:archive-changed')
        if (apptSnapshot) await mustInvoke(IPC.APPT_RESTORE, apptSnapshot)
        await voidReasonNotes(reasonStep)
        if (activeGridId) await useGridStore.getState().loadGrid(activeGridId)
      },
      redo: async () => {
        const reason = reasonStep.reason
        if (reason) { for (const id of ids) await mustInvoke(IPC.ROW_ARCHIVE, id, reason) } else await mustInvoke(IPC.ROW_BULK_ACTION, 'archive', ids)
        pulseEvents.emit('records:archive-changed')
        if (apptSnapshot) {
          const res = await mustInvoke<{ snapshot: unknown }>(IPC.APPT_CANCEL_UPCOMING, ids)
          if (res.ok) apptSnapshot = res.data.snapshot
        }
        if (activeGridId) await useGridStore.getState().loadGrid(activeGridId)
      },
    }, { action: archiveReasonAction(ids, ids.length === 1 ? `"${names[0]}"` : label, reasonStep) })
  }

  // Named, so a real record caught in a clean-up of empty ones shows on the button (R3)
  const selectedNames = Array.from(selectedRowIds).map(id => {
    const r = rowById.get(id)
    return r ? getClientName(r, columns, '') : ''
  })
  const trashWhat = namedRecords(selectedNames, t)

  async function trash() {
    const ids = Array.from(selectedRowIds)
    if (await trashRows(ids, trashWhat)) setSelectedRowIds(new Set())
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
    <div ref={barRef} className="fixed bottom-12 left-1/2 -translate-x-1/2 z-40 max-w-[calc(100vw-2rem)] overflow-x-auto
                    flex items-center gap-3 px-4 py-3 whitespace-nowrap
                    bg-slate-900 dark:bg-slate-700 text-white rounded-lg shadow-2xl
                    border border-slate-700 dark:border-slate-500">
      <span className="text-base font-medium flex-shrink-0">
        {selectedRowIds.size} {t('record', { count: selectedRowIds.size })} selected
      </span>
      <div className="w-px h-6 bg-slate-600 flex-shrink-0" aria-hidden="true" />
      {allArchived && (
        <SecondaryButton
          size="compact"
          tone="inverse"
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
        </SecondaryButton>
      )}
      {noneArchived && (
        <SecondaryButton size="compact" tone="inverse" onClick={() => void archive(Array.from(selectedRowIds))}>
          Archive
        </SecondaryButton>
      )}
      <Tooltip content={`Give the selected ${t('record', { many: true })} the same value in one column`}>
        <SecondaryButton size="compact" tone="inverse" onClick={() => setBulkEditOpen(true)}>
          Change a column…
        </SecondaryButton>
      </Tooltip>
      <SecondaryButton size="compact" tone="inverse" onClick={() => { setBulkMoveTarget(true) }}>
        Move to {t('list')}…
      </SecondaryButton>
      {lettersOn && activeGridId != null && (
        <SecondaryButton size="compact" tone="inverse" onClick={() => setBatchDocs(true)}>
          Letters and labels…
        </SecondaryButton>
      )}
      {batchDocs && activeGridId != null && (
        <BatchDocumentsDialog gridId={activeGridId} rowIds={Array.from(selectedRowIds)} onClose={() => setBatchDocs(false)} />
      )}
      {acuityEnabled && (
        <div className="relative">
          <SecondaryButton size="compact" tone="inverse" aria-expanded={bulkAcuityOpen} onClick={() => setBulkAcuityOpen(v => !v)}>
            Set {t('priority')}
          </SecondaryButton>
          {bulkAcuityOpen && (
            <>
              <div className="fixed inset-0 z-40" data-dialog-backdrop="" onClick={() => setBulkAcuityOpen(false)} />
              <div className="absolute bottom-full mb-2 left-0 z-50 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl py-1 w-44">
                {acuityLevels.map(level => (
                  <button
                    key={level.id}
                    className="flex items-center gap-2 w-full min-h-11 px-3 text-left text-base text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
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
                  className="flex items-center gap-2 w-full min-h-11 px-3 text-left text-base text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700"
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
      {/* Away from Archive, at the far end after a divider (UX-B-25) */}
      <div className="w-px h-6 bg-slate-600 flex-shrink-0" aria-hidden="true" />
      {/* Red words, not a red fill: a filled red button is only for a confirmation (Q8) */}
      <SecondaryButton size="compact" tone="inverse" icon={<Trash2 className="w-4 h-4" />} className="text-red-200! dark:text-red-200!" onClick={() => void trash()}>
        Move {trashWhat} to the Trash
      </SecondaryButton>
      <IconButton size="compact" tone="inverse" label="Clear selection" shortcut="Escape" icon={<X className="w-4 h-4" />} onClick={() => setSelectedRowIds(new Set())} />
    </div>
  )
}
