/**
 * Missing information report (brainstorm B2): clients with an empty value in
 * any column marked required (column config `required: true`).
 */
import { getDb } from './database'
import type { MissingInfoGrid } from '../shared/types'
import Papa from 'papaparse'
import { atomicWriteFileAsync, sanitizeCsvFormula } from './export-shared'
import { word } from './vocab'

export function getMissingInfo(gridId?: number): MissingInfoGrid[] {
  const db = getDb()
  const rows = db.prepare(`
    SELECT g.id AS grid_id, g.name AS grid_name, r.id AS row_id,
           COALESCE(NULLIF(r.display_name, ''), ?) AS client_name,
           col.name AS column_name, col.position
    FROM columns col
    JOIN grids g ON g.id = col.grid_id AND g.is_active = 1
    JOIN rows r ON r.grid_id = g.id AND r.is_active = 1 AND r.deleted_at IS NULL
    LEFT JOIN cells c ON c.row_id = r.id AND c.column_id = col.id
    WHERE json_extract(col.config, '$.required') = 1
      AND col.column_type NOT IN ('checkbox', 'age_from_dob', 'calculated_days', 'auto_number', 'deadline', 'link', 'file_count')
      AND (c.value IS NULL OR trim(c.value) = '')
      AND (? IS NULL OR g.id = ?)
    ORDER BY g.position, g.name COLLATE NOCASE, client_name COLLATE NOCASE, col.position
  `).all(`Unnamed ${word('record')}`, gridId ?? null, gridId ?? null) as Array<{ grid_id: number; grid_name: string; row_id: number; client_name: string; column_name: string }>

  const required = db.prepare(`
    SELECT col.grid_id, g.name AS grid_name, col.name FROM columns col
    JOIN grids g ON g.id = col.grid_id AND g.is_active = 1
    WHERE json_extract(col.config, '$.required') = 1 AND col.column_type NOT IN ('checkbox', 'age_from_dob', 'calculated_days', 'auto_number', 'deadline', 'link', 'file_count')
      AND (? IS NULL OR col.grid_id = ?)
    ORDER BY g.position, g.name COLLATE NOCASE, col.position
  `).all(gridId ?? null, gridId ?? null) as Array<{ grid_id: number; grid_name: string; name: string }>

  // Map keeps caseload order; every caseload with required columns is listed
  const grids = new Map<number, MissingInfoGrid>()
  for (const r of required) {
    if (!grids.has(r.grid_id)) grids.set(r.grid_id, { gridId: r.grid_id, gridName: r.grid_name, requiredColumns: [], clients: [] })
    grids.get(r.grid_id)!.requiredColumns.push(r.name)
  }
  for (const r of rows) {
    const g = grids.get(r.grid_id)
    if (!g) continue
    const last = g.clients[g.clients.length - 1]
    if (last?.rowId === r.row_id) last.missing.push(r.column_name)
    else g.clients.push({ rowId: r.row_id, clientName: r.client_name, missing: [r.column_name] })
  }
  return [...grids.values()]
}

/** One line per client: Caseload, Client, Missing (comma-separated). */
export async function exportMissingInfoCsv(destPath: string, gridId?: number): Promise<number> {
  const data = getMissingInfo(gridId).flatMap(g => g.clients.map(c => [g.gridName, c.clientName, c.missing.join(', ')].map(sanitizeCsvFormula)))
  await atomicWriteFileAsync(destPath, '\uFEFF' + Papa.unparse({ fields: [word('list', { cap: true }), word('record', { cap: true }), 'Missing'], data }), 'utf8')
  return data.length
}
