/**
 * ipc-saved-filters.ts — SAVED_FILTER_* IPC handlers
 */

import { IPC } from '../../shared/ipc-channels'
import { secureWrap, ok, fail, validId, enforceWritable } from './ipc-utils'
import { getDb } from '../database'

export function registerSavedFilterHandlers(): void {
  secureWrap(IPC.SAVED_FILTER_GET_ALL, 'ipc-saved-filters', (_e, gridId: number) => {
    if (!validId(gridId)) return fail('Invalid ID')
    const rows = getDb().prepare('SELECT * FROM saved_filters WHERE grid_id = ? ORDER BY name ASC').all(gridId)
    return ok(rows)
  })

  secureWrap(IPC.SAVED_FILTER_CREATE, 'ipc-saved-filters', (_e, gridId: number, name: string, definition: string) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(gridId)) return fail('Invalid ID')
    if (typeof name !== 'string' || !name.trim() || name.length > 200) return fail('Invalid filter name')
    if (typeof definition !== 'string' || definition.length > 50_000) return fail('Filter definition too large')
    const db = getDb()
    // Atomic count-then-insert in a transaction to prevent exceeding max 20
    const createFilter = db.transaction(() => {
      const count = (db.prepare('SELECT COUNT(*) as c FROM saved_filters WHERE grid_id = ?').get(gridId) as { c: number }).c
      if (count >= 20) throw new Error('Maximum of 20 saved filters reached')
      return db.prepare('INSERT INTO saved_filters (grid_id, name, filter_config) VALUES (?, ?, ?)').run(gridId, name, definition)
    })
    const info = createFilter()
    return ok(info.lastInsertRowid)
  })

  secureWrap(IPC.SAVED_FILTER_DELETE, 'ipc-saved-filters', (_e, id: number) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(id)) return fail('Invalid ID')
    getDb().prepare('DELETE FROM saved_filters WHERE id = ?').run(id)
    return ok(true)
  })
}
