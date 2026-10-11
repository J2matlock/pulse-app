/**
 * Editing a status or dropdown column's choices (audit 1.15 / G-02, G-36).
 *
 * Renaming a choice can carry the records that use it along, and on the
 * stage column the stage settings follow the choices: existing ones keep
 * their settings (a renamed one too), new ones are added at the end of the
 * board, removed ones are dropped.
 */
import { getDb } from './database'
import { setCellWithHistory } from './cell-write'
import { columnAffectsDisplayName, refreshDisplayNames } from './display-names'

export class OptionsError extends Error {}

const STATUS_COLORS = ['#22c55e', '#3b82f6', '#eab308', '#f97316', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899']

export interface OptionsChange {
  /** The choices, in order */
  options: string[]
  /** Old label → new label, for choices that were renamed */
  renames?: Record<string, string>
  /** Change the records that use a renamed choice too */
  updateRecords?: boolean
}

/** How many records (not in the trash) hold each value of this column */
export function optionUsage(columnId: number): Record<string, number> {
  const rows = getDb().prepare(`SELECT c.value, COUNT(*) AS n FROM cells c JOIN rows r ON r.id = c.row_id
    WHERE c.column_id = ? AND r.deleted_at IS NULL AND c.value IS NOT NULL AND c.value != '' GROUP BY c.value`).all(columnId) as Array<{ value: string; n: number }>
  return Object.fromEntries(rows.map(r => [r.value, r.n]))
}

/** Save the choices; returns how many records were changed to a renamed choice. */
export function saveColumnOptions(columnId: number, change: OptionsChange): { updated: number } {
  const db = getDb()
  const col = db.prepare('SELECT id, grid_id, name, column_type, config FROM columns WHERE id = ?').get(columnId) as
    { id: number; grid_id: number; name: string; column_type: string; config: string | null } | undefined
  if (!col) throw new OptionsError('That column no longer exists.')
  if (col.column_type !== 'status' && col.column_type !== 'dropdown') throw new OptionsError('Only a status or dropdown column has choices.')
  const options = change.options.map(o => typeof o === 'string' ? o.trim() : '').filter(Boolean)
  if (options.length > 200 || options.some(o => o.length > 200)) throw new OptionsError('There are too many choices, or one is too long.')
  if (new Set(options.map(o => o.toLowerCase())).size !== options.length) throw new OptionsError('Each choice can be listed only once.')
  const renames = Object.entries(change.renames ?? {}).filter(([from, to]) => typeof from === 'string' && typeof to === 'string' && from !== to && options.includes(to))
  const renamedFrom = new Map(renames.map(([from, to]) => [to, from]))

  let cfg: Record<string, unknown> = {}
  try { cfg = JSON.parse(col.config || '{}') as Record<string, unknown> } catch { cfg = {} }

  return db.transaction(() => {
    if (col.column_type === 'status') {
      const old = (Array.isArray(cfg.options) ? cfg.options : []) as Array<{ label?: string; color?: string } | string>
      const colorOf = (label: string) => {
        const hit = old.find(o => typeof o === 'object' && o?.label === label)
        return typeof hit === 'object' ? hit?.color : undefined
      }
      cfg.options = options.map((label, i) => ({ label, color: colorOf(label) ?? colorOf(renamedFrom.get(label) ?? '') ?? STATUS_COLORS[i % STATUS_COLORS.length] }))
    } else {
      cfg.options = options
    }

    // The stage's settings follow the choices
    const stage = cfg.stage as { options?: Array<{ value: string }> } | undefined
    if (stage && Array.isArray(stage.options)) {
      const before = new Map(stage.options.map(o => [o.value, o]))
      stage.options = options.map(value => {
        const kept = before.get(value) ?? before.get(renamedFrom.get(value) ?? '')
        return kept ? { ...kept, value } : { value }
      })
    }
    db.prepare('UPDATE columns SET config = ? WHERE id = ?').run(JSON.stringify(cfg), col.id)

    let updated = 0
    if (change.updateRecords && renames.length) {
      const users = db.prepare(`SELECT c.row_id FROM cells c JOIN rows r ON r.id = c.row_id WHERE c.column_id = ? AND c.value = ? AND r.deleted_at IS NULL`)
      const touched: number[] = []
      for (const [from, to] of renames) {
        for (const { row_id } of users.all(col.id, from) as Array<{ row_id: number }>) {
          setCellWithHistory(row_id, col.id, to)
          touched.push(row_id)
          updated++
        }
      }
      if (touched.length && columnAffectsDisplayName(col.grid_id, col.id)) refreshDisplayNames(col.grid_id, touched)
    }
    return { updated }
  })()
}

