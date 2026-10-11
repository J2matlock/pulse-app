/**
 * export-csv.ts — CSV export functionality.
 */

import Papa from 'papaparse'

import type { CsvExportOptions } from './export-shared'
import { atomicWriteFileAsync, formatCellValue, loadGridData, pickColumns, pickRows, sanitizeCsvFormula, savedDateFormat, showDeadlinesAsText, stripHtml } from './export-shared'
import { getDb } from './database'
import { localDateString, parseDbTimestamp } from '../shared/dates'
import { logger } from './logger'

export async function exportCsv(options: CsvExportOptions): Promise<void> {
  const { gridId, columnIds, activeRowIds, destPath } = options
  const dateFormat = options.dateFormat ?? savedDateFormat()
  const { columns, rows } = loadGridData(gridId, { includeHidden: true })
  logger.info('export', 'CSV export started', { rowCount: rows.length })

  const selectedColumns = pickColumns(columns, columnIds, options.includeHidden)
  const filteredRows = pickRows(rows, activeRowIds)
  showDeadlinesAsText(gridId, selectedColumns, filteredRows)

  const headers = selectedColumns.map(c => sanitizeCsvFormula(c.name))
  const data = filteredRows.map(row =>
    selectedColumns.map(col => formatCellValue(row[`col_${col.id}`] as string | null, col.column_type, dateFormat))
  )

  const csv = Papa.unparse({ fields: headers, data })
  try {
    // A byte-order mark, so Excel reads accented names as UTF-8 (X-21)
    await atomicWriteFileAsync(destPath, '\uFEFF' + csv, 'utf-8')
  } catch (err) {
    logger.error('export', 'CSV export failed', { error: err instanceof Error ? err.message : String(err) })
    throw err
  }
}

/**
 * Every note of every list in one file (X-21), for Export All: when it was
 * written, the list, the record, the kind of note, the text and any follow-up.
 */
export async function exportNotesCsv(destPath: string, dateFormat: 'iso' | 'us' | 'eu' = savedDateFormat()): Promise<number> {
  const notes = getDb().prepare(`
    SELECT cl.created_at, g.name AS list, r.display_name AS record, COALESCE(at.label, cl.log_type) AS kind, cl.content, cl.follow_up_date
    FROM case_log cl
    JOIN rows r ON r.id = cl.row_id AND r.deleted_at IS NULL
    JOIN grids g ON g.id = r.grid_id AND g.is_active = 1
    LEFT JOIN activity_types at ON at.key = cl.log_type
    WHERE cl.voided_at IS NULL
    ORDER BY g.position, g.id, r.display_name, cl.created_at
  `).all() as Array<{ created_at: string; list: string; record: string | null; kind: string | null; content: string; follow_up_date: string | null }>
  const data = notes.map(n => {
    const at = parseDbTimestamp(n.created_at)
    return [
      formatCellValue(localDateString(at), 'date', dateFormat), sanitizeCsvFormula(n.list), sanitizeCsvFormula(n.record ?? ''),
      sanitizeCsvFormula(n.kind ?? ''), sanitizeCsvFormula(stripHtml(n.content)), formatCellValue(n.follow_up_date, 'date', dateFormat),
    ]
  })
  const csv = Papa.unparse({ fields: ['Date', 'List', 'Record', 'Kind', 'Note', 'Follow-up'], data })
  await atomicWriteFileAsync(destPath, '\uFEFF' + csv, 'utf-8')
  return notes.length
}
