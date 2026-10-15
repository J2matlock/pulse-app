import React from 'react'
import { useGridStore } from '../../stores/gridStore'
import { useVocab } from '../../hooks/useVocab'
import { pulseEvents } from '../../events'
import { IS_MAC } from '../../utils/keys'

// Messages the grid shows around (not inside) the table: the first-use tip,
// a list that couldn't be opened, and a list with no records to show.

export function GridHintBanner({ onDismiss }: { onDismiss: () => void }): React.ReactElement {
  const { t } = useVocab()
  return (
    <div className="flex items-center justify-between bg-blue-50 dark:bg-blue-900/20 text-sm text-blue-600 dark:text-blue-300 px-3 py-1.5 flex-shrink-0">
      {/* Mouse-first, one line, no shortcuts (Help has them) (UX-B-02, UX-A-09) */}
      <span>Tip: click a column name to sort. The ⋯ next to it has deadline rules, hiding and more. The person icon opens {t('record', { article: true })}'s page.</span>
      <button
        onClick={onDismiss}
        className="hit-44 ml-3 p-0.5 rounded hover:bg-blue-100 dark:hover:bg-blue-800/40 text-blue-400 dark:text-blue-400"
        aria-label="Dismiss tip"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}

export function GridLoadError({ message, onRetry }: { message: string; onRetry: () => void }): React.ReactElement {
  return (
    <div role="alert" className="flex flex-col items-center justify-center h-full gap-4 px-6 text-center">
      <p className="text-base text-slate-700 dark:text-slate-300">{message} Please try again.</p>
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
        <p className="text-base text-slate-500 dark:text-slate-400">
          No {t('record', { many: true })} found matching &ldquo;{searchQuery}&rdquo;
        </p>
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
