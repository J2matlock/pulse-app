/**
 * The link picker (W04 §7.2): search the other list, link or unlink with a
 * click or the keyboard, or add a new record there and link it.
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Plus, Check } from 'lucide-react'
import { IPC } from '../../../shared/ipc-channels'
import { holdsOne, parseLinkValue, type LinkChip, type LinkColumnConfig, type LinkDirection, type LinkType, type LinkedRecord } from '../../../shared/links'
import { useLinkStore } from '../../stores/linkStore'
import { safeInvoke } from '../../utils/safeInvoke'
import { linkRecords, unlinkRecords, createAndLink } from '../../utils/linkActions'
import { useVocab } from '../../hooks/useVocab'

export interface LinkPickerProps {
  type: LinkType
  direction: LinkDirection
  rowId: number
  /** The links this record has now */
  chips: LinkChip[]
  /** Element to open under; without one the picker shows inline */
  anchor?: HTMLElement | null
  onClose: () => void
}

const WIDTH = 340

export function LinkPicker({ type, direction, rowId, chips, anchor, onClose }: LinkPickerProps): React.ReactElement {
  const otherGridId = direction === 'forward' ? type.to_grid_id : type.from_grid_id
  const label = direction === 'forward' ? type.label_forward : type.label_backward
  const single = holdsOne(type.cardinality, direction)
  const { t } = useVocab(otherGridId)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<LinkedRecord[]>([])
  const [active, setActive] = useState(0)
  const [busy, setBusy] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const linked = new Set(chips.map(c => c.rowId))

  useLayoutEffect(() => {
    if (!anchor) return
    const r = anchor.getBoundingClientRect()
    const left = Math.max(8, Math.min(r.left, window.innerWidth - WIDTH - 8))
    const below = r.bottom + 4
    setPos({ top: below + 360 > window.innerHeight ? Math.max(8, r.top - 364) : below, left })
  }, [anchor])

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      void safeInvoke<LinkedRecord[]>(IPC.RECORD_LINK_SEARCH, type.id, direction, query).then(res => {
        if (!cancelled && res.ok) { setResults(res.data); setActive(0) }
      })
    }, 120)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [type.id, direction, query])

  // Close when clicking outside
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) onClose() }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])

  const canCreate = query.trim().length > 0 && !results.some(r => r.display_name.trim().toLowerCase() === query.trim().toLowerCase())
  const options = results.length + (canCreate ? 1 : 0)

  async function pick(r: LinkedRecord) {
    if (busy) return
    setBusy(true)
    try {
      if (linked.has(r.row_id)) await unlinkRecords(type.id, direction, rowId, r.row_id, r.display_name)
      else if (await linkRecords(type.id, direction, rowId, r.row_id, r.display_name) && single) onClose()
    } finally { setBusy(false) }
  }

  async function create() {
    if (busy || !query.trim()) return
    setBusy(true)
    try {
      if (await createAndLink(type.id, direction, rowId, query) !== null) {
        setQuery('')
        if (single) onClose()
      }
    } finally { setBusy(false) }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, Math.max(options - 1, 0))) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') {
      e.preventDefault(); e.stopPropagation()
      if (active < results.length) void pick(results[active]!)
      else if (canCreate) void create()
    }
    // Keep grid shortcuts from acting on the cell underneath
    e.stopPropagation()
  }

  const listId = `link-picker-${type.id}-${direction}-${rowId}`
  const box = (
    <div ref={boxRef} role="dialog" aria-label={`${label}: choose`} onKeyDown={onKeyDown} onMouseDown={e => e.stopPropagation()}
      className={`${anchor ? 'fixed z-[300]' : ''} w-[340px] max-w-[calc(100vw-16px)] rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-2xl p-2 space-y-2`}
      style={anchor && pos ? { top: pos.top, left: pos.left } : undefined}>
      <div className="flex items-center justify-between px-1">
        <span className="text-base font-medium text-slate-800 dark:text-slate-100">{label}</span>
        <button type="button" aria-label="Close" onClick={onClose}
          className="hit-44 p-1.5 rounded-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
          <X className="w-4 h-4" />
        </button>
      </div>
      {chips.length > 0 && (
        <ul className="flex flex-wrap gap-1" aria-label="Linked now">
          {chips.map(c => (
            <li key={c.rowId} className="flex items-center gap-1 pl-2.5 rounded-full bg-blue-50 dark:bg-blue-900/30 text-sm text-blue-800 dark:text-blue-200">
              {c.name || '(unnamed)'}
              <button type="button" aria-label={`Unlink ${c.name}`} disabled={busy}
                onClick={() => void unlinkRecords(type.id, direction, rowId, c.rowId, c.name)}
                className="hit-44 p-1.5 rounded-full hover:text-red-600 focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500">
                <X className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <input type="search" className="input w-full" autoFocus value={query} onChange={e => setQuery(e.target.value)}
        placeholder={`Search ${direction === 'forward' ? type.to_grid_name : type.from_grid_name}…`}
        role="combobox" aria-expanded="true" aria-controls={listId} aria-label={`Search ${t('record', { many: true })}`}
        aria-activedescendant={options ? `${listId}-${active}` : undefined} />
      <ul id={listId} role="listbox" className="max-h-64 overflow-y-auto">
        {results.map((r, i) => (
          <li key={r.row_id} id={`${listId}-${i}`} role="option" aria-selected={i === active}
            onMouseEnter={() => setActive(i)} onClick={() => void pick(r)}
            className={`flex items-center gap-2 px-2.5 rounded-lg cursor-pointer text-base ${i === active ? 'bg-blue-100 dark:bg-blue-900/40' : ''} ${r.is_active ? 'text-slate-800 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400 italic'}`}
            style={{ minHeight: 44 }}>
            <span className="w-4 flex-shrink-0">{linked.has(r.row_id) && <Check className="w-4 h-4 text-blue-600" aria-label="linked" />}</span>
            <span className="truncate">{r.display_name || '(unnamed)'}</span>
            {!r.is_active && <span className="text-sm ml-auto">archived</span>}
          </li>
        ))}
        {canCreate && (
          <li id={`${listId}-${results.length}`} role="option" aria-selected={active === results.length}
            onMouseEnter={() => setActive(results.length)} onClick={() => void create()}
            className={`flex items-center gap-2 px-2.5 rounded-lg cursor-pointer text-base text-blue-700 dark:text-blue-300 ${active === results.length ? 'bg-blue-100 dark:bg-blue-900/40' : ''}`}
            style={{ minHeight: 44 }}>
            <Plus className="w-4 h-4" />New {t('record')}: “{query.trim()}”
          </li>
        )}
        {results.length === 0 && !canCreate && <li className="px-2.5 py-2 text-sm text-slate-500 dark:text-slate-400">Nothing matches that name.</li>}
      </ul>
    </div>
  )
  return anchor ? createPortal(box, document.body) : box
}

/** The picker for a link column's cell in the grid, once its link type is known. */
export function GridLinkEditor({ parsedConfig, rowId, value, anchor, onClose }: {
  parsedConfig?: Record<string, unknown>; rowId: number; value: string | null; anchor: HTMLElement | null; onClose: () => void
}): React.ReactElement | null {
  const cfg = parsedConfig as Partial<LinkColumnConfig> | undefined
  const type = useLinkStore(s => s.types.find(x => x.id === cfg?.link_type_id))
  const isLoaded = useLinkStore(s => s.isLoaded)
  useEffect(() => { if (!isLoaded) void useLinkStore.getState().load() }, [isLoaded])
  if (!type) return null
  return <LinkPicker type={type} direction={cfg?.direction === 'backward' ? 'backward' : 'forward'} rowId={rowId} chips={parseLinkValue(value)} anchor={anchor} onClose={onClose} />
}
