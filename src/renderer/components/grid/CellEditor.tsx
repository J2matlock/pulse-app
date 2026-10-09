import React, { useRef, useEffect, useState } from 'react'
import type { Column } from '../../../shared/types'
import type { NavDirection } from '../../hooks/useGridCellNavigation'

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
  outline: '2px solid #2563EB',
  outlineOffset: '-2px',
  background: 'white',
  color: '#1e293b',
  padding: '0 12px',
  fontSize: '15px',
  fontFamily: 'inherit',
  boxSizing: 'border-box'
}

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
    savedRef.current = true
    onSave(val, navDirection)
  }

  useEffect(() => {
    const el = inputRef.current
    if (el) {
      el.focus()
      if (column.column_type === 'dropdown' || column.column_type === 'status') {
        try {
          if (el instanceof HTMLSelectElement || el instanceof HTMLInputElement) el.showPicker()
        } catch { /* showPicker may throw if no user gesture */ }
      } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        el.select()
      }
    }
  }, [])

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

  switch (column.column_type) {
    case 'checkbox': {
      const checked = localValue === 'true' || localValue === '1'
      return (
        <div style={CHECKBOX_STYLE}>
          <input
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
          ref={inputRef as React.RefObject<HTMLInputElement>}
          type="date"
          style={BASE_STYLE}
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
          ref={inputRef as React.RefObject<HTMLInputElement>}
          type="number"
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
          ref={inputRef as React.RefObject<HTMLSelectElement>}
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
          ref={inputRef as React.RefObject<HTMLInputElement>}
          type={column.column_type === 'email' ? 'email' : column.column_type === 'url' ? 'url' : 'tel'}
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
          ref={inputRef as React.RefObject<HTMLInputElement>}
          type="number"
          step="0.01"
          min="0"
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
          ref={inputRef as React.RefObject<HTMLTextAreaElement>}
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
          ref={inputRef as React.RefObject<HTMLSelectElement>}
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
          ref={inputRef as React.RefObject<HTMLInputElement>}
          type="text"
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
          ref={inputRef as React.RefObject<HTMLInputElement>}
          type="text"
          style={BASE_STYLE}
          value={localValue}
          onChange={e => setLocalValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => guardedSave(localValue === '' ? null : localValue)}
        />
      )
  }
}
