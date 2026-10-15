/**
 * ipc-acuity.ts — ACUITY_* IPC handlers
 */

import { z } from 'zod'
import { IPC } from '../../shared/ipc-channels'
import { ok, fail, buildSafeSetClause } from './ipc-utils'
import { handlersFor, idArg, idListArg, textArg } from './ipc-define'
import { getDb } from '../database'
import { word } from '../vocab'

const define = handlersFor('ipc-acuity')

/** Checked field by field in the body (the name message uses the workspace's words) */
type NewLevel = { name: string; abbreviation: string; points: number; color: string }

const levelUpdates = z.looseObject({
  name: textArg('Invalid name (max 100 chars)', { min: 1, max: 100 }).optional(),
  points: z.number('Points must be a number between 0 and 1000').min(0, 'Points must be a number between 0 and 1000').max(1000, 'Points must be a number between 0 and 1000').optional(),
  color: textArg('Invalid color (max 50 chars)', { max: 50 }).optional(),
  abbreviation: textArg('Invalid abbreviation (max 10 chars)', { max: 10 }).optional(),
}, 'Invalid request')

export function registerAcuityHandlers(): void {
  define(IPC.ACUITY_GET_LEVELS, [idArg()], (gridId) => {
    const levels = getDb()
      .prepare('SELECT * FROM acuity_levels WHERE grid_id = ? ORDER BY position')
      .all(gridId)
    return ok(levels)
  })

  define(IPC.ACUITY_CREATE_LEVEL, [idArg(), z.custom<NewLevel>()], (gridId, data) => {
    if (typeof data.name !== 'string' || data.name.trim().length === 0 || data.name.length > 100) return fail(`${word('priority', { cap: true })} name is required (max 100 characters).`)
    if (typeof data.points !== 'number' || !Number.isFinite(data.points) || data.points < 0) return fail("Points can't be below 0.")
    if (typeof data.color !== 'string' || data.color.length > 50) return fail('Invalid color')
    if (typeof data.abbreviation !== 'string') return fail(`Give the ${word('priority')} a short form (1 to 4 letters).`)
    const db = getDb()
    const maxPos = (db.prepare('SELECT MAX(position) as m FROM acuity_levels WHERE grid_id = ?').get(gridId) as { m: number | null })?.m ?? -1
    const result = db.prepare(`
      INSERT INTO acuity_levels (grid_id, name, abbreviation, points, color, position)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(gridId, data.name, data.abbreviation.slice(0, 4), data.points, data.color, maxPos + 1)
    const level = db.prepare('SELECT * FROM acuity_levels WHERE id = ?').get(result.lastInsertRowid)
    return ok(level)
  }, { write: true })

  define(IPC.ACUITY_UPDATE_LEVEL, [idArg(), levelUpdates], (levelId, updates) => {
    const db = getDb()
    const allowed = ['name', 'abbreviation', 'points', 'color'] as const
    const sanitized: Record<string, unknown> = { ...updates }
    if (sanitized.abbreviation !== undefined) {
      sanitized.abbreviation = String(sanitized.abbreviation).slice(0, 4)
    }
    const result = buildSafeSetClause(sanitized, allowed)
    if (!result) return ok(true)
    const { setClause, values } = result
    db.prepare(`UPDATE acuity_levels SET ${setClause} WHERE id = ?`).run(...values, levelId)
    return ok(true)
  }, { write: true })

  define(IPC.ACUITY_DELETE_LEVEL, [idArg()], (levelId) => {
    const db = getDb()
    db.transaction(() => {
      db.prepare('UPDATE rows SET acuity_level_id = NULL WHERE acuity_level_id = ?').run(levelId)
      db.prepare('DELETE FROM acuity_levels WHERE id = ?').run(levelId)
    })()
    return ok(true)
  }, { write: true })

  define(IPC.ACUITY_REORDER_LEVELS, [
    idArg(),
    idListArg('Invalid reorder payload', 'Invalid IDs in reorder payload', { max: 100 }),
  ], (gridId, orderedIds) => {
    const db = getDb()
    const stmt = db.prepare('UPDATE acuity_levels SET position = ? WHERE id = ? AND grid_id = ?')
    db.transaction(() => {
      orderedIds.forEach((id, i) => stmt.run(i, id, gridId))
    })()
    return ok(true)
  }, { write: true })

  define(IPC.ACUITY_SET_ROW_LEVEL, [idArg(), idArg().nullable()], (rowId, levelId) => {
    getDb().prepare('UPDATE rows SET acuity_level_id = ? WHERE id = ?').run(levelId, rowId)
    return ok(true)
  }, { write: true })

  define(IPC.ACUITY_BULK_SET_LEVEL, [
    idListArg('Invalid rowIds', 'Invalid IDs in rowIds', { min: 1, max: 5000 }),
    idArg('Invalid levelId').nullable(),
  ], (rowIds, levelId) => {
    const db = getDb()
    const stmt = db.prepare('UPDATE rows SET acuity_level_id = ? WHERE id = ?')
    db.transaction(() => {
      for (const rowId of rowIds) {
        stmt.run(levelId, rowId)
      }
    })()
    return ok(true)
  }, { write: true })

  define(IPC.ACUITY_TOGGLE, [idArg(), z.unknown()], (gridId, enabled) => {
    const db = getDb()
    db.prepare('UPDATE grids SET acuity_enabled = ? WHERE id = ?').run(enabled ? 1 : 0, gridId)
    return ok(true)
  }, { write: true })
}
