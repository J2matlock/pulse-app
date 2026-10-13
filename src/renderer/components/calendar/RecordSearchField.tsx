/**
 * Find a record by name, across lists: the "With" field of the appointment
 * dialog and the record picker of "Deadline for a record".
 */
import React, { useEffect, useState } from 'react'
import { IPC } from '../../../shared/ipc-channels'
import type { CrossGridSearchResult } from '../../../shared/ipc-contract'
import { safeInvoke } from '../../utils/safeInvoke'
import { useVocab } from '../../hooks/useVocab'

export interface PickedRecord { rowId: number; gridId: number; name: string; gridName?: string }

export interface RecordSearchFieldProps {
  value: PickedRecord | null
  onChange: (record: PickedRecord | null) => void
  /** Shown in the empty box */
  placeholder?: string
  autoFocus?: boolean
}

export function RecordSearchField({ value, onChange, placeholder, autoFocus }: RecordSearchFieldProps): React.ReactElement {
  const { t } = useVocab(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CrossGridSearchResult[]>([])

  useEffect(() => {
    if (!query.trim()) { setResults([]); return }
    const timer = setTimeout(() => {
      void safeInvoke<CrossGridSearchResult[]>(IPC.SEARCH_CLIENTS_CROSS_GRID, query.trim()).then(r => setResults(r.ok ? r.data.slice(0, 8) : []))
    }, 150)
    return () => clearTimeout(timer)
  }, [query])

  if (value) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-base text-slate-800 dark:text-slate-100">{value.name || '(unnamed)'}</span>
        <button type="button" className="btn-compact-secondary" onClick={() => onChange(null)}>Change</button>
      </div>
    )
  }
  return (
    <div>
      <input type="search" className="input w-full" aria-label={`Find ${t('record', { article: true })}`} value={query} autoFocus={autoFocus}
        onChange={e => setQuery(e.target.value)} placeholder={placeholder ?? `Search ${t('record', { many: true })}`} />
      {results.length > 0 && (
        <ul className="mt-1 rounded-lg border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700" aria-label="Matches">
          {results.map(r => (
            <li key={r.rowId}>
              <button type="button" className="w-full text-left px-3 text-base text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500" style={{ minHeight: 44 }}
                onClick={() => { onChange({ rowId: r.rowId, gridId: r.gridId, name: r.clientName, gridName: r.gridName }); setQuery('') }}>
                {r.clientName} <span className="text-sm text-slate-500 dark:text-slate-400">{r.gridName}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
