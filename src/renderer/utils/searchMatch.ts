/**
 * What the search box looks in (audit G-25), shared by the table, the board
 * and Find & Replace so they agree: every column that holds text. Phone
 * numbers match on their digits, so "555-0113" finds "(555) 555-0113".
 */
import type { Column, GridRow } from '../../shared/types'
import { linkValueText } from '../../shared/links'
import { cellText } from '../../shared/cellText'

export const SEARCHABLE_TYPES = new Set<string>([
  'text', 'number', 'dropdown', 'phone', 'email', 'url', 'notes', 'status', 'address', 'currency', 'tag', 'auto_number', 'link',
])

export function rowMatchesSearch(row: GridRow, columns: Column[], query: string, rowTagsMap?: Map<number, string[]>): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const qDigits = q.replace(/\D/g, '')
  for (const col of columns) {
    if (!col.is_name_column && !SEARCHABLE_TYPES.has(col.column_type)) continue
    const raw = row[`col_${col.id}` as keyof GridRow] as string | null | undefined
    if (raw == null || raw === '') continue
    if (col.column_type === 'phone' && qDigits.length >= 3 && raw.replace(/\D/g, '').includes(qDigits)) return true
    const text = col.column_type === 'link' ? linkValueText(raw) : cellText(col.column_type, raw)
    if (text.toLowerCase().includes(q)) return true
  }
  return (rowTagsMap?.get(row.row_id) ?? []).some(t => t.toLowerCase().includes(q))
}
