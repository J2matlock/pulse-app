import React, { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Column } from '../../../shared/types'
import { parseLinkValue, type LinkColumnConfig } from '../../../shared/links'
import { useLinkStore } from '../../stores/linkStore'
import { modHelp } from '../../utils/keys'
import { useVocabByList } from '../../hooks/useVocab'

const MAX_CHIPS = 3

// Rough widths at 15px/14px, to show only the chips that fit instead of squeezing all to "Re…"
const CHIP_CHAR = 7.5
const CHIP_PAD = 30
const CHIP_MAX = 192
const CELL_PAD = 24
const MORE_ROOM = 34

/** The chips that fit in a cell this wide, at least one (it truncates) */
export function chipsThatFit<T extends { name: string }>(chips: T[], width: number): T[] {
  const room = width - CELL_PAD - (chips.length > 1 ? MORE_ROOM : 0)
  const out: T[] = []
  let used = 0
  for (const c of chips.slice(0, MAX_CHIPS)) {
    const w = Math.min((c.name || '(unnamed)').length * CHIP_CHAR + CHIP_PAD, CHIP_MAX) + 4
    if (out.length > 0 && used + w > room) break
    out.push(c)
    used += w
  }
  return out
}

/**
 * A link column's cell (W04 §7.2): the linked records as chips, as many as
 * fit (up to three) and then "+2". Clicking a chip opens that record. Archived records are muted.
 */
export function LinkCell({ column, value, parsedConfig }: { column: Column; value: string | null; parsedConfig?: Record<string, unknown> }): React.ReactElement {
  const navigate = useNavigate()
  const tFor = useVocabByList()
  const cfg = parsedConfig as Partial<LinkColumnConfig> | undefined
  const type = useLinkStore(s => s.types.find(t => t.id === cfg?.link_type_id))
  const isLoaded = useLinkStore(s => s.isLoaded)
  useEffect(() => { if (!isLoaded) void useLinkStore.getState().load() }, [isLoaded])

  const chips = parseLinkValue(value)
  if (chips.length === 0) return <span className="text-slate-300 dark:text-slate-500">—</span>
  if (cfg?.show === 'count') return <span className="tabular-nums">{chips.length}</span>

  const otherGridId = type ? (cfg?.direction === 'backward' ? type.from_grid_id : type.to_grid_id) : null
  const shown = chipsThatFit(chips, column.width || 160)
  return (
    <span className="flex items-center gap-1 min-w-0 overflow-hidden" title={chips.map(c => c.name).join(', ')}>
      {shown.map(c => (
        <button key={c.rowId} type="button" tabIndex={-1}
          title={modHelp(`Ctrl+click to open ${c.name || `this ${tFor(otherGridId)('record')}`}`)}
          // A click selects the cell like any other; Ctrl+click opens the linked record (G-31)
          onClick={e => {
            if (!(e.ctrlKey || e.metaKey)) return
            e.stopPropagation()
            navigate(otherGridId ? `/profile/${c.rowId}?gridId=${otherGridId}` : `/profile/${c.rowId}`)
          }}
          className={`truncate min-w-0 max-w-[12rem] px-2 py-0.5 rounded-full border text-sm hover:underline focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500 ${
            c.archived
              ? 'border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 italic'
              : 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200'
          }`}>
          {c.name || '(unnamed)'}
        </button>
      ))}
      {chips.length > shown.length && <span className="text-sm text-slate-500 dark:text-slate-400 flex-shrink-0">+{chips.length - shown.length}</span>}
    </span>
  )
}
