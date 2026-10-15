import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGridStore } from '../../stores/gridStore'
import { useVocab } from '../../hooks/useVocab'
import { pulseEvents } from '../../events'
import { IS_MAC } from '../../utils/keys'
import { IPC } from '../../../shared/ipc-channels'
import type { ElsewhereMatches, SearchElsewhere } from '../../../shared/ipc-contract'
import { safeInvoke } from '../../utils/safeInvoke'
import { SecondaryButton } from '../ui/Button'

/** How long after typing stops the Trash and the archive are asked */
export const ELSEWHERE_DEBOUNCE_MS = 300

// Messages the grid shows around (not inside) the table: a list that couldn't
// be opened, and a list with no records to show.

export function GridLoadError({ message, onRetry }: { message: string; onRetry: () => void }): React.ReactElement {
  return (
    <div role="alert" className="flex flex-col items-center justify-center h-full gap-4 px-6 text-center">
      <p className="text-base text-slate-700 dark:text-slate-300">{message} Your data is safe.</p>
      <button type="button" className="btn-primary" onClick={onRetry}>
        Try again
      </button>
    </div>
  )
}

export interface GridEmptyRecordsProps {
  searchQuery: string
  /** The list has records, but the filters hide them all */
  hasRecords: boolean
}

export function GridEmptyRecords({ searchQuery, hasRecords }: GridEmptyRecordsProps): React.ReactElement {
  const { t } = useVocab()
  return (
    <div className="flex-1 overflow-auto flex flex-col items-center justify-center py-16 px-6 text-center">
      {searchQuery ? (
        <>
          <p className="text-base text-slate-500 dark:text-slate-400">
            No {t('record', { many: true })} found matching &ldquo;{searchQuery}&rdquo;
          </p>
          <SearchElsewhereLines query={searchQuery} />
        </>
      ) : hasRecords ? (
        <>
          <h3 className="text-base font-semibold text-slate-700 dark:text-slate-300 mb-3">
            No {t('record', { many: true })} match your filters
          </h3>
          <button type="button" className="btn-secondary" onClick={() => {
            useGridStore.setState({ activeFilters: [], showStarredOnly: false })
            useGridStore.getState().setActiveCustomGroupId(null)
          }}>
            Clear filters
          </button>
        </>
      ) : (
        <>
          <h3 className="text-base font-semibold text-slate-700 dark:text-slate-300 mb-1">
            No {t('record', { many: true })} yet
          </h3>
          <p className="text-base text-slate-500 dark:text-slate-400 mb-4">
            Add your first {t('record')}{' '}
            (or press <kbd className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-base font-mono">{IS_MAC ? '⌘N' : 'Ctrl+N'}</kbd>),
            or bring them in from a spreadsheet.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button type="button" className="btn-primary" onClick={() => void useGridStore.getState().addRow()}>
              Add {t('record', { cap: true })}
            </button>
            <button type="button" className="btn-secondary" onClick={() => pulseEvents.emit('grid:open-import')}>
              Bring in a spreadsheet
            </button>
            <button type="button" className="btn-secondary" onClick={() => pulseEvents.emit('starters:open', { sample: true })}>
              See an example with sample data
            </button>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Under "No … found": whether a match is in the Trash or archived, each with a Show
 * (persona study R3: "No clients found" for a home in the Trash made Joe panic).
 */
function SearchElsewhereLines({ query }: { query: string }): React.ReactElement | null {
  const { t } = useVocab()
  const navigate = useNavigate()
  const gridId = useGridStore(s => s.activeGridId)
  const showArchived = useGridStore(s => s.showArchived)
  const [found, setFound] = useState<SearchElsewhere | null>(null)
  const q = query.trim().slice(0, 200)

  useEffect(() => {
    setFound(null)
    if (!q || gridId == null) return
    let current = true
    const timer = setTimeout(() => {
      void safeInvoke(IPC.ROW_SEARCH_ELSEWHERE, gridId, q).then(r => { if (current && r.ok) setFound(r.data) })
    }, ELSEWHERE_DEBOUNCE_MS)
    return () => { current = false; clearTimeout(timer) }
  }, [q, gridId])

  if (!found) return null
  const who = (m: ElsewhereMatches) => {
    const name = m.firstName ?? `One ${t('record')} with no name`
    return m.count > 1 ? `${name} and ${m.count - 1} more` : name
  }
  const verb = (m: ElsewhereMatches) => m.count > 1 ? 'are' : 'is'
  const lines: Array<{ key: string; text: string; label: string; show: () => void }> = []
  if (found.trashed.count > 0) lines.push({
    key: 'trash', text: `${who(found.trashed)} ${verb(found.trashed)} in the Trash`, label: `Show the Trash, searching for "${q}"`,
    show: () => navigate(`/trash?q=${encodeURIComponent(q)}`),
  })
  // With archived shown, an archived match would be in the list already
  if (found.archived.count > 0 && !showArchived) lines.push({
    key: 'archived', text: `${who(found.archived)} ${verb(found.archived)} archived`, label: `Show archived ${t('record', { many: true })}, keeping the search`,
    show: () => useGridStore.getState().setShowArchived(true),
  })
  if (lines.length === 0) return null
  return (
    <ul className="mt-4 space-y-2" aria-live="polite" data-testid="search-elsewhere">
      {lines.map(l => (
        <li key={l.key} className="flex flex-wrap items-center justify-center gap-3 text-base text-slate-700 dark:text-slate-200">
          <span>{l.text}</span>
          <SecondaryButton aria-label={l.label} onClick={l.show}>Show</SecondaryButton>
        </li>
      ))}
    </ul>
  )
}
