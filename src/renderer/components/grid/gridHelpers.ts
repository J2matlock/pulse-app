import type { Column } from '../../../shared/types'

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
  const trimmed = value.trim()
  if (!trimmed) return trimmed // allow clearing
  switch (column.column_type) {
    case 'date': {
      // Accept YYYY-MM-DD or common date formats
      const d = new Date(trimmed)
      if (isNaN(d.getTime())) return null
      return trimmed
    }
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
    case 'dropdown': {
      try {
        const cfg = JSON.parse(column.config || '{}')
        const options: string[] = cfg.options || []
        const match = options.find(o => o.toLowerCase() === trimmed.toLowerCase())
        return match ?? null
      } catch { return null }
    }
    default: return trimmed // text, phone, email, url, tag — accept anything
  }
}
