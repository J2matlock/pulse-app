import React, { useRef, useEffect, useState, useId } from 'react'
import type { Column } from '../../../shared/types'
import type { NavDirection } from '../../hooks/useGridCellNavigation'
import { toYmd, MIN_YEAR, MAX_YEAR } from '../../../shared/ymd'

export type { NavDirection }

interface Props {
  column: Column
  value: string | null
  onSave: (value: string | null, navDirection?: NavDirection) => void
  onCancel: () => void
}

const BASE_STYLE: React.CSSProperties = {
  width: '100%',
  height: '100%',
  border: 'none',
  outline: '3px solid #2563EB',
  outlineOffset: '-3px',
  padding: '0 12px',
  fontSize: '15px',
  fontFamily: 'inherit',
  boxSizing: 'border-box'
}

// Colors come from classes so an open editor follows dark mode, native date and select pickers included
const EDITOR_CLASS = 'bg-white text-slate-800 dark:bg-slate-800 dark:text-slate-100'
// A date needs its room for the digits and the calendar button in a narrow cell
const DATE_STYLE: React.CSSProperties = { ...BASE_STYLE, padding: '0 4px 0 8px' }
const CHECKBOX_STYLE: React.CSSProperties = { ...BASE_STYLE, display: 'flex', alignItems: 'center', padding: '0 12px' }
const SELECT_STYLE: React.CSSProperties = { ...BASE_STYLE, cursor: 'pointer' }
const TEXTAREA_NOTES_STYLE: React.CSSProperties = { ...BASE_STYLE, resize: 'none', padding: '8px 12px', height: 88 }
const TEXTAREA_ADDRESS_STYLE: React.CSSProperties = { ...BASE_STYLE, resize: 'none', padding: '8px 12px', height: 72 }

/**
 * CellEditor renders the appropriate editor for each Phase 1 column type:
 * text, date, number, checkbox, dropdown
 *
 * Text/number: saves on Enter, Tab, or blur (click outside). Typing is uninterrupted.
 * Checkbox/date/dropdown: saves immediately on change.
 */
export function CellEditor({ column, value, onSave, onCancel }: Props): React.ReactElement {
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(null)
  const [localValue, setLocalValue] = useState(value ?? '')
  const savedRef = useRef(false)

  const guardedSave = (val: string | null, navDirection?: NavDirection) => {
    if (savedRef.current) return
    // Reject non-finite numbers (NaN, Infinity, -Infinity) for numeric columns
    if (val && (column.column_type === 'number' || column.column_type === 'currency')) {
      if (!isFinite(Number(val))) return
    }
    // A half-typed year (0026) isn't a date; keep what was there instead
    if (val && column.column_type === 'date' && toYmd(val) !== val) {
      savedRef.current = true
      onCancel()
      return
    }
    savedRef.current = true
    onSave(val, navDirection)
  }

  // Focus once, when the editor opens, for the column it opened on
  const openedTypeRef = useRef(column.column_type)
  useEffect(() => {
    const el = inputRef.current
    const openedType = openedTypeRef.current
    if (el) {
      el.focus()
      if (openedType === 'dropdown' || openedType === 'status') {
        try {
          if (el instanceof HTMLSelectElement || el instanceof HTMLInputElement) el.showPicker()
        } catch { /* showPicker may throw if no user gesture */ }
      } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        el.select()
      }
    }
  }, [])

  // Screen readers hear the column's name and how to finish, not just "edit text" (AUDIT-043)
  const hintId = useId()
  const kind = column.column_type
  const hint = kind === 'checkbox' ? 'Space ticks or unticks. Escape goes back.'
    : kind === 'dropdown' || kind === 'status' ? 'Pick one to save. Escape cancels.'
    : kind === 'notes' || kind === 'address' ? 'Tab saves. Escape cancels. Enter starts a new line.'
    : 'Enter saves. Escape cancels.'
  const a11y = { 'aria-label': column.name, 'aria-describedby': hintId }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onCancel()
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.stopPropagation()
      guardedSave(localValue === '' ? null : localValue, 'next-row')
    } else if (e.key === 'Tab') {
      e.preventDefault()
      e.stopPropagation()
      guardedSave(localValue === '' ? null : localValue, e.shiftKey ? 'prev-col' : 'next-col')
    }
  }

  return (
    <>
      {renderEditor()}
      <span id={hintId} className="sr-only">{hint}</span>
    </>
  )

  function renderEditor(): React.ReactElement {
    switch (column.column_type) {
      case 'checkbox': {
        const checked = localValue === 'true' || localValue === '1'
        return (
          <div className={EDITOR_CLASS} style={CHECKBOX_STYLE}>
            <input
              {...a11y}
              type="checkbox"
              checked={checked}
              className="w-5 h-5 cursor-pointer accent-blue-600"
              onChange={e => {
                const newVal = e.target.checked ? 'true' : 'false'
                setLocalValue(newVal)
                guardedSave(newVal)
              }}
            />
          </div>
        )
      }

      case 'date': {
        // Store as YYYY-MM-DD. Do NOT call onSave on onChange — the native date
        // input edits segments (MM, DD, YYYY) one at a time, so saving mid-edit
        // triggers a re-render that resets the picker and corrupts input.
        // Save only on blur or keyboard commit (Enter/Tab/Escape handled above).
        const dateValue = localValue || ''
        return (
          <input
            {...a11y}
            ref={inputRef as React.RefObject<HTMLInputElement>}
            type="date"
            className={EDITOR_CLASS}
            style={DATE_STYLE}
            min={`${MIN_YEAR}-01-01`}
            max={`${MAX_YEAR}-12-31`}
            value={dateValue}
            onChange={e => setLocalValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => guardedSave(localValue || null)}
          />
        )
      }

      case 'number': {
        return (
          <input
            {...a11y}
            ref={inputRef as React.RefObject<HTMLInputElement>}
            type="number"
            className={EDITOR_CLASS}
            style={BASE_STYLE}
            value={localValue}
            onChange={e => setLocalValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => guardedSave(localValue === '' ? null : localValue)}
          />
        )
      }

      case 'dropdown': {
        let options: string[] = []
        try {
          const config = JSON.parse(column.config || '{}')
          options = config.options ?? []
        } catch {
          options = []
        }
        return (
          <select
            {...a11y}
            ref={inputRef as React.RefObject<HTMLSelectElement>}
            className={EDITOR_CLASS}
            style={SELECT_STYLE}
            value={localValue}
            onChange={e => {
              setLocalValue(e.target.value)
              guardedSave(e.target.value || null)
            }}
            onKeyDown={e => {
              if (e.key === 'Escape') { e.stopPropagation(); onCancel() }
            }}
            onBlur={() => guardedSave(localValue || null)}
          >
            <option value="">— Select —</option>
            {options.map((opt: string) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        )
      }

      case 'phone':
      case 'email':
      case 'url':
        return (
          <input
            {...a11y}
            ref={inputRef as React.RefObject<HTMLInputElement>}
            type={column.column_type === 'email' ? 'email' : column.column_type === 'url' ? 'url' : 'tel'}
            className={EDITOR_CLASS}
            style={BASE_STYLE}
            value={localValue}
            onChange={e => setLocalValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => guardedSave(localValue === '' ? null : localValue)}
          />
        )

      case 'currency':
        return (
          <input
            {...a11y}
            ref={inputRef as React.RefObject<HTMLInputElement>}
            type="number"
            step="0.01"
            min="0"
            className={EDITOR_CLASS}
            style={BASE_STYLE}
            value={localValue}
            onChange={e => setLocalValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => guardedSave(localValue === '' ? null : localValue)}
          />
        )

      case 'notes':
      case 'address':
        return (
          <textarea
            {...a11y}
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            className={EDITOR_CLASS}
            style={column.column_type === 'address' ? TEXTAREA_ADDRESS_STYLE : TEXTAREA_NOTES_STYLE}
            value={localValue}
            onChange={e => setLocalValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') { e.stopPropagation(); onCancel() }
              else if (e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); guardedSave(localValue === '' ? null : localValue, e.shiftKey ? 'prev-col' : 'next-col') }
              // Allow Enter for newlines in textarea
            }}
            onBlur={() => guardedSave(localValue === '' ? null : localValue)}
          />
        )

      case 'status': {
        let options: Array<{ label: string; color: string }> = []
        try {
          const config = JSON.parse(column.config || '{}')
          options = config.options ?? []
        } catch {
          options = []
        }
        return (
          <select
            {...a11y}
            ref={inputRef as React.RefObject<HTMLSelectElement>}
            className={EDITOR_CLASS}
            style={SELECT_STYLE}
            value={localValue}
            onChange={e => {
              setLocalValue(e.target.value)
              guardedSave(e.target.value || null)
            }}
            onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onCancel() } }}
            onBlur={() => guardedSave(localValue || null)}
          >
            <option value="">— Select —</option>
            {options.map((opt) => (
              <option key={opt.label} value={opt.label}>{opt.label}</option>
            ))}
          </select>
        )
      }

      case 'tag': {
        // Tag editing: comma-separated text; stored as JSON array
        let defaultTagDisplay = localValue
        try {
          const parsed = JSON.parse(localValue)
          if (Array.isArray(parsed)) defaultTagDisplay = parsed.join(', ')
        } catch { /* use raw */ }
        return (
          <input
            {...a11y}
            ref={inputRef as React.RefObject<HTMLInputElement>}
            type="text"
            className={EDITOR_CLASS}
            style={BASE_STYLE}
            defaultValue={defaultTagDisplay}
            placeholder="tag1, tag2, tag3"
            onKeyDown={e => {
              if (e.key === 'Escape') { e.stopPropagation(); onCancel() }
              else if (e.key === 'Enter') {
                e.preventDefault(); e.stopPropagation()
                const v = (inputRef.current as HTMLInputElement).value
                const tags = v.split(',').map(t => t.trim()).filter(Boolean)
                guardedSave(tags.length > 0 ? JSON.stringify(tags) : null, 'next-row')
              } else if (e.key === 'Tab') {
                e.preventDefault(); e.stopPropagation()
                const v = (inputRef.current as HTMLInputElement).value
                const tags = v.split(',').map(t => t.trim()).filter(Boolean)
                guardedSave(tags.length > 0 ? JSON.stringify(tags) : null, e.shiftKey ? 'prev-col' : 'next-col')
              }
            }}
            onBlur={e => {
              const tags = e.target.value.split(',').map(t => t.trim()).filter(Boolean)
              guardedSave(tags.length > 0 ? JSON.stringify(tags) : null)
            }}
          />
        )
      }

      // text (default)
      default:
        return (
          <input
            {...a11y}
            ref={inputRef as React.RefObject<HTMLInputElement>}
            type="text"
            className={EDITOR_CLASS}
            style={BASE_STYLE}
            value={localValue}
            onChange={e => setLocalValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => guardedSave(localValue === '' ? null : localValue)}
          />
        )
    }
  }
}
