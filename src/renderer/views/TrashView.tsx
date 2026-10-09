import { useState, useEffect, useCallback } from 'react'
import { Trash2, RotateCcw } from 'lucide-react'
import { IPC } from '../../shared/ipc-channels'
import type { DeletedRow } from '../../shared/types'
import { safeInvoke } from '../utils/safeInvoke'
import { ConfirmDialog } from '../components/shared/ConfirmDialog'
import { EmptyState } from '../components/shared/EmptyState'
import { MS_PER_DAY } from '../../shared/constants'
import { rlog } from '../utils/rendererLogger'
import { parseDbTimestamp } from '../../shared/dates'
import { useVocab, useVocabByList } from '../hooks/useVocab'
import { useFeature } from '../hooks/useFeature'
import { TrashFiles } from '../components/shared/TrashFiles'

export default function TrashView() {
  // Trash mixes lists: headings use workspace words, each row its own list's
  const { t } = useVocab(null)
  const filesOn = useFeature('attachments')
  const tFor = useVocabByList()
  const [rows, setRows] = useState<DeletedRow[]>([])
  const [loading, setLoading] = useState(true)
  const [purgeTarget, setPurgeTarget] = useState<number | null>(null)
  const [showEmptyConfirm, setShowEmptyConfirm] = useState(false)

  const loadTrash = useCallback(async () => {
    try {
      const result = await safeInvoke<DeletedRow[]>(IPC.ROW_GET_DELETED)
      if (result.ok) setRows(result.data)
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
      if (result.ok) setRows(r => r.filter(r2 => r2.id !== row.id))
    } catch (err) {
      rlog.error('TrashView', 'Failed to restore row', err)
    }
  }

  const purgeRow = async (rowId: number) => {
    try {
      const result = await safeInvoke(IPC.ROW_PURGE, rowId)
      if (result.ok) setRows(r => r.filter(row => row.id !== rowId))
    } catch (err) {
      rlog.error('TrashView', 'Failed to purge row', err)
    }
  }

  const emptyTrash = async () => {
    const failed: number[] = []
    for (const row of rows) {
      try {
        const result = await safeInvoke(IPC.ROW_PURGE, row.id)
        if (!result.ok) failed.push(row.id)
      } catch {
        failed.push(row.id)
      }
    }
    if (failed.length > 0) {
      setRows(r => r.filter(row => failed.includes(row.id)))
      rlog.error('TrashView', `Failed to purge ${failed.length} row(s)`)
    } else {
      setRows([])
    }
  }

  function daysRemaining(deletedAt: string): number {
    const deletedMs = new Date(deletedAt).getTime()
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
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Items are permanently removed after 30 days
          </p>
        </div>
        {rows.length > 0 && (
          <button
            onClick={() => setShowEmptyConfirm(true)}
            className="px-4 py-2 text-base font-medium text-red-600 dark:text-red-400 border border-red-300 dark:border-red-700 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            style={{ minHeight: 44 }}
          >
            Empty Trash
          </button>
        )}
      </div>

      {/* Content */}
      {rows.length === 0 ? (
        <EmptyState
          icon={<Trash2 className="w-12 h-12" />}
          title="Trash is empty"
          description={`Deleted ${t('record', { many: true })} will appear here for 30 days before being permanently removed.`}
        />
      ) : (
        <div className="flex-1 overflow-auto px-6 py-4">
          <table className="w-full">
            <thead>
              <tr className="text-left text-sm font-medium text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                <th className="py-3 pr-4" style={{ fontSize: 15 }}>{t('record', { cap: true })}</th>
                <th className="py-3 pr-4" style={{ fontSize: 15 }}>{t('list', { cap: true })}</th>
                <th className="py-3 pr-4" style={{ fontSize: 15 }}>Deleted</th>
                <th className="py-3 pr-4" style={{ fontSize: 15 }}>Days Remaining</th>
                <th className="py-3 text-right" style={{ fontSize: 15 }}>Actions</th>
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
                          title={row.grid_is_active ? `Restore ${tFor(row.grid_id)('record')}` : `The ${t('list')} was deleted — cannot restore`}
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          Restore
                        </button>
                        <button
                          onClick={() => setPurgeTarget(row.id)}
                          className="hit-44 inline-flex items-center gap-1.5 px-3 py-1.5 text-base font-medium text-red-600 dark:text-red-400 border border-red-300 dark:border-red-700 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                          style={{ minHeight: 36 }}
                          title="Delete permanently"
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

      {filesOn && <TrashFiles />}

      {/* Purge single row confirmation */}
      <ConfirmDialog
        open={purgeTarget != null}
        title="Delete permanently?"
        message={`This will permanently remove the ${t('record')} and all related data. This cannot be undone.`}
        confirmLabel="Delete Permanently"
        destructive
        onConfirm={async () => {
          if (purgeTarget != null) await purgeRow(purgeTarget)
          setPurgeTarget(null)
        }}
        onCancel={() => setPurgeTarget(null)}
      />

      {/* Blocked restore — grid was deleted */}
      <ConfirmDialog
        open={restoreBlockedRow != null}
        title={`Cannot restore ${t('record')}`}
        message={`The ${t('list')} "${restoreBlockedRow?.grid_name}" was deleted. To restore this ${t('record')}, first restore the ${t('list')} from Settings, or permanently delete this ${t('record')}.`}
        confirmLabel="OK"
        onConfirm={() => setRestoreBlockedRow(null)}
        onCancel={() => setRestoreBlockedRow(null)}
      />

      {/* Empty trash confirmation — typed variant */}
      <ConfirmDialog
        open={showEmptyConfirm}
        title="Empty trash?"
        message={`This will permanently delete ${rows.length} ${t('record', { count: rows.length })} and all related data. Type EMPTY to confirm.`}
        confirmLabel="Empty Trash"
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
