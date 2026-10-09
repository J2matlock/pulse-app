/**
 * export-csv.ts — CSV export functionality.
 */

import Papa from 'papaparse'

import type { CsvExportOptions } from './export-shared'
import { atomicWriteFileAsync, formatCellValue, loadGridData, sanitizeCsvFormula } from './export-shared'
import { logger } from './logger'

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

  const csv = Papa.unparse({ fields: headers, data })
  try {
    await atomicWriteFileAsync(destPath, csv, 'utf-8')
  } catch (err) {
    logger.error('export', 'CSV export failed', { error: err instanceof Error ? err.message : String(err) })
    throw err
  }
}
