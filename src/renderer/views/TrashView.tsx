import { useState, useEffect, useCallback } from 'react'
import { Trash2, RotateCcw } from 'lucide-react'
import { IPC } from '../../shared/ipc-channels'
import type { DeletedRow } from '../../shared/types'
import { safeInvoke } from '../utils/safeInvoke'
import { ConfirmDialog } from '../components/shared/ConfirmDialog'
import { EmptyState } from '../components/shared/EmptyState'
import { MS_PER_DAY } from '../../shared/constants'
import { rlog } from '../utils/rendererLogger'
import toast from 'react-hot-toast'
import { parseDbTimestamp } from '../../shared/dates'
import { useVocab, useVocabByList } from '../hooks/useVocab'
import { PurposeLine } from '../components/shared/PurposeLine'
import { useFeature } from '../hooks/useFeature'
import { TrashFiles } from '../components/shared/TrashFiles'
import { useGridStore } from '../stores/gridStore'
import { useUndoStore } from '../stores/undoStore'
import { friendlyError } from '../utils/friendlyError'

type DeletedList = { id: number; name: string; deleted_at: string; records: number }

export default function TrashView() {
  // Trash mixes lists: headings use workspace words, each row its own list's
  const { t, f } = useVocab(null)
  const filesOn = useFeature('attachments')
  const tFor = useVocabByList()
  const [rows, setRows] = useState<DeletedRow[]>([])
  // The list shows the newest 500; Empty the Trash removes every one (Q-029)
  const [rowTotal, setRowTotal] = useState(0)
  const recordCount = Math.max(rowTotal, rows.length)
  const [loading, setLoading] = useState(true)
  const [purgeTarget, setPurgeTarget] = useState<number | null>(null)
  const purgeName = rows.find(r => r.id === purgeTarget)?.client_name?.trim() ?? ''
  const [showEmptyConfirm, setShowEmptyConfirm] = useState(false)
  // Deleted lists wait here too, for 30 days (D1)
  const [lists, setLists] = useState<DeletedList[]>([])
  const [purgeListTarget, setPurgeListTarget] = useState<DeletedList | null>(null)
  // Removed files wait here too (W09); counted so a Trash holding only files isn't "empty"
  const [fileCount, setFileCount] = useState(0)
  const [filesReload, setFilesReload] = useState(0)
  const files = filesOn ? fileCount : 0
  // Purging records takes their files with them: the Files list must reload
  const reloadFiles = () => setFilesReload(n => n + 1)

  const loadTrash = useCallback(async () => {
    try {
      const [result, listRes, countRes] = await Promise.all([safeInvoke<DeletedRow[]>(IPC.ROW_GET_DELETED), safeInvoke(IPC.GRID_DELETED_LIST), safeInvoke(IPC.ROW_COUNT_DELETED)])
      if (result.ok) setRows(result.data)
      setRowTotal(countRes.ok && typeof countRes.data === 'number' ? countRes.data : 0)
      if (listRes.ok && Array.isArray(listRes.data)) setLists(listRes.data)
    } catch (err) {
      rlog.error('TrashView', 'Failed to load trash', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadTrash() }, [loadTrash])

  // Re-fetch when any row is restored/deleted (catches undo actions)
  useEffect(() => {
    return window.api.on(IPC.CASE_LOG_CHANGED, () => { void loadTrash() })
  }, [loadTrash])

  const [restoreBlockedRow, setRestoreBlockedRow] = useState<DeletedRow | null>(null)

  const restoreRow = async (row: DeletedRow) => {
    if (!row.grid_is_active) {
      setRestoreBlockedRow(row)
      return
    }
    try {
      const result = await safeInvoke(IPC.ROW_RESTORE_DELETED, row.id)
      if (result.ok) { setRows(r => r.filter(r2 => r2.id !== row.id)); setRowTotal(n => Math.max(0, n - 1)) }
    } catch (err) {
      rlog.error('TrashView', 'Failed to restore row', err)
    }
  }

  const restoreList = async (gridId: number) => {
    const res = await safeInvoke(IPC.GRID_RESTORE, gridId)
    if (!res.ok) { toast.error(friendlyError(res.error)); return }
    setRestoreBlockedRow(null)
    await useGridStore.getState().loadGridList()
    await loadTrash()
    toast.success(`The ${t('list')} is back, with its ${t('record', { many: true })}.`)
  }

  // An undo step that brings back what was just removed for good would fail, and a failed step
  // stays on top of the stack, so every later Ctrl+Z hit the same error (polish R2)
  const forgetUndoSteps = () => useUndoStore.getState().clear()

  const purgeList = async (gridId: number) => {
    const res = await safeInvoke(IPC.GRID_PURGE, gridId)
    if (!res.ok) { toast.error(friendlyError(res.error)); return }
    forgetUndoSteps()
    reloadFiles()
    await loadTrash()
  }

  const purgeRow = async (rowId: number) => {
    try {
      const result = await safeInvoke(IPC.ROW_PURGE, rowId)
      if (result.ok) { setRows(r => r.filter(row => row.id !== rowId)); setRowTotal(n => Math.max(0, n - 1)); forgetUndoSteps(); reloadFiles() }
    } catch (err) {
      rlog.error('TrashView', 'Failed to purge row', err)
    }
  }

  // One call, one transaction (X-38)
  const emptyTrash = async () => {
    const result = await safeInvoke(IPC.ROW_PURGE_ALL)
    if (result.ok) { setRows([]); setRowTotal(0); setLists([]); forgetUndoSteps() }
    else {
      rlog.error('TrashView', 'Failed to empty trash', result.error)
      toast.error("We couldn't empty the Trash — try again")
      return
    }
    // Removed files go too (no id: every file in the Trash)
    if (files > 0) {
      const res = await safeInvoke(IPC.ATTACHMENT_PURGE)
      if (!res.ok) toast.error("We couldn't remove the files in the Trash — try again")
    }
    reloadFiles()
  }

  function daysRemaining(deletedAt: string): number {
    const deletedMs = parseDbTimestamp(deletedAt).getTime()
    const nowMs = Date.now()
    const ageInDays = Math.floor((nowMs - deletedMs) / MS_PER_DAY)
    return Math.max(0, 30 - ageInDays)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-white dark:bg-slate-900">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Trash2 className="w-5 h-5" />
            Trash
          </h1>
          <PurposeLine className="mt-1">{f('Deleted {record:many} and {list:many} wait here for 30 days, then go for good. Restore brings one back.')}</PurposeLine>
        </div>
        {(rows.length > 0 || lists.length > 0 || files > 0) && (
          <button
            onClick={() => setShowEmptyConfirm(true)}
            className="px-4 py-2 text-base font-medium text-red-600 dark:text-red-400 border border-red-300 dark:border-red-700 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            style={{ minHeight: 44 }}
          >
            Empty the Trash
          </button>
        )}
      </div>

      {/* Deleted lists, with their records (D1) */}
      {lists.length > 0 && (
        <section className="px-6 pt-4" aria-labelledby="trash-lists-title">
          <h2 id="trash-lists-title" className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-2">Deleted {t('list', { many: true })}</h2>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg">
            {lists.map(l => {
              const remaining = daysRemaining(l.deleted_at)
              return (
                <li key={l.id} className="flex flex-wrap items-center gap-3 px-4 py-2" style={{ minHeight: 44 }}>
                  <span className="flex-1 min-w-0 text-base text-slate-900 dark:text-white">
                    <strong>{l.name}</strong> · {l.records} {tFor(l.id)('record', { count: l.records })}
                    <span className={`ml-2 ${remaining <= 7 ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'}`}>{remaining} day{remaining !== 1 ? 's' : ''} left</span>
                  </span>
                  <button onClick={() => void restoreList(l.id)} className="hit-44 inline-flex items-center gap-1.5 px-3 py-1.5 text-base font-medium rounded-lg text-blue-600 dark:text-blue-400 border border-blue-300 dark:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/20" style={{ minHeight: 36 }}>
                    <RotateCcw className="w-3.5 h-3.5" />Restore
                  </button>
                  <button onClick={() => setPurgeListTarget(l)} className="hit-44 inline-flex items-center gap-1.5 px-3 py-1.5 text-base font-medium text-red-600 dark:text-red-400 border border-red-300 dark:border-red-700 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20" style={{ minHeight: 36 }}>
                    <Trash2 className="w-3.5 h-3.5" />Delete forever
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {/* Content */}
      {rows.length === 0 ? (lists.length > 0 || files > 0 ? null :
        <EmptyState
          icon={<Trash2 className="w-12 h-12" />}
          title="The Trash is empty"
          description={`Deleted ${t('record', { many: true })} and ${t('list', { many: true })} will appear here for 30 days before being removed for good.`}
        />
      ) : (
        <div className="flex-1 overflow-auto px-6 py-4">
          {recordCount > rows.length && (
            <p className="text-base text-slate-600 dark:text-slate-300 mb-2">
              Showing the {rows.length} most recent of {recordCount} {t('record', { many: true })}. Empty the Trash removes all {recordCount}.
            </p>
          )}
          <table className="w-full">
            <thead>
              <tr className="text-left text-sm font-medium text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                <th className="py-3 pr-4" style={{ fontSize: 15 }}>{t('record', { cap: true })}</th>
                <th className="py-3 pr-4" style={{ fontSize: 15 }}>{t('list', { cap: true })}</th>
                <th className="py-3 pr-4" style={{ fontSize: 15 }}>Moved to the Trash</th>
                <th className="py-3 pr-4" style={{ fontSize: 15 }}>Days left</th>
                <th className="py-3 text-right" style={{ fontSize: 15 }}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const remaining = daysRemaining(row.deleted_at)
                return (
                  <tr
                    key={row.id}
                    className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                    style={{ minHeight: 44 }}
                  >
                    <td className="py-3 pr-4 text-slate-900 dark:text-white" style={{ fontSize: 15 }}>
                      {row.client_name}
                    </td>
                    <td className="py-3 pr-4 text-slate-600 dark:text-slate-400" style={{ fontSize: 15 }}>
                      {row.grid_name}
                      {!row.grid_is_active && (
                        <span className="ml-1.5 text-sm text-red-600 dark:text-red-400">(deleted)</span>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-slate-600 dark:text-slate-400" style={{ fontSize: 15 }}>
                      {parseDbTimestamp(row.deleted_at).toLocaleDateString()}
                    </td>
                    <td className="py-3 pr-4" style={{ fontSize: 15 }}>
                      <span className={remaining <= 7 ? 'text-red-600 dark:text-red-400 font-medium' : 'text-slate-600 dark:text-slate-400'}>
                        {remaining} day{remaining !== 1 ? 's' : ''}
                      </span>
                    </td>
                    <td className="py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => restoreRow(row)}
                          className={`hit-44 inline-flex items-center gap-1.5 px-3 py-1.5 text-base font-medium rounded-lg transition-colors ${
                            row.grid_is_active
                              ? 'text-blue-600 dark:text-blue-400 border border-blue-300 dark:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/20'
                              : 'text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 cursor-not-allowed'
                          }`}
                          style={{ minHeight: 36 }}
                          title={row.grid_is_active ? `Restore ${tFor(row.grid_id)('record')}` : `Its ${t('list')} is in the Trash: restore the ${t('list')} first`}
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          Restore
                        </button>
                        <button
                          onClick={() => setPurgeTarget(row.id)}
                          className="hit-44 inline-flex items-center gap-1.5 px-3 py-1.5 text-base font-medium text-red-600 dark:text-red-400 border border-red-300 dark:border-red-700 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                          style={{ minHeight: 36 }}
                          title="Delete forever"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {filesOn && <TrashFiles reloadKey={filesReload} onCountChange={setFileCount} />}

      {/* Purge single row confirmation */}
      <ConfirmDialog
        open={purgeTarget != null}
        title={purgeName ? `Delete "${purgeName}" forever?` : `Delete this ${t('record')} forever?`}
        message={`${purgeName || `This ${t('record')}`} and everything on it (${t('activity', { many: true })}, files, history) will be removed for good. This can't be undone.`}
        confirmLabel="Delete forever"
        destructive
        onConfirm={async () => {
          if (purgeTarget != null) await purgeRow(purgeTarget)
          setPurgeTarget(null)
        }}
        onCancel={() => setPurgeTarget(null)}
      />

      {/* A record whose list is in the Trash comes back with its list (G-35) */}
      <ConfirmDialog
        open={restoreBlockedRow != null}
        destructive={false}
        title={`Restore the ${t('list')} first`}
        message={`This ${t('record')} belongs to "${restoreBlockedRow?.grid_name}", which is in the Trash. Restoring the ${t('list')} brings it back with its ${t('record', { many: true })}; then you can restore this one.`}
        confirmLabel={`Restore the ${t('list')}`}
        onConfirm={() => { if (restoreBlockedRow) void restoreList(restoreBlockedRow.grid_id) }}
        onCancel={() => setRestoreBlockedRow(null)}
      />

      {/* Delete a list forever: typed, since nothing brings it back */}
      <ConfirmDialog
        open={purgeListTarget != null}
        variant="typed"
        requiredPhrase={purgeListTarget?.name ?? ''}
        title={`Delete "${purgeListTarget?.name}" forever?`}
        message={`The ${t('list')} and its ${purgeListTarget?.records ?? 0} ${t('record', { count: purgeListTarget?.records ?? 0 })}, with their ${t('activity', { many: true })} and files, are removed for good. This can't be undone.`}
        confirmLabel="Delete forever"
        onConfirm={async () => {
          if (purgeListTarget) await purgeList(purgeListTarget.id)
          setPurgeListTarget(null)
        }}
        onCancel={() => setPurgeListTarget(null)}
      />

      {/* Empty the Trash confirmation — typed variant */}
      <ConfirmDialog
        open={showEmptyConfirm}
        title="Empty the Trash?"
        message={`This removes ${[
          recordCount ? `${recordCount} ${t('record', { count: recordCount })}` : '',
          lists.length ? `${lists.length} ${t('list', { count: lists.length })} with their ${t('record', { many: true })}` : '',
          files ? `${files} file${files === 1 ? '' : 's'}` : '',
        ].filter(Boolean).join(' and ')} for good, with everything on them. Type EMPTY to confirm.`}
        confirmLabel="Empty the Trash"
        variant="typed"
        requiredPhrase="EMPTY"
        onConfirm={async () => {
          await emptyTrash()
          setShowEmptyConfirm(false)
        }}
        onCancel={() => setShowEmptyConfirm(false)}
      />
    </div>
  )
}
