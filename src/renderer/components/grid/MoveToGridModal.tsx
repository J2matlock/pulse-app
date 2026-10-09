import React, { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { ArrowRightLeft, Copy, X, AlertCircle } from 'lucide-react'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { backdropVariants, modalPanelVariants } from '../../utils/animations'
import { IPC } from '../../../shared/ipc-channels'
import type { Grid, Column } from '../../../shared/types'
import { safeInvoke } from '../../utils/safeInvoke'
import { useUndoStore } from '../../stores/undoStore'
import { useGridStore } from '../../stores/gridStore'
import { rlog } from '../../utils/rendererLogger'
import { useVocab } from '../../hooks/useVocab'

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = await safeInvoke<T>(channel, ...args)
  if (!result.ok) throw new Error(result.error)
  return result.data
}

interface Props {
  rowId: number
  sourceGridId: number
  sourceColumns: Column[]
  onDone: () => void
  onCancel: () => void
}

export function MoveToGridModal({ rowId, sourceGridId, sourceColumns, onDone, onCancel }: Props): React.ReactElement {
  const { t } = useVocab(sourceGridId)
  const trapRef = useRef<HTMLDivElement>(null)
  useFocusTrap(trapRef, true)
  const [grids, setGrids] = useState<Grid[]>([])
  const [targetGridId, setTargetGridId] = useState<number | null>(null)
  const [targetColumns, setTargetColumns] = useState<Column[]>([])
  const [mode, setMode] = useState<'move' | 'copy'>('move')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void invoke<Grid[]>(IPC.GRID_GET_ALL).then(all => {
      setGrids(all.filter(g => g.id !== sourceGridId))
    }).catch(() => {})
  }, [sourceGridId])

  useEffect(() => {
    if (targetGridId === null) { setTargetColumns([]); return }
    void invoke<{ columns: Column[] }>(IPC.GRID_GET, targetGridId, false)
      .then(r => setTargetColumns(r.columns))
      .catch(() => {})
  }, [targetGridId])

  // Links whose type doesn't connect the target list are removed by a move (W04 §8)
  const [lostLinks, setLostLinks] = useState<string[]>([])
  useEffect(() => {
    if (targetGridId === null) { setLostLinks([]); return }
    void safeInvoke<string[]>(IPC.RECORD_LINKS_MOVE_CHECK, rowId, targetGridId).then(r => setLostLinks(r.ok ? r.data : []))
  }, [rowId, targetGridId])

  // Which source columns match target by name
  const matchedPairs = sourceColumns.map(sc => ({
    srcName: sc.name,
    matched: targetColumns.some(tc => tc.name.toLowerCase() === sc.name.toLowerCase()),
  }))
  const matchedCount = matchedPairs.filter(p => p.matched).length
  const unmatchedCount = matchedPairs.length - matchedCount

  async function handleConfirm() {
    if (!targetGridId) return
    setBusy(true)
    setError(null)
    try {
      const targetGrid = grids.find(g => g.id === targetGridId)
      const targetName = targetGrid?.name ?? `another ${t('list')}`
      if (mode === 'move') {
        await invoke(IPC.ROW_MOVE_TO_GRID, rowId, targetGridId, true)
        useUndoStore.getState().pushWithToast({
          id: crypto.randomUUID(),
          description: `Moved ${t('record')} to ${targetName}`,
          timestamp: Date.now(),
          category: 'structural',
          icon: 'arrow-right-left',
          undo: async () => {
            await invoke(IPC.ROW_MOVE_TO_GRID, rowId, sourceGridId, true)
            const gId = useGridStore.getState().activeGridId
            if (gId) await useGridStore.getState().loadGrid(gId)
          },
          redo: async () => {
            await invoke(IPC.ROW_MOVE_TO_GRID, rowId, targetGridId, true)
            const gId = useGridStore.getState().activeGridId
            if (gId) await useGridStore.getState().loadGrid(gId)
          },
        })
      } else {
        await invoke(IPC.ROW_COPY_TO_GRID, rowId, targetGridId)
      }
      onDone()
    } catch (err) {
      rlog.error('MoveToGridModal', 'Move/copy failed', err)
      setError('Something went wrong. Please try again.')
      setBusy(false)
    }
  }

  const targetGrid = grids.find(g => g.id === targetGridId)

  return (
    <div ref={trapRef} className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="move-to-grid-title">
      <motion.div variants={backdropVariants} initial="hidden" animate="visible" className="fixed inset-0 bg-black/50" onClick={onCancel} />
      <motion.div variants={modalPanelVariants} initial="hidden" animate="visible" className="relative bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <h2 id="move-to-grid-title" className="text-lg font-semibold text-slate-800 dark:text-slate-100">
            Move or Copy to Another {t('list', { cap: true })}
          </h2>
          <button onClick={onCancel} className="hit-44 p-1 rounded-sm text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 focus-visible:ring-3 focus-visible:ring-blue-500" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Mode selection */}
          <div className="flex gap-3">
            <button
              onClick={() => setMode('move')}
              className={`flex-1 flex items-center gap-2 justify-center py-2.5 px-3 rounded-lg border-2 text-base font-medium transition-colors ${
                mode === 'move'
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                  : 'border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:border-slate-300'
              }`}
            >
              <ArrowRightLeft className="w-4 h-4" />
              Move
            </button>
            <button
              onClick={() => setMode('copy')}
              className={`flex-1 flex items-center gap-2 justify-center py-2.5 px-3 rounded-lg border-2 text-base font-medium transition-colors ${
                mode === 'copy'
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                  : 'border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:border-slate-300'
              }`}
            >
              <Copy className="w-4 h-4" />
              Copy
            </button>
          </div>

          <p className="text-sm text-slate-500 dark:text-slate-400">
            {mode === 'move'
              ? `The ${t('record')} will be moved to the selected ${t('list')} and removed from this one. Columns with matching names will carry over their data.`
              : `A copy of the ${t('record')} will be added to the selected ${t('list')}. The original stays here. Checklists, ${t('activity', { many: true })} and the ${t('activityLog')} are not copied.`}
          </p>

          {/* Grid picker */}
          <div>
            <label htmlFor="move-dest-grid" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Destination {t('list')}
            </label>
            {grids.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400 italic">No other {t('list', { many: true })} available.</p>
            ) : (
              <select
                id="move-dest-grid"
                className="input w-full"
                value={targetGridId ?? ''}
                onChange={e => setTargetGridId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">— select {t('list', { article: true })} —</option>
                {grids.map(g => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Column match preview */}
          {targetGridId !== null && targetColumns.length > 0 && (
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Column mapping preview
              </p>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {matchedCount} of {matchedPairs.length} columns matched by name into{' '}
                <strong>{targetGrid?.name}</strong>.
                {unmatchedCount > 0 && ` Data in ${unmatchedCount} unmatched column${unmatchedCount > 1 ? 's' : ''} will not transfer.`}
              </p>
              {unmatchedCount > 0 && (
                <div className="flex items-start gap-1.5 text-amber-600 dark:text-amber-400 text-sm">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <span>
                    Unmatched: {matchedPairs.filter(p => !p.matched).map(p => p.srcName).join(', ')}
                  </span>
                </div>
              )}
            </div>
          )}

          {mode === 'move' && lostLinks.length > 0 && (
            <div className="flex items-start gap-1.5 text-amber-700 dark:text-amber-400 text-sm">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>These links don't apply in {targetGrid?.name} and will be removed: {lostLinks.join(', ')}</span>
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 justify-end px-6 py-4 border-t border-slate-200 dark:border-slate-700">
          <button onClick={onCancel} className="btn-secondary" disabled={busy}>Cancel</button>
          <button
            onClick={handleConfirm}
            disabled={!targetGridId || busy}
            className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? 'Working…' : `${mode === 'move' ? 'Move' : 'Copy'} ${t('record')}`}
          </button>
        </div>
      </motion.div>
    </div>
  )
}

// ── Bulk version ─────────────────────────────────────────────────────────────

interface BulkProps {
  rowIds: number[]
  sourceGridId: number
  sourceColumns: Column[]
  onDone: () => void
  onCancel: () => void
}

export function BulkMoveToGridModal({ rowIds, sourceGridId, onDone, onCancel }: BulkProps): React.ReactElement {
  const { t } = useVocab(sourceGridId)
  const bulkTrapRef = useRef<HTMLDivElement>(null)
  useFocusTrap(bulkTrapRef, true)
  const [grids, setGrids] = useState<Grid[]>([])
  const [targetGridId, setTargetGridId] = useState<number | null>(null)
  const [mode, setMode] = useState<'move' | 'copy'>('move')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void invoke<Grid[]>(IPC.GRID_GET_ALL).then(all => {
      setGrids(all.filter(g => g.id !== sourceGridId))
    }).catch(() => {})
  }, [sourceGridId])

  async function handleConfirm() {
    if (!targetGridId) return
    setBusy(true)
    setError(null)
    try {
      for (const rowId of rowIds) {
        if (mode === 'move') {
          await invoke(IPC.ROW_MOVE_TO_GRID, rowId, targetGridId, true)
        } else {
          await invoke(IPC.ROW_COPY_TO_GRID, rowId, targetGridId)
        }
      }
      if (mode === 'move') {
        const targetGrid = grids.find(g => g.id === targetGridId)
        const targetName = targetGrid?.name ?? `another ${t('list')}`
        const movedIds = [...rowIds]
        useUndoStore.getState().pushWithToast({
          id: crypto.randomUUID(),
          description: `Moved ${movedIds.length} ${t('record', { count: movedIds.length })} to ${targetName}`,
          timestamp: Date.now(),
          category: 'structural',
          icon: 'arrow-right-left',
          undo: async () => {
            for (const id of movedIds) {
              await invoke(IPC.ROW_MOVE_TO_GRID, id, sourceGridId, true)
            }
            const gId = useGridStore.getState().activeGridId
            if (gId) await useGridStore.getState().loadGrid(gId)
          },
          redo: async () => {
            for (const id of movedIds) {
              await invoke(IPC.ROW_MOVE_TO_GRID, id, targetGridId, true)
            }
            const gId = useGridStore.getState().activeGridId
            if (gId) await useGridStore.getState().loadGrid(gId)
          },
        })
      }
      onDone()
    } catch (err) {
      rlog.error('MoveToGridModal', 'Bulk move/copy failed', err)
      setError('Something went wrong. Please try again.')
      setBusy(false)
    }
  }

  return (
    <div ref={bulkTrapRef} className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="bulk-move-title">
      <motion.div variants={backdropVariants} initial="hidden" animate="visible" className="fixed inset-0 bg-black/50" onClick={onCancel} />
      <motion.div variants={modalPanelVariants} initial="hidden" animate="visible" className="relative bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <h2 id="bulk-move-title" className="text-lg font-semibold text-slate-800 dark:text-slate-100">
            Move / Copy {rowIds.length} {t('record', { count: rowIds.length })} to Another {t('list', { cap: true })}
          </h2>
          <button onClick={onCancel} className="hit-44 p-1 rounded-sm text-slate-500 dark:text-slate-400 hover:text-slate-600 focus-visible:ring-3 focus-visible:ring-blue-500" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div className="flex gap-3">
            <button onClick={() => setMode('move')}
              className={`flex-1 flex items-center gap-2 justify-center py-2.5 px-3 rounded-lg border-2 text-base font-medium transition-colors
                ${mode === 'move' ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                  : 'border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300'}`}>
              <ArrowRightLeft className="w-4 h-4" /> Move
            </button>
            <button onClick={() => setMode('copy')}
              className={`flex-1 flex items-center gap-2 justify-center py-2.5 px-3 rounded-lg border-2 text-base font-medium transition-colors
                ${mode === 'copy' ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                  : 'border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300'}`}>
              <Copy className="w-4 h-4" /> Copy
            </button>
          </div>

          <p className="text-sm text-slate-500 dark:text-slate-400">
            Columns with matching names will carry over. {mode === 'move' ? `${t('record', { many: true, cap: true })} will be removed from this ${t('list')}.` : `The originals stay in this ${t('list')}.`}
          </p>

          <div>
            <label htmlFor="bulk-move-dest-grid" className="block text-base font-medium text-slate-700 dark:text-slate-300 mb-1.5">Destination {t('list')}</label>
            {grids.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400 italic">No other {t('list', { many: true })} available.</p>
            ) : (
              <select id="bulk-move-dest-grid" className="input w-full" value={targetGridId ?? ''} onChange={e => setTargetGridId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">— select {t('list', { article: true })} —</option>
                {grids.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            )}
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>

        <div className="flex gap-3 justify-end px-6 py-4 border-t border-slate-200 dark:border-slate-700">
          <button onClick={onCancel} className="btn-secondary" disabled={busy}>Cancel</button>
          <button onClick={handleConfirm} disabled={!targetGridId || busy}
            className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed">
            {busy ? `Processing ${rowIds.length}…` : mode === 'move' ? `Move ${rowIds.length}` : `Copy ${rowIds.length}`}
          </button>
        </div>
      </motion.div>
    </div>
  )
}
