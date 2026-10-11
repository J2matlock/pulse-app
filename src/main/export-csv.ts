/**
 * export-csv.ts — CSV export functionality.
 */

import Papa from 'papaparse'

import type { CsvExportOptions } from './export-shared'
import { atomicWriteFileAsync, formatCellValue, loadGridData, sanitizeCsvFormula } from './export-shared'
import { logger } from './logger'
import { getDb } from './database'

/** "Guardian cell: 555-0199; Work email: a@b.org" for each record that has any */
function manualContactsByRow(rowIds: number[]): Map<number, string> {
  const out = new Map<number, string>()
  if (rowIds.length === 0) return out
  const stmt = getDb().prepare('SELECT manual_contacts FROM rows WHERE id = ?')
  for (const id of rowIds) {
    const raw = (stmt.get(id) as { manual_contacts: string | null } | undefined)?.manual_contacts
    if (!raw) continue
    try {
      const list = JSON.parse(raw) as Array<{ type?: string; label?: string; value?: string }>
      const text = Array.isArray(list) ? list.filter(c => c?.value?.trim()).map(c => `${c.label || c.type || 'Contact'}: ${c.value}`).join('; ') : ''
      if (text) out.set(id, text)
    } catch { /* damaged list: leave it out */ }
  }
  return out
}

export async function exportCsv(options: CsvExportOptions): Promise<void> {
  const { gridId, columnIds, activeRowIds, destPath, dateFormat } = options
  const { columns, rows } = loadGridData(gridId)
  logger.info('export', 'CSV export started', { rowCount: rows.length })

  const selectedColumns = columnIds.length > 0
    ? columns.filter(c => columnIds.includes(c.id))
    : columns

  const filteredRows = activeRowIds.length > 0
    ? rows.filter(r => activeRowIds.includes(r.row_id))
    : rows

  const headers = selectedColumns.map(c => sanitizeCsvFormula(c.name))
  const data = filteredRows.map(row =>
    selectedColumns.map(col => formatCellValue(row[`col_${col.id}`] as string | null, col.column_type, dateFormat))
  )

  // Contact info added on the record page ("Add contact info") isn't a column; add it
  // as one at the end when any exported record has some (R-27)
  const extra = manualContactsByRow(filteredRows.map(r => r.row_id as number))
  if (extra.size > 0) {
    headers.push('Other contact info')
    filteredRows.forEach((row, i) => { data[i]!.push(sanitizeCsvFormula(extra.get(row.row_id as number) ?? '')) })
  }

  const csv = Papa.unparse({ fields: headers, data })
  try {
    await atomicWriteFileAsync(destPath, csv, 'utf-8')
  } catch (err) {
    logger.error('export', 'CSV export failed', { error: err instanceof Error ? err.message : String(err) })
    throw err
  }
}
