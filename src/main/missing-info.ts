/**
 * Missing information report (brainstorm B2): clients with an empty value in
 * any column marked required (column config `required: true`), and clients
 * whose date in a column with a deadline rule isn't a date Pulse can read
 * ("TBD", "2/30/2026"), so that deadline can't be worked out (AUDIT-026).
 */
import { getDb } from './database'
import type { MissingInfoGrid } from '../shared/types'
import { isNotADate } from '../shared/ymd'
import Papa from 'papaparse'
import { atomicWriteFileAsync, sanitizeCsvFormula } from './export-shared'
import { word } from './vocab'
import { LIVE_GRID, LIVE_ROW, liveGrid } from '../shared/liveRecords'

export function getMissingInfo(gridId?: number): MissingInfoGrid[] {
  const db = getDb()
  const rows = db.prepare(`
    SELECT g.id AS grid_id, g.name AS grid_name, r.id AS row_id,
           COALESCE(NULLIF(r.display_name, ''), ?) AS client_name,
           col.name AS column_name, col.position
    FROM columns col
    JOIN grids g ON g.id = col.grid_id AND ${LIVE_GRID}
    JOIN rows r ON r.grid_id = g.id AND ${LIVE_ROW}
    LEFT JOIN cells c ON c.row_id = r.id AND c.column_id = col.id
    WHERE json_extract(col.config, '$.required') = 1
      AND col.column_type NOT IN ('checkbox', 'age_from_dob', 'calculated_days', 'auto_number', 'deadline', 'link', 'file_count')
      AND (c.value IS NULL OR trim(c.value) = '')
      AND (? IS NULL OR g.id = ?)
    ORDER BY g.position, g.name COLLATE NOCASE, client_name COLLATE NOCASE, col.position
  `).all(`Unnamed ${word('record')}`, gridId ?? null, gridId ?? null) as Array<{ grid_id: number; grid_name: string; row_id: number; client_name: string; column_name: string }>

  const required = db.prepare(`
    SELECT col.grid_id, g.name AS grid_name, col.name FROM columns col
    JOIN grids g ON g.id = col.grid_id AND ${LIVE_GRID}
    WHERE json_extract(col.config, '$.required') = 1 AND col.column_type NOT IN ('checkbox', 'age_from_dob', 'calculated_days', 'auto_number', 'deadline', 'link', 'file_count')
      AND (? IS NULL OR col.grid_id = ?)
    ORDER BY g.position, g.name COLLATE NOCASE, col.position
  `).all(gridId ?? null, gridId ?? null) as Array<{ grid_id: number; grid_name: string; name: string }>

  // A filled-in value the deadline engine can't read as a date: its deadline is shown nowhere
  const unreadable = (db.prepare(`
    SELECT g.id AS grid_id, r.id AS row_id,
           COALESCE(NULLIF(r.display_name, ''), ?) AS client_name,
           col.name AS column_name, c.value
    FROM cells c
    JOIN rows r ON r.id = c.row_id AND ${LIVE_ROW}
    JOIN grids g ON g.id = r.grid_id AND ${LIVE_GRID}
    JOIN columns col ON col.id = c.column_id AND col.column_type IN ('date', 'deadline')
    JOIN alert_rules ar ON ar.id = CAST(json_extract(col.config, '$.alert_rule_id') AS INTEGER)
    WHERE c.value IS NOT NULL AND trim(c.value) != ''
      AND (? IS NULL OR g.id = ?)
    ORDER BY client_name COLLATE NOCASE, col.position
  `).all(`Unnamed ${word('record')}`, gridId ?? null, gridId ?? null) as Array<{ grid_id: number; row_id: number; client_name: string; column_name: string; value: string }>)
    .filter(r => isNotADate(r.value))

  // Map keeps caseload order; every caseload with required columns, or with a date
  // Pulse can't read, is listed
  const listed = new Set([...required.map(r => r.grid_id), ...unreadable.map(r => r.grid_id)])
  const allGrids = db.prepare(`SELECT id, name FROM grids WHERE ${liveGrid('')} ORDER BY position, name COLLATE NOCASE`).all() as Array<{ id: number; name: string }>
  const grids = new Map<number, MissingInfoGrid>()
  for (const g of allGrids) {
    if (listed.has(g.id)) grids.set(g.id, { gridId: g.id, gridName: g.name, requiredColumns: [], clients: [] })
  }
  for (const r of required) grids.get(r.grid_id)?.requiredColumns.push(r.name)
  for (const r of rows) {
    const g = grids.get(r.grid_id)
    if (!g) continue
    const last = g.clients[g.clients.length - 1]
    if (last?.rowId === r.row_id) last.missing.push(r.column_name)
    else g.clients.push({ rowId: r.row_id, clientName: r.client_name, missing: [r.column_name] })
  }
  const reorder = new Set<MissingInfoGrid>()
  for (const r of unreadable) {
    const g = grids.get(r.grid_id)
    if (!g) continue
    const client = g.clients.find(c => c.rowId === r.row_id)
    if (client) (client.notADate ??= []).push(r.column_name)
    else { g.clients.push({ rowId: r.row_id, clientName: r.client_name, missing: [], notADate: [r.column_name] }); reorder.add(g) }
  }
  // Clients added for an unreadable date go in name order with the rest
  for (const g of reorder) g.clients.sort((a, b) => a.clientName.toLowerCase() < b.clientName.toLowerCase() ? -1 : a.clientName.toLowerCase() > b.clientName.toLowerCase() ? 1 : 0)
  return [...grids.values()]
}

/** What a client needs fixed, for the CSV and the monthly summary: "Phone, Annual review: not a date" */
export function missingInfoText(c: MissingInfoGrid['clients'][number]): string[] {
  return [...c.missing, ...(c.notADate ?? []).map(name => `${name}: not a date`)]
}

/** One line per client: Caseload, Client, Missing (comma-separated). */
export async function exportMissingInfoCsv(destPath: string, gridId?: number): Promise<number> {
  const data = getMissingInfo(gridId).flatMap(g => g.clients.map(c => [g.gridName, c.clientName, missingInfoText(c).join(', ')].map(sanitizeCsvFormula)))
  await atomicWriteFileAsync(destPath, '\uFEFF' + Papa.unparse({ fields: [word('list', { cap: true }), word('record', { cap: true }), 'Missing'], data }), 'utf8')
  return data.length
}
