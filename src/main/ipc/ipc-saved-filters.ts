/**
 * ipc-saved-filters.ts — SAVED_FILTER_* IPC handlers
 */

import { IPC } from '../../shared/ipc-channels'
import { ok } from './ipc-utils'
import { handlersFor, idArg, textArg } from './ipc-define'
import { getDb } from '../database'

const define = handlersFor('ipc-saved-filters')

export function registerSavedFilterHandlers(): void {
  define(IPC.SAVED_FILTER_GET_ALL, [idArg()], (gridId) => {
    const rows = getDb().prepare('SELECT * FROM saved_filters WHERE grid_id = ? ORDER BY name ASC').all(gridId)
    return ok(rows)
  })

  define(IPC.SAVED_FILTER_CREATE, [
    idArg(),
    textArg('Invalid filter name', { max: 200, notBlank: true }),
    textArg('Filter definition too large', { max: 50_000 }),
  ], (gridId, name, definition) => {
    const db = getDb()
    // Atomic count-then-insert in a transaction to prevent exceeding max 20
    const createFilter = db.transaction(() => {
      const count = (db.prepare('SELECT COUNT(*) as c FROM saved_filters WHERE grid_id = ?').get(gridId) as { c: number }).c
      if (count >= 20) throw new Error('Maximum of 20 saved filters reached')
      return db.prepare('INSERT INTO saved_filters (grid_id, name, filter_config) VALUES (?, ?, ?)').run(gridId, name, definition)
    })
    const info = createFilter()
    return ok(info.lastInsertRowid)
  }, { write: true })

  define(IPC.SAVED_FILTER_DELETE, [idArg()], (id) => {
    getDb().prepare('DELETE FROM saved_filters WHERE id = ?').run(id)
    return ok(true)
  }, { write: true })
}
