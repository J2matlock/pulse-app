import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { X, ChevronUp, ChevronDown, ArrowRightLeft } from 'lucide-react'
import type { GridRow, Column, ColumnType } from '../../../shared/types'
import { columnOptionLabels } from '../../../shared/stages'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { SEARCHABLE_TYPES as SEARCH_TYPES } from '../../utils/searchMatch'
import { useVocab } from '../../hooks/useVocab'

/** Find & Replace changes stored text, so it skips worked-out and linked columns the search also reads */
const SEARCHABLE_TYPES = new Set<ColumnType>([...SEARCH_TYPES].filter(t => !['auto_number', 'link', 'tag'].includes(t)) as ColumnType[])

/**
 * Numbers, money and choices match and replace the whole value: replacing
 * "1" with "2" must not turn 1,150 into 2,250, and a choice can only become
 * another choice (G-27).
 */
const WHOLE_VALUE_TYPES = new Set<string>(['number', 'currency', 'status', 'dropdown'])

/** The replacement for one match, or null when it can't be used there */
export function replacementFor(col: Column, value: string, find: string, replace: string): string | null {
  if (WHOLE_VALUE_TYPES.has(col.column_type)) {
    if (value.trim().toLowerCase() !== find.trim().toLowerCase()) return null
    const options = columnOptionLabels(col)
    if (options.length > 0 && replace !== '') {
      const hit = options.find(o => o.toLowerCase() === replace.trim().toLowerCase())
      return hit ?? null
    }
    if ((col.column_type === 'number' || col.column_type === 'currency') && replace.trim() !== '' && isNaN(Number(replace.trim()))) return null
    return replace.trim()
  }
  return value.replace(new RegExp(escapeRegex(find), 'gi'), replace)
}

interface FindMatch {
  rowId: number
  colId: number
  value: string
}

interface FindReplaceBarProps {
  open: boolean
  onClose: () => void
  rows: GridRow[]
  columns: Column[]
  onReplace: (rowId: number, colId: number, oldVal: string, newVal: string) => Promise<void>
  onReplaceAll: (replacements: Array<{ rowId: number; colId: number; oldVal: string; newVal: string }>) => Promise<void>
  onHighlightChange: (query: string) => void
  onActiveMatchChange: (match: { rowId: number; colId: number } | null) => void
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function FindReplaceBar({ open, onClose, rows, columns, onReplace, onReplaceAll, onHighlightChange, onActiveMatchChange }: FindReplaceBarProps): React.ReactElement | null {
  const { t } = useVocab()
  const [confirmAll, setConfirmAll] = useState<{ replacements: Array<{ rowId: number; colId: number; oldVal: string; newVal: string }>; records: number; skipped: number } | null>(null)
  const [findText, setFindText] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0)
  const [debouncedFind, setDebouncedFind] = useState('')
  const findRef = useRef<HTMLInputElement>(null)

  // Focus find input when bar opens
  useEffect(() => {
    if (open) {
      setTimeout(() => findRef.current?.focus(), 50)
    } else {
      setFindText('')
      setReplaceText('')
      setCurrentMatchIndex(0)
      setDebouncedFind('')
      onHighlightChange('')
      onActiveMatchChange(null)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Debounce find input at 200ms
  useEffect(() => {
    const id = setTimeout(() => {
      setDebouncedFind(findText)
      onHighlightChange(findText)
    }, 200)
    return () => clearTimeout(id)
  }, [findText]) // eslint-disable-line react-hooks/exhaustive-deps

  // Searchable columns (visible + searchable type)
  const searchableColumns = useMemo(
    () => columns.filter(c => c.is_visible === 1 && SEARCHABLE_TYPES.has(c.column_type)),
    [columns]
  )

  // Find all matches, in the rows given (the ones on screen, in screen order)
  const matches: FindMatch[] = useMemo(() => {
    if (!debouncedFind) return []
    const result: FindMatch[] = []
    const lowerFind = debouncedFind.toLowerCase()
    for (const row of rows) {
      for (const col of searchableColumns) {
        const cellValue = row[`col_${col.id}` as keyof GridRow] as string | null
        if (!cellValue) continue
        const hit = WHOLE_VALUE_TYPES.has(col.column_type)
          ? cellValue.trim().toLowerCase() === lowerFind.trim()
          : cellValue.toLowerCase().includes(lowerFind)
        if (hit) result.push({ rowId: row.row_id, colId: col.id, value: cellValue })
      }
    }
    return result
  }, [debouncedFind, rows, searchableColumns])
  const columnById = useMemo(() => new Map(columns.map(c => [c.id, c])), [columns])

  // Clamp currentMatchIndex when matches change
  useEffect(() => {
    if (matches.length === 0) {
      setCurrentMatchIndex(0)
    } else if (currentMatchIndex >= matches.length) {
      setCurrentMatchIndex(0)
    }
  }, [matches.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // Push active match to parent for highlighting
  useEffect(() => {
    const match = matches[currentMatchIndex]
    if (match) {
      onActiveMatchChange({ rowId: match.rowId, colId: match.colId })
    } else {
      onActiveMatchChange(null)
    }
  }, [currentMatchIndex, matches]) // eslint-disable-line react-hooks/exhaustive-deps

  const goToNext = useCallback(() => {
    if (matches.length === 0) return
    setCurrentMatchIndex(i => (i + 1) % matches.length)
  }, [matches.length])

  const goToPrev = useCallback(() => {
    if (matches.length === 0) return
    setCurrentMatchIndex(i => (i - 1 + matches.length) % matches.length)
  }, [matches.length])

  const handleReplace = useCallback(async () => {
    if (matches.length === 0 || !debouncedFind) return
    const match = matches[currentMatchIndex]
    const col = match ? columnById.get(match.colId) : undefined
    if (!match || !col) return
    const newVal = replacementFor(col, match.value, debouncedFind, replaceText)
    if (newVal === null) return
    await onReplace(match.rowId, match.colId, match.value, newVal)
  }, [matches, currentMatchIndex, debouncedFind, replaceText, onReplace, columnById])

  // Replace All asks first, with the counts (G-27)
  const handleReplaceAll = useCallback(() => {
    if (matches.length === 0 || !debouncedFind) return
    const replacements: Array<{ rowId: number; colId: number; oldVal: string; newVal: string }> = []
    let skipped = 0
    for (const m of matches) {
      const col = columnById.get(m.colId)
      const newVal = col ? replacementFor(col, m.value, debouncedFind, replaceText) : null
      if (newVal === null) skipped++
      else replacements.push({ rowId: m.rowId, colId: m.colId, oldVal: m.value, newVal })
    }
    setConfirmAll({ replacements, records: new Set(replacements.map(r => r.rowId)).size, skipped })
  }, [matches, debouncedFind, replaceText, columnById])

  const handleFindKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) goToPrev()
      else goToNext()
    }
  }, [onClose, goToNext, goToPrev])

  const handleReplaceKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      void handleReplace()
    }
  }, [onClose, handleReplace])

  if (!open) return null

  const hasMatches = matches.length > 0
  const hasFind = debouncedFind.length > 0

  return (
    <div
      className="absolute right-3 top-2 z-50 w-[340px]
                 bg-white dark:bg-slate-800
                 border border-slate-200 dark:border-slate-600
                 rounded-xl shadow-xl
                 ring-1 ring-black/5 dark:ring-white/5"
      role="search"
      aria-label="Find and replace"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
        <div className="flex items-center gap-1.5">
          <ArrowRightLeft className="w-3.5 h-3.5 text-blue-500" />
          <span className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            Find & Replace
          </span>
        </div>
        <button
          onClick={onClose}
          title="Close (Esc)"
          aria-label="Close find and replace"
          className="hit-44 p-1 rounded-md text-slate-500 hover:text-slate-600 dark:hover:text-slate-300
                     hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors
                     focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Find row */}
      <div className="px-3 py-1.5">
        <div className="relative">
          <input
            ref={findRef}
            type="text"
            placeholder="Find in grid..."
            value={findText}
            onChange={e => setFindText(e.target.value)}
            onKeyDown={handleFindKeyDown}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600
                       bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100
                       text-[15px] placeholder-slate-500 dark:placeholder-slate-400
                       focus:outline-hidden focus:ring-3 focus:ring-blue-500 focus:border-blue-500
                       focus:bg-white dark:focus:bg-slate-800
                       pr-24 transition-colors"
            style={{ minHeight: 40 }}
            aria-label="Find text"
          />
          {/* Match counter + nav inside input area */}
          <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
            <span className={`text-sm px-1.5 py-0.5 rounded font-medium min-w-[3rem] text-center
              ${hasFind && !hasMatches
                ? 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20'
                : 'text-slate-500 dark:text-slate-400'
              }`}>
              {hasFind
                ? hasMatches
                  ? `${currentMatchIndex + 1} / ${matches.length}`
                  : '0 / 0'
                : ''}
            </span>
            <button
              onClick={goToPrev}
              disabled={!hasMatches}
              title="Previous (Shift+Enter)"
              aria-label="Previous match"
              className="hit-44 p-1 rounded text-slate-500 hover:text-slate-600 dark:hover:text-slate-300
                         hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors
                         disabled:opacity-25 disabled:cursor-not-allowed disabled:hover:bg-transparent
                         focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={goToNext}
              disabled={!hasMatches}
              title="Next (Enter)"
              aria-label="Next match"
              className="hit-44 p-1 rounded text-slate-500 hover:text-slate-600 dark:hover:text-slate-300
                         hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors
                         disabled:opacity-25 disabled:cursor-not-allowed disabled:hover:bg-transparent
                         focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Replace row */}
      <div className="px-3 pt-0.5 pb-2.5">
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Replace with..."
            value={replaceText}
            onChange={e => setReplaceText(e.target.value)}
            onKeyDown={handleReplaceKeyDown}
            className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600
                       bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100
                       text-[15px] placeholder-slate-500 dark:placeholder-slate-400
                       focus:outline-hidden focus:ring-3 focus:ring-blue-500 focus:border-blue-500
                       focus:bg-white dark:focus:bg-slate-800
                       transition-colors"
            style={{ minHeight: 40 }}
            aria-label="Replace text"
          />
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={() => void handleReplace()}
            disabled={!hasMatches || !hasFind}
            title="Replace current match (Enter in replace field)"
            className="hit-44 flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-base font-medium
                       text-slate-700 dark:text-slate-200
                       bg-slate-100 dark:bg-slate-700
                       hover:bg-slate-200 dark:hover:bg-slate-600
                       border border-slate-200 dark:border-slate-600
                       transition-colors
                       disabled:opacity-30 disabled:cursor-not-allowed
                       focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
            style={{ minHeight: 36 }}
          >
            Replace
          </button>
          <button
            onClick={handleReplaceAll}
            disabled={!hasMatches || !hasFind}
            title="Replace all matches"
            className="hit-44 flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-base font-medium
                       text-white
                       bg-blue-600 hover:bg-blue-700
                       dark:bg-blue-500 dark:hover:bg-blue-600
                       transition-colors
                       disabled:opacity-30 disabled:cursor-not-allowed
                       focus:outline-hidden focus-visible:ring-3 focus-visible:ring-blue-500"
            style={{ minHeight: 36 }}
          >
            Replace All
          </button>
        </div>
      </div>
      <ConfirmDialog
        open={confirmAll !== null}
        destructive={false}
        title={confirmAll && confirmAll.replacements.length > 0
          ? `Replace in ${confirmAll.replacements.length} ${confirmAll.replacements.length === 1 ? 'cell' : 'cells'} across ${confirmAll.records} ${t('record', { count: confirmAll.records })}?`
          : 'Nothing can be replaced'}
        message={confirmAll && confirmAll.skipped > 0
          ? `${confirmAll.skipped} ${confirmAll.skipped === 1 ? 'match is' : 'matches are'} left alone: "${replaceText}" isn't a number or one of the column's choices there. You can undo this.`
          : 'You can undo this.'}
        confirmLabel="Replace"
        onConfirm={() => {
          const all = confirmAll
          setConfirmAll(null)
          if (all && all.replacements.length > 0) void onReplaceAll(all.replacements)
        }}
        onCancel={() => setConfirmAll(null)}
      />
    </div>
  )
}
