import type { Column } from '../../../shared/types'
import { isNotTypedColumnType } from '../../../shared/types'
import { parseDate } from '../../../shared/parseDate'
import { columnOptionLabels } from '../../../shared/stages'

// ── Clipboard format helper ────────────────────────────────────────────────────

export function formatCellForClipboard(column: Column, value: string | null): string {
  if (value == null) return ''
  switch (column.column_type) {
    case 'checkbox': return (value === 'true' || value === '1') ? 'Yes' : 'No'
    case 'currency': {
      const n = parseFloat(value)
      return isNaN(n) ? value : `$${n.toFixed(2)}`
    }
    case 'tag': {
      try {
        const arr = JSON.parse(value)
        if (Array.isArray(arr)) return arr.join(', ')
      } catch { /* fall through */ }
      return value
    }
    default: return value
  }
}

// ── Paste validation helper ───────────────────────────────────────────────────

export function validateForColumnType(value: string, column: Column): string | null {
  // Deadlines, numbers and worked-out columns change through their own actions, never by paste (G-15)
  if (isNotTypedColumnType(column.column_type)) return null
  const trimmed = value.trim()
  if (!trimmed) return trimmed // allow clearing
  switch (column.column_type) {
    case 'date':
      // Stored as YYYY-MM-DD, read the way Import reads dates; "March 3" (no year) is refused (G-14)
      return parseDate(trimmed)
    case 'number':
    case 'currency': {
      // Strip currency symbols for currency type
      const cleaned = trimmed.replace(/[$,]/g, '')
      return isNaN(Number(cleaned)) ? null : cleaned
    }
    case 'checkbox': {
      const lower = trimmed.toLowerCase()
      if (['true', 'yes', '1'].includes(lower)) return 'true'
      if (['false', 'no', '0'].includes(lower)) return 'false'
      return null
    }
    case 'dropdown':
    case 'status': {
      // Status choices are { label, color }; only an existing choice can be pasted (G-14)
      const match = columnOptionLabels(column).find(o => o.toLowerCase() === trimmed.toLowerCase())
      return match ?? null
    }
    default: return trimmed // text, phone, email, url, tag — accept anything
  }
}

/**
 * What a paste into one cell would store, or why it can't (G-14, G-15, G-29).
 * A block copied from a spreadsheet (tabs, or several lines in a one-line
 * column) is refused instead of being stuffed into one cell.
 */
export function checkPaste(text: string, column: Column): { value: string } | { error: string } {
  if (isNotTypedColumnType(column.column_type)) return { error: `"${column.name}" is filled in by Pulse, so it can't be pasted into.` }
  const multiLineOk = column.column_type === 'notes' || column.column_type === 'address'
  const body = text.replace(/\r?\n$/, '')
  if (body.includes('\t') || (!multiLineOk && /\r?\n/.test(body))) {
    return { error: 'That looks like several cells from a spreadsheet. To bring in many records, use Import.' }
  }
  const value = validateForColumnType(body, column)
  if (value === null) {
    if (column.column_type === 'date') return { error: `"${body.trim()}" isn't a full date. Try a form like 10/6/2026.` }
    if (column.column_type === 'dropdown' || column.column_type === 'status') return { error: `"${body.trim()}" isn't one of the choices in "${column.name}".` }
    return { error: `"${body.trim()}" doesn't fit the "${column.name}" column.` }
  }
  return { value }
}
