import React, { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Column } from '../../../shared/types'
import { parseLinkValue, type LinkColumnConfig } from '../../../shared/links'
import { useLinkStore } from '../../stores/linkStore'

const MAX_CHIPS = 3

/**
 * A link column's cell (W04 §7.2): the linked records as chips, up to three
 * and then "+2". Clicking a chip opens that record. Archived records are muted.
 */
export function LinkCell({ value, parsedConfig }: { column: Column; value: string | null; parsedConfig?: Record<string, unknown> }): React.ReactElement {
  const navigate = useNavigate()
  const cfg = parsedConfig as Partial<LinkColumnConfig> | undefined
  const type = useLinkStore(s => s.types.find(t => t.id === cfg?.link_type_id))
  const isLoaded = useLinkStore(s => s.isLoaded)
  useEffect(() => { if (!isLoaded) void useLinkStore.getState().load() }, [isLoaded])

  const chips = parseLinkValue(value)
  if (chips.length === 0) return <span className="text-slate-300 dark:text-slate-500">—</span>
  if (cfg?.show === 'count') return <span className="tabular-nums">{chips.length}</span>

  const otherGridId = type ? (cfg?.direction === 'backward' ? type.from_grid_id : type.to_grid_id) : null
  const shown = chips.slice(0, MAX_CHIPS)
  return (
    <span className="flex items-center gap-1 min-w-0 overflow-hidden" title={chips.map(c => c.name).join(', ')}>
      {shown.map(c => (
        <button key={c.rowId} type="button" tabIndex={-1}
          onClick={e => { e.stopPropagation(); navigate(otherGridId ? `/profile/${c.rowId}?gridId=${otherGridId}` : `/profile/${c.rowId}`) }}
          className={`truncate max-w-[12rem] px-2 py-0.5 rounded-full border text-sm hover:underline focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 ${
            c.archived
              ? 'border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 italic'
              : 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200'
          }`}>
          {c.name || '(unnamed)'}
        </button>
      ))}
      {chips.length > MAX_CHIPS && <span className="text-sm text-slate-500 dark:text-slate-400 flex-shrink-0">+{chips.length - MAX_CHIPS}</span>}
    </span>
  )
}
