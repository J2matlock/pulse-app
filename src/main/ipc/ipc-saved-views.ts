/**
 * ipc-saved-views.ts — SAVED_VIEW_* IPC handlers
 */

import { IPC } from '../../shared/ipc-channels'
import { secureWrap, ok, fail, validId, enforceWritable } from './ipc-utils'
import { getDb } from '../database'

export function registerSavedViewHandlers(): void {
  secureWrap(IPC.SAVED_VIEW_GET_ALL, 'ipc-saved-views', (_e, gridId: number) => {
    if (!validId(gridId)) return fail('Invalid ID')
    const rows = getDb().prepare('SELECT * FROM saved_views WHERE grid_id = ? ORDER BY name ASC').all(gridId)
    return ok(rows)
  })

  secureWrap(IPC.SAVED_VIEW_CREATE, 'ipc-saved-views', (_e, gridId: number, name: string, config: string) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(gridId)) return fail('Invalid ID')
    if (typeof name !== 'string' || !name.trim() || name.length > 200) return fail('Invalid view name')
    if (typeof config !== 'string' || config.length > 100_000) return fail('View config too large')
    const db = getDb()
    const result = db.transaction(() => {
      const count = (db.prepare('SELECT COUNT(*) as c FROM saved_views WHERE grid_id = ?').get(gridId) as { c: number }).c
      if (count >= 20) return null
      return db.prepare('INSERT INTO saved_views (grid_id, name, config) VALUES (?, ?, ?)').run(gridId, name, config)
    })()
    if (result === null) return fail('Maximum of 20 saved views reached')
    return ok(result.lastInsertRowid)
  })

  secureWrap(IPC.SAVED_VIEW_DELETE, 'ipc-saved-views', (_e, id: number) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(id)) return fail('Invalid ID')
    getDb().prepare('DELETE FROM saved_views WHERE id = ?').run(id)
    return ok(true)
  })
}
