/**
 * Changing a column's type (audit 3.12 / G-19). Values that fit the new type
 * are rewritten in its form ("10/6/2026" becomes 2026-10-06, "$1,200" becomes
 * 1200); values that don't are kept as they are, never deleted. Choice
 * columns get their choices from the values already there.
 */
import { getDb } from './database'
import { setCellWithHistory } from './cell-write'
import { keepSamplesUntouched } from './sample-marks'
import { parseDate } from '../shared/parseDate'
import { CHANGEABLE_TYPES } from '../shared/columnTypes'
import { cellText } from '../shared/cellText'
import { canNameRecords } from '../shared/types'

export class ColumnTypeError extends Error {}

// Types whose stored value isn't the text they show
const STORED_FORM_TYPES = new Set(['tag', 'checkbox', 'link'])

const STATUS_COLORS = ['#22c55e', '#3b82f6', '#eab308', '#f97316', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899']

/**
 * The value in the new type's form, or null when it doesn't fit. A value in
 * the old type's stored form is read as the text it shows first, so tags
 * become "urgent, new" (not ["urgent","new"]) and a checkbox "Yes" or "No".
 */
export function convertValue(value: string, to: string, from?: string): string | null {
  const shown = from && from !== to && STORED_FORM_TYPES.has(from) ? cellText(from, value) : value
  const v = shown.trim()
  if (!v) return ''
  switch (to) {
    case 'number':
    case 'currency': {
      const n = Number(v.replace(/[$,\s]/g, ''))
      return isNaN(n) ? null : String(n)
    }
    case 'date': return parseDate(v)
    case 'checkbox': {
      const l = v.toLowerCase()
      if (['true', 'yes', 'y', '1', 'x', '✓'].includes(l)) return 'true'
      if (['false', 'no', 'n', '0'].includes(l)) return 'false'
      return null
    }
    case 'email': return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null
    case 'url': return /^(https?:\/\/)?[^\s.]+\.[^\s]+$/i.test(v) ? v : null
    case 'phone': return v.replace(/\D/g, '').length >= 7 ? v : null
    case 'tag': {
      try { const a = JSON.parse(v) as unknown; if (Array.isArray(a)) return JSON.stringify(a.map(String)) } catch { /* split it */ }
      return JSON.stringify(v.split(',').map(s => s.trim()).filter(Boolean))
    }
    default: return v
  }
}

interface Col { id: number; grid_id: number; name: string; column_type: string; config: string | null; is_name_column: number }

function load(columnId: number, to: string): { col: Col; cells: Array<{ row_id: number; value: string }> } {
  const db = getDb()
  const col = db.prepare('SELECT id, grid_id, name, column_type, config, is_name_column FROM columns WHERE id = ?').get(columnId) as Col | undefined
  if (!col) throw new ColumnTypeError('That column no longer exists.')
  if (col.is_name_column === 1 && !canNameRecords(to)) throw new ColumnTypeError('This column names the records, so it can\'t become that type. Choose another name column first.')
  if (!CHANGEABLE_TYPES.has(col.column_type)) throw new ColumnTypeError("This kind of column can't be changed to another type.")
  if (!CHANGEABLE_TYPES.has(to)) throw new ColumnTypeError("A column can't be changed to that type. Add a new column instead.")
  const cells = db.prepare(`SELECT c.row_id, c.value FROM cells c JOIN rows r ON r.id = c.row_id
    WHERE c.column_id = ? AND c.value IS NOT NULL AND TRIM(c.value) != '' ORDER BY r.position, r.id`).all(columnId) as Array<{ row_id: number; value: string }>
  return { col, cells }
}

export interface TypePreview { total: number; clean: number; examples: string[] }

/** How many filled-in values fit the new type, and a few that don't */
export function previewTypeChange(columnId: number, to: string): TypePreview {
  const { col, cells } = load(columnId, to)
  const bad = cells.filter(c => convertValue(c.value, to, col.column_type) === null)
  return { total: cells.length, clean: cells.length - bad.length, examples: [...new Set(bad.map(c => c.value))].slice(0, 5) }
}

export interface TypeChangeSnapshot { previousType: string; previousConfig: string | null; changed: Array<{ rowId: number; old: string }> }

export function changeColumnType(columnId: number, to: string): TypeChangeSnapshot {
  const db = getDb()
  const { col, cells } = load(columnId, to)
  if (col.column_type === to) return { previousType: to, previousConfig: col.config, changed: [] }
  // Converted values aren't edits to the list's sample entries
  return db.transaction((): TypeChangeSnapshot => keepSamplesUntouched(db, col.grid_id, () => {
    const changed: TypeChangeSnapshot['changed'] = []
    const after: string[] = []
    for (const c of cells) {
      const v = convertValue(c.value, to, col.column_type)
      if (v !== null && v !== c.value) { setCellWithHistory(c.row_id, columnId, v); changed.push({ rowId: c.row_id, old: c.value }) }
      after.push(v ?? c.value)
    }
    let cfg: Record<string, unknown> = {}
    try { cfg = JSON.parse(col.config || '{}') as Record<string, unknown> } catch { cfg = {} }
    if (to === 'dropdown' || to === 'status') {
      // The values already there become the choices, after any it had
      const had = Array.isArray(cfg.options) ? (cfg.options as Array<string | { label?: string }>).map(o => typeof o === 'string' ? o : o?.label ?? '').filter(Boolean) : []
      const values = [...had, ...new Set(after.map(v => v.trim()))].filter((v, i, a) => v && a.indexOf(v) === i).slice(0, 200)
      cfg.options = to === 'status' ? values.map((label, i) => ({ label, color: STATUS_COLORS[i % STATUS_COLORS.length] })) : values
    }
    db.prepare('UPDATE columns SET column_type = ?, config = ? WHERE id = ?').run(to, JSON.stringify(cfg), columnId)
    return { previousType: col.column_type, previousConfig: col.config, changed }
  }))()
}

/** Undo: the old type and settings, and every value as it was */
export function undoColumnTypeChange(columnId: number, snap: TypeChangeSnapshot): void {
  const db = getDb()
  if (!CHANGEABLE_TYPES.has(snap.previousType)) throw new ColumnTypeError("That change can't be undone.")
  const gridId = (db.prepare('SELECT grid_id FROM columns WHERE id = ?').get(columnId) as { grid_id: number } | undefined)?.grid_id ?? 0
  db.transaction(() => keepSamplesUntouched(db, gridId, () => {
    db.prepare('UPDATE columns SET column_type = ?, config = ? WHERE id = ?').run(snap.previousType, snap.previousConfig, columnId)
    for (const c of snap.changed) setCellWithHistory(c.rowId, columnId, c.old)
  }))()
}
