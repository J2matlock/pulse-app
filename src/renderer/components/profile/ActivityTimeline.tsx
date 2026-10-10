import { useCallback, useEffect, useState } from 'react'
import { Clock, ChevronDown, Eye } from 'lucide-react'
import { IPC } from '../../../shared/ipc-channels'
import { safeInvoke } from '../../utils/safeInvoke'
import type { CaseLogEntry, CaseLogType } from '../../../shared/types'
import { formatDateTime } from '../../utils/formatTime'
import { relativeTime } from '../../utils/relativeTime'
import { CaseLogEditHistory } from './CaseLogEditHistory'
import { noteDays, formatDate } from './CaseLogEntry'
import { useActivityTypes } from '../../hooks/useActivityTypes'

interface Props {
  rowId: number
}

const PAGE_SIZE = 50

type FilterType = CaseLogType | 'all' | 'non-system'

// Always offered; one chip per note type follows
const FIXED_FILTERS: { value: FilterType; label: string }[] = [
  { value: 'all',        label: 'All' },
  { value: 'non-system', label: 'Manual' },
  { value: 'system',     label: 'System' },
]

export function ActivityTimeline({ rowId }: Props) {
  const [entries, setEntries] = useState<CaseLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterType>('all')
  const [page, setPage] = useState(1)
  const [auditMode, setAuditMode] = useState(false)
  const activity = useActivityTypes()

  const load = useCallback(async () => {
    setLoading(true)
    // includeSystem=true, includeVoided follows auditMode
    const res = await safeInvoke<CaseLogEntry[]>(IPC.CASE_LOG_GET, rowId, true, auditMode)
    if (res.ok) setEntries(res.data)
    setLoading(false)
  }, [rowId, auditMode])

  useEffect(() => { load(); setPage(1) }, [load])

  // Re-fetch when any case log entry is written (manual or system)
  useEffect(() => {
    return window.api.on(IPC.CASE_LOG_CHANGED, (changedRowId: unknown) => {
      if (changedRowId === rowId) load()
    })
  }, [rowId, load])

  // Archived types get a chip only when this record has notes of that type
  const present = new Set(entries.map(e => e.log_type))
  const filters = [
    ...FIXED_FILTERS,
    ...activity.all
      .filter(t => !t.is_archived || present.has(t.key))
      .map(t => ({ value: t.key, label: t.is_archived ? `${t.label} (archived)` : t.label })),
  ]

  const filtered = entries.filter(e => {
    if (filter === 'all') return true
    if (filter === 'non-system') return e.log_type !== 'system'
    return e.log_type === filter
  })

  const paginated = filtered.slice(0, page * PAGE_SIZE)
  const hasMore = paginated.length < filtered.length

  return (
    <section className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-700">
        <Clock className="w-4 h-4 text-slate-500 flex-shrink-0" />
        <h2 className="text-base font-semibold text-slate-700 dark:text-slate-300 flex-1">
          Activity Timeline
          {filtered.length > 0 && (
            <span className="ml-2 text-sm font-normal text-slate-500 dark:text-slate-400">({filtered.length})</span>
          )}
        </h2>
        {/* Audit mode toggle — reveals voided entries */}
        <button
          onClick={() => setAuditMode(v => !v)}
          title={auditMode ? 'Hide voided entries' : 'Show voided entries (audit mode)'}
          className={`hit-44 flex items-center gap-1.5 px-2.5 py-1 rounded-md text-base font-medium transition-colors
            focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500
            ${auditMode
              ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
            }`}
        >
          <Eye className="w-3.5 h-3.5" />
          {auditMode ? 'Audit mode' : 'Audit'}
        </button>
      </div>

      {/* Filter chips */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-slate-100 dark:border-slate-700/50 flex-wrap">
        {filters.map(f => (
          <button
            key={f.value}
            onClick={() => { setFilter(f.value); setPage(1) }}
            className={`hit-44 px-2.5 py-1 rounded-full text-base transition-colors
              focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500
              ${filter === f.value
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
              }
            `}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Audit mode banner */}
      {auditMode && (
        <div className="px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800/40">
          <p className="text-sm text-amber-700 dark:text-amber-400">
            Audit mode: voided entries are shown with strikethrough. They were undone but preserved for record-keeping.
          </p>
        </div>
      )}

      {/* Timeline */}
      <div className="relative max-h-[400px] overflow-y-auto">
        {loading && (
          <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-6">Loading…</p>
        )}

        {!loading && filtered.length === 0 && (
          <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-8">No activity yet.</p>
        )}

        <ol className="relative">
          {/* Vertical line */}
          {paginated.length > 0 && (
            <div className="absolute left-[27px] top-4 bottom-4 w-px bg-slate-200 dark:bg-slate-700 pointer-events-none" />
          )}

          {paginated.map(entry => {
            const isVoided = entry.voided_at != null
            return (
              <li key={entry.id}
                className={`flex gap-3 px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700/30
                  ${isVoided ? 'opacity-50' : ''}`}
              >
                {/* Icon bubble */}
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-700
                                flex items-center justify-center text-base z-10"
                     aria-hidden>
                  {activity.icon(entry.log_type)}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0 pt-0.5">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-sm font-medium text-slate-500 dark:text-slate-400">
                      {activity.label(entry.log_type)}
                    </span>
                    {isVoided && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-sm font-medium
                                       bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400">
                        VOIDED
                      </span>
                    )}
                    {entry.is_pinned === 1 && (
                      <span className="text-sm text-amber-600 dark:text-amber-400">📌 Pinned</span>
                    )}
                    {noteDays(entry).backdated ? (
                      <span className="ml-auto text-sm text-slate-500 dark:text-slate-400 flex-shrink-0 text-right" title={`Written ${formatDateTime(entry.created_at)}`}>
                        <time dateTime={noteDays(entry).happened} className="block">{formatDate(noteDays(entry).happened)}</time>
                        <span className="block">(written {formatDate(noteDays(entry).written)})</span>
                      </span>
                    ) : (
                      <time
                        dateTime={entry.created_at}
                        className="ml-auto text-sm text-slate-500 dark:text-slate-400 flex-shrink-0 text-right"
                      >
                        <span>{relativeTime(entry.created_at)}</span>
                        <span className="block text-slate-400/70 dark:text-slate-500/70">{formatDateTime(entry.created_at)}</span>
                      </time>
                    )}
                  </div>
                  <p className={`text-sm mt-0.5 line-clamp-3 whitespace-pre-wrap leading-relaxed
                    ${isVoided ? 'line-through text-slate-500 dark:text-slate-400' : ''}
                    ${!isVoided && entry.log_type === 'system'
                      ? 'text-slate-500 dark:text-slate-400 italic'
                      : !isVoided ? 'text-slate-800 dark:text-slate-200' : ''
                    }`}>
                    {entry.content}
                  </p>
                  {isVoided && entry.voided_reason && (
                    <p className="text-sm text-red-600 dark:text-red-400 mt-0.5 italic">
                      {entry.voided_reason}
                    </p>
                  )}
                  {!isVoided && entry.edited_at && (
                    <CaseLogEditHistory entryId={entry.id} editedAt={entry.edited_at} originalContent={entry.original_content ?? null} />
                  )}
                  {entry.follow_up_date && (
                    <p className="text-sm text-amber-600 dark:text-amber-400 mt-0.5">
                      📅 Follow-up: {(() => { const [y = NaN, m = NaN, d = NaN] = entry.follow_up_date.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString() })()}
                      {entry.follow_up_completed ? ' ✓' : ''}
                    </p>
                  )}
                </div>
              </li>
            )
          })}
        </ol>

        {/* Load more */}
        {hasMore && (
          <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-700/50 text-center">
            <button
              onClick={() => setPage(p => p + 1)}
              className="hit-44 flex items-center gap-1.5 mx-auto text-base text-blue-600 dark:text-blue-400
                         hover:text-blue-800 dark:hover:text-blue-200
                         focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 rounded-sm"
            >
              <ChevronDown className="w-4 h-4" />
              Load more ({filtered.length - paginated.length} remaining)
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
