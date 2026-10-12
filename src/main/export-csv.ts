/**
 * export-csv.ts — CSV export functionality.
 */

import Papa from 'papaparse'

import type { CsvExportOptions } from './export-shared'
import { atomicWriteFileAsync, formatCellValue, loadGridData, pickColumns, pickRows, sanitizeCsvFormula, savedDateFormat, showDeadlinesAsText, stripHtml } from './export-shared'
import { localDateString, parseDbTimestamp } from '../shared/dates'
import { LAST_DONE_SUFFIX } from '../shared/constants'
import type { Column } from '../shared/types'
import { logger } from './logger'
import { getDb } from './database'
import { word } from './vocab'
import { LIVE_GRID, NOT_TRASHED_ROW } from '../shared/liveRecords'

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
  const { gridId, columnIds, activeRowIds, destPath } = options
  const dateFormat = options.dateFormat ?? savedDateFormat()
  const { columns, rows } = loadGridData(gridId, { includeHidden: true, includeArchived: options.includeArchived })
  logger.info('export', 'CSV export started', { rowCount: rows.length })

  const selectedColumns = pickColumns(columns, columnIds, options.includeHidden)
  const filteredRows = pickRows(rows, activeRowIds)
  // The date last done, before the deadline columns become their "Due …" text (P-002)
  const lastDone = new Map<string, string | null>()
  if (options.storedDeadlineDates) {
    for (const row of filteredRows) for (const c of selectedColumns) {
      if (c.column_type === 'deadline') lastDone.set(`${row.row_id}:${c.id}`, (row[`col_${c.id}`] as string | null) ?? null)
    }
  }
  showDeadlinesAsText(gridId, selectedColumns, filteredRows)

  const withLastDone = (c: Column) => options.storedDeadlineDates === true && c.column_type === 'deadline'
  const headers = selectedColumns.flatMap(c => withLastDone(c)
    ? [sanitizeCsvFormula(c.name), sanitizeCsvFormula(`${c.name}${LAST_DONE_SUFFIX}`)]
    : [sanitizeCsvFormula(c.name)])
  const data = filteredRows.map(row =>
    selectedColumns.flatMap(col => {
      const shown = formatCellValue(row[`col_${col.id}`] as string | null, col.column_type, dateFormat)
      return withLastDone(col) ? [shown, formatCellValue(lastDone.get(`${row.row_id}:${col.id}`) ?? null, 'date', dateFormat)] : [shown]
    })
  )

  // Contact info added on the record page ("Add contact info") isn't a column; add it
  // as one at the end when any exported record has some (R-27)
  const extra = manualContactsByRow(filteredRows.map(r => r.row_id as number))
  if (extra.size > 0) {
    headers.push('Other contact info')
    filteredRows.forEach((row, i) => { data[i]!.push(sanitizeCsvFormula(extra.get(row.row_id as number) ?? '')) })
  }

  // With archived records in, a last column says which ones they are
  if (filteredRows.some(r => r.is_active === 0)) {
    headers.push('Archived')
    filteredRows.forEach((row, i) => { data[i]!.push(row.is_active === 0 ? 'Yes' : '') })
  }

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
 * Every note of every list in one file (X-21), for Export All: when it
 * happened, the list, the record, the kind of note, the text and any follow-up.
 */
export async function exportNotesCsv(destPath: string, dateFormat: 'iso' | 'us' | 'eu' = savedDateFormat()): Promise<number> {
  const notes = getDb().prepare(`
    SELECT COALESCE(cl.occurred_at, cl.created_at) AS occurred_at, g.name AS list, r.display_name AS record, COALESCE(at.label, cl.log_type) AS kind, cl.content, cl.follow_up_date
    FROM case_log cl
    JOIN rows r ON r.id = cl.row_id AND ${NOT_TRASHED_ROW}
    JOIN grids g ON g.id = r.grid_id AND ${LIVE_GRID}
    LEFT JOIN activity_types at ON at.key = cl.log_type
    WHERE cl.voided_at IS NULL
    ORDER BY g.position, g.id, r.display_name, COALESCE(cl.occurred_at, cl.created_at)
  `).all() as Array<{ occurred_at: string; list: string; record: string | null; kind: string | null; content: string; follow_up_date: string | null }>
  const data = notes.map(n => {
    // The day it happened (a note can be backdated), as the PDFs and summary report show it
    const at = parseDbTimestamp(n.occurred_at)
    return [
      formatCellValue(localDateString(at), 'date', dateFormat), sanitizeCsvFormula(n.list), sanitizeCsvFormula(n.record ?? ''),
      sanitizeCsvFormula(n.kind ?? ''), sanitizeCsvFormula(stripHtml(n.content)), formatCellValue(n.follow_up_date, 'date', dateFormat),
    ]
  })
  const fields = ['Date', word('list', { cap: true }), word('record', { cap: true }), 'Kind', word('activity', { cap: true }), 'Follow-up']
  const csv = Papa.unparse({ fields: fields.map(sanitizeCsvFormula), data })
  await atomicWriteFileAsync(destPath, '\uFEFF' + csv, 'utf-8')
  return notes.length
}
