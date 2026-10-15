/**
 * ipc-saved-views.ts — SAVED_VIEW_* IPC handlers
 */

import { IPC } from '../../shared/ipc-channels'
import { ok, fail } from './ipc-utils'
import { handlersFor, idArg, textArg } from './ipc-define'
import { getDb } from '../database'

const define = handlersFor('ipc-saved-views')

export function registerSavedViewHandlers(): void {
  define(IPC.SAVED_VIEW_GET_ALL, [idArg()], (gridId) => {
    const rows = getDb().prepare('SELECT * FROM saved_views WHERE grid_id = ? ORDER BY name ASC').all(gridId)
    return ok(rows)
  })

  define(IPC.SAVED_VIEW_CREATE, [
    idArg(),
    textArg('Invalid view name', { max: 200, notBlank: true }),
    textArg('View config too large', { max: 100_000 }),
  ], (gridId, name, config) => {
    const db = getDb()
    const result = db.transaction(() => {
      const count = (db.prepare('SELECT COUNT(*) as c FROM saved_views WHERE grid_id = ?').get(gridId) as { c: number }).c
      if (count >= 20) return null
      return db.prepare('INSERT INTO saved_views (grid_id, name, config) VALUES (?, ?, ?)').run(gridId, name, config)
    })()
    if (result === null) return fail("You can keep up to 20 saved views. Delete one you don't use, then save this one.")
    return ok(result.lastInsertRowid)
  }, { write: true })

  define(IPC.SAVED_VIEW_DELETE, [idArg()], (id) => {
    getDb().prepare('DELETE FROM saved_views WHERE id = ?').run(id)
    return ok(true)
  }, { write: true })
}
