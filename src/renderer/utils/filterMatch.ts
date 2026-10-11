/**
 * filterMatch.ts — Column filter matching logic.
 * Extracted from DataGrid for testability and reuse.
 */

import type { GridRow, Column, ColumnFilter } from '../../shared/types'
import { ROW_TAG_COLUMN_ID } from '../../shared/types'
import { linkValueText, parseLinkValue } from '../../shared/links'
import { localDateString } from '../../shared/dates'

/** A date filter value meaning "the day it's checked", so a saved "in the past" never freezes (G-40) */
export const TODAY_TOKEN = '@today'

export function matchFilter(
  row: GridRow,
  filter: ColumnFilter,
  columns: Column[],
  rowTagsMap?: Map<number, string[]>
): boolean {
  // Special case: row-level tag filter (columnId === -1)
  if (filter.columnId === ROW_TAG_COLUMN_ID) {
    const tagNames = rowTagsMap?.get(row.row_id) ?? []
    const tagStr = tagNames.join(',').toLowerCase()
    const v = filter.value.toLowerCase()
    switch (filter.operator) {
      case 'is_empty':     return tagNames.length === 0
      case 'is_not_empty': return tagNames.length > 0
      case 'contains':     return tagStr.includes(v)
      case 'not_contains': return !tagStr.includes(v)
      default:             return true
    }
  }

  const col = columns.find(c => c.id === filter.columnId)
  const stored = row[`col_${filter.columnId}` as keyof GridRow] as string | null
  // Link columns (W04) match on the linked names, or on one linked record
  if (col?.column_type === 'link' && filter.operator === 'links_to') {
    return parseLinkValue(stored).some(c => String(c.rowId) === filter.value)
  }
  const originalVal = col?.column_type === 'link' ? (linkValueText(stored) || null) : stored
  const rawVal = originalVal ?? ''
  // Normalize checkbox: 'true' or '1' → 'true', everything else → 'false'
  const cellVal = col?.column_type === 'checkbox'
    ? ((rawVal === 'true' || rawVal === '1') ? 'true' : 'false')
    : rawVal
  const v = filter.value === TODAY_TOKEN ? localDateString() : filter.value
  switch (filter.operator) {
    case 'is_empty':      return originalVal == null || originalVal === ''
    case 'is_not_empty':  return originalVal != null && originalVal !== ''
    case 'equals':        return cellVal.toLowerCase() === v.toLowerCase()
    case 'not_equals':    return cellVal.toLowerCase() !== v.toLowerCase()
    case 'contains':      return cellVal.toLowerCase().includes(v.toLowerCase())
    case 'not_contains':  return !cellVal.toLowerCase().includes(v.toLowerCase())
    case 'starts_with':   return cellVal.toLowerCase().startsWith(v.toLowerCase())
    case 'ends_with':     return cellVal.toLowerCase().endsWith(v.toLowerCase())
    case 'gt': {
      const n = parseFloat(cellVal), m = parseFloat(v)
      return !isNaN(n) && !isNaN(m) && n > m
    }
    case 'lt': {
      const n = parseFloat(cellVal), m = parseFloat(v)
      return !isNaN(n) && !isNaN(m) && n < m
    }
    case 'before': {
      if (cellVal === '' || v === '') return false
      const cellDate = new Date(cellVal).getTime()
      const filterDate = new Date(v).getTime()
      return !isNaN(cellDate) && !isNaN(filterDate) && cellDate < filterDate
    }
    case 'after': {
      if (cellVal === '' || v === '') return false
      const cellDate = new Date(cellVal).getTime()
      const filterDate = new Date(v).getTime()
      return !isNaN(cellDate) && !isNaN(filterDate) && cellDate > filterDate
    }
    default:       return true
  }
}
