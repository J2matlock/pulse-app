/**
 * ipc-acuity.ts — ACUITY_* IPC handlers
 */

import { IPC } from '../../shared/ipc-channels'
import { secureWrap, ok, fail, validId, enforceWritable, buildSafeSetClause } from './ipc-utils'
import { getDb } from '../database'
import { word } from '../vocab'

export function registerAcuityHandlers(): void {
  secureWrap(IPC.ACUITY_GET_LEVELS, 'ipc-acuity', (_e, gridId: number) => {
    if (!validId(gridId)) return fail('Invalid ID')
    const levels = getDb()
      .prepare('SELECT * FROM acuity_levels WHERE grid_id = ? ORDER BY position')
      .all(gridId)
    return ok(levels)
  })

  secureWrap(IPC.ACUITY_CREATE_LEVEL, 'ipc-acuity', (_e, gridId: number, data: { name: string; abbreviation: string; points: number; color: string }) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(gridId)) return fail('Invalid ID')
    if (typeof data.name !== 'string' || data.name.trim().length === 0 || data.name.length > 100) return fail(`${word('priority', { cap: true })} name is required (max 100 characters).`)
    if (typeof data.points !== 'number' || !Number.isFinite(data.points) || data.points < 0) return fail('Points must be a non-negative number')
    if (typeof data.color !== 'string' || data.color.length > 50) return fail('Invalid color')
    if (typeof data.abbreviation !== 'string') return fail('Abbreviation is required')
    const db = getDb()
    const maxPos = (db.prepare('SELECT MAX(position) as m FROM acuity_levels WHERE grid_id = ?').get(gridId) as { m: number | null })?.m ?? -1
    const result = db.prepare(`
      INSERT INTO acuity_levels (grid_id, name, abbreviation, points, color, position)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(gridId, data.name, data.abbreviation.slice(0, 4), data.points, data.color, maxPos + 1)
    const level = db.prepare('SELECT * FROM acuity_levels WHERE id = ?').get(result.lastInsertRowid)
    return ok(level)
  })

  secureWrap(IPC.ACUITY_UPDATE_LEVEL, 'ipc-acuity', (_e, levelId: number, updates: Partial<{ name: string; abbreviation: string; points: number; color: string }>) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(levelId)) return fail('Invalid ID')
    if (updates.name !== undefined && (typeof updates.name !== 'string' || updates.name.length === 0 || updates.name.length > 100)) return fail('Invalid name (max 100 chars)')
    if (updates.points !== undefined && (typeof updates.points !== 'number' || !Number.isFinite(updates.points) || updates.points < 0 || updates.points > 1000)) return fail('Points must be a number between 0 and 1000')
    if (updates.color !== undefined && (typeof updates.color !== 'string' || updates.color.length > 50)) return fail('Invalid color (max 50 chars)')
    if (updates.abbreviation !== undefined && (typeof updates.abbreviation !== 'string' || updates.abbreviation.length > 10)) return fail('Invalid abbreviation (max 10 chars)')
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
  })

  secureWrap(IPC.ACUITY_DELETE_LEVEL, 'ipc-acuity', (_e, levelId: number) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(levelId)) return fail('Invalid ID')
    const db = getDb()
    db.transaction(() => {
      db.prepare('UPDATE rows SET acuity_level_id = NULL WHERE acuity_level_id = ?').run(levelId)
      db.prepare('DELETE FROM acuity_levels WHERE id = ?').run(levelId)
    })()
    return ok(true)
  })

  secureWrap(IPC.ACUITY_REORDER_LEVELS, 'ipc-acuity', (_e, gridId: number, orderedIds: number[]) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(gridId)) return fail('Invalid ID')
    if (!Array.isArray(orderedIds) || orderedIds.length > 100) return fail('Invalid reorder payload')
    if (!orderedIds.every(id => Number.isInteger(id) && id > 0)) return fail('Invalid IDs in reorder payload')
    const db = getDb()
    const stmt = db.prepare('UPDATE acuity_levels SET position = ? WHERE id = ? AND grid_id = ?')
    db.transaction(() => {
      orderedIds.forEach((id, i) => stmt.run(i, id, gridId))
    })()
    return ok(true)
  })

  secureWrap(IPC.ACUITY_SET_ROW_LEVEL, 'ipc-acuity', (_e, rowId: number, levelId: number | null) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(rowId)) return fail('Invalid ID')
    if (levelId !== null && !validId(levelId)) return fail('Invalid ID')
    getDb().prepare('UPDATE rows SET acuity_level_id = ? WHERE id = ?').run(levelId, rowId)
    return ok(true)
  })

  secureWrap(IPC.ACUITY_BULK_SET_LEVEL, 'ipc-acuity', (_e, rowIds: number[], levelId: number | null) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!Array.isArray(rowIds) || rowIds.length === 0 || rowIds.length > 5000) return fail('Invalid rowIds')
    if (!rowIds.every(id => Number.isInteger(id) && id > 0)) return fail('Invalid IDs in rowIds')
    if (levelId !== null && !validId(levelId)) return fail('Invalid levelId')
    const db = getDb()
    const stmt = db.prepare('UPDATE rows SET acuity_level_id = ? WHERE id = ?')
    db.transaction(() => {
      for (const rowId of rowIds) {
        stmt.run(levelId, rowId)
      }
    })()
    return ok(true)
  })

  secureWrap(IPC.ACUITY_TOGGLE, 'ipc-acuity', (_e, gridId: number, enabled: boolean) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(gridId)) return fail('Invalid ID')
    const db = getDb()
    db.prepare('UPDATE grids SET acuity_enabled = ? WHERE id = ?').run(enabled ? 1 : 0, gridId)
    return ok(true)
  })
}
