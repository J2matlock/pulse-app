import type { Column, GridRow } from '../../shared/types'
import { wordNow } from './vocab'
import { useGridStore } from '../stores/gridStore'
import { renderDisplayFormat } from '../../shared/displayFormat'

const LAST_NAME_PATTERNS = /^(last|last\s*name|lastname|surname|family\s*name|lname)$/i

/** The name from the list's display format ("{Year} {Make} {Model}"), or '' when it has none. */
function formattedName(row: GridRow, columns: Column[]): string {
  const gridId = columns[0]?.grid_id
  if (!gridId) return ''
  const format = useGridStore.getState().grids.find(g => g.id === gridId)?.display_format
  if (!format) return ''
  const values: Record<string, string> = {}
  for (const c of columns) {
    const key = c.name.trim().toLowerCase()
    // Two columns with the same name: the first one wins, as in main
    if (key in values) continue
    const value = row[`col_${c.id}` as keyof GridRow]
    values[key] = typeof value === 'string' ? value : ''
  }
  return renderDisplayFormat(format, values)
}

/**
 * Resolve the full client name from a row, using the list's display format
 * when it has one, combining the name column with
 * a detected "last name" column when present.
 *
 * Detection logic:
 * 1. Find the column with is_name_column = 1 (the "first/full name" column)
 * 2. Look for another column whose name matches common last-name patterns
 * 3. If both have values, concatenate: "First Last"
 * 4. If only one has a value, return that
 */
export function getClientName(
  row: GridRow,
  columns: Column[],
  fallback = `Unnamed ${wordNow('record')}`
): string {
  const formatted = formattedName(row, columns)
  if (formatted) return formatted

  const nameCol = columns.find(c => c.is_name_column === 1)
  if (!nameCol) return fallback

  const firstName = (row[`col_${nameCol.id}` as keyof GridRow] as string | null)?.trim() || ''

  const lastNameCol = columns.find(c =>
    c.id !== nameCol.id && LAST_NAME_PATTERNS.test(c.name.trim())
  )
  const lastName = lastNameCol
    ? ((row[`col_${lastNameCol.id}` as keyof GridRow] as string | null)?.trim() || '')
    : ''

  if (firstName && lastName) return `${firstName} ${lastName}`
  if (firstName) return firstName
  if (lastName) return lastName
  return fallback
}

/**
 * Find the name column ID and optional last-name column ID for a set of columns.
 * Useful for building queries or passing context.
 */
export function findNameColumnIds(columns: Column[]): { nameColId: number | null; lastNameColId: number | null } {
  const nameCol = columns.find(c => c.is_name_column === 1)
  if (!nameCol) return { nameColId: null, lastNameColId: null }
  const lastNameCol = columns.find(c =>
    c.id !== nameCol.id && LAST_NAME_PATTERNS.test(c.name.trim())
  )
  return { nameColId: nameCol.id, lastNameColId: lastNameCol?.id ?? null }
}
