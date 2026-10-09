import React from 'react'
import { Archive, ChevronRight, RotateCcw } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'
import { LoadingOverlay } from '../../components/shared/LoadingSpinner'
import type { ArchivedRow } from './types'
import { parseDbTimestamp } from '../../../shared/dates'
import { useVocab, useVocabByList } from '../../hooks/useVocab'

export function RecentlyArchivedTab({
  rows, isLoading, search, onSearchChange, onReactivated,
}: {
  rows: ArchivedRow[]
  isLoading: boolean
  search: string
  onSearchChange: (v: string) => void
  onReactivated: (id: number) => void
}): React.ReactElement {
  const navigate = useNavigate()
  const { t } = useVocab(null)
  const tFor = useVocabByList()

  async function handleReactivate(id: number) {
    const result = await safeInvoke(IPC.ROW_UNARCHIVE, id)
    if (result.ok) onReactivated(id)
  }

  return (
    <div>
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
        <span className="text-base font-medium text-slate-600 dark:text-slate-300">
          {rows.length} archived {t('record', { count: rows.length })}
        </span>
        <input
          type="search"
          placeholder="Search archived…"
          value={search}
          onChange={e => onSearchChange(e.target.value)}
          className="input w-52 py-1.5 text-base"
          style={{ minHeight: 36 }}
        />
      </div>
      {isLoading ? (
        <LoadingOverlay label={`Loading archived ${t('record', { many: true })}…`} />
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-2 text-slate-500 dark:text-slate-400">
          <Archive className="w-10 h-10 opacity-40" />
          <p className="text-base">{search ? `No archived ${t('record', { many: true })} match.` : `No archived ${t('record', { many: true })}.`}</p>
        </div>
      ) : (
        <div role="list">
          {rows.map(row => {
            const archivedLabel = row.archived_at
              ? (() => {
                  try {
                    const d = parseDbTimestamp(row.archived_at)
                    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                  } catch { return row.archived_at }
                })()
              : 'Unknown date'

            return (
              <div
                key={row.id}
                role="listitem"
                className="flex items-center gap-4 px-4 border-b border-slate-100 dark:border-slate-700/50 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700/30"
                style={{ minHeight: 56 }}
              >
                <Archive className="w-4 h-4 text-slate-500 dark:text-slate-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <button
                    onClick={() => navigate(`/profile/${row.id}?gridId=${row.grid_id}`)}
                    className="hit-44 font-medium text-slate-800 dark:text-slate-100 truncate hover:underline text-left focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 rounded-sm"
                  >
                    {row.client_name ?? `Unnamed ${tFor(row.grid_id)('record')}`}
                  </button>
                  <div className="text-sm text-slate-500 dark:text-slate-400 truncate">
                    {row.grid_name}
                    {row.archived_reason && (
                      <span className="ml-2 text-slate-500 dark:text-slate-400">· {row.archived_reason}</span>
                    )}
                  </div>
                </div>
                <span className="text-sm text-slate-500 dark:text-slate-400 flex-shrink-0 tabular-nums">{archivedLabel}</span>
                <button
                  onClick={() => void handleReactivate(row.id)}
                  className="hit-44 flex items-center gap-1.5 text-base text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200 flex-shrink-0 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 rounded-sm px-2 py-1"
                  style={{ minHeight: 36 }}
                  title={`Reactivate this ${tFor(row.grid_id)('record')}`}
                  aria-label={`Reactivate this ${tFor(row.grid_id)('record')}`}
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reactivate
                </button>
                <button
                  onClick={() => navigate(`/profile/${row.id}?gridId=${row.grid_id}`)}
                  className="hit-44 text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 flex-shrink-0 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 rounded-sm"
                  title="View profile"
                  aria-label="View profile"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
