/**
 * ipc-tags.ts — TAG_* IPC handlers
 */

import { z } from 'zod'
import { IPC } from '../../shared/ipc-channels'
import { ok, fail, buildSafeSetClause } from './ipc-utils'
import { handlersFor, idArg, textArg } from './ipc-define'
import { getDb } from '../database'

const define = handlersFor('ipc-tags')

const tagUpdates = z.looseObject({
  name: textArg('Invalid tag name (max 100 chars)', { min: 1, max: 100 }).optional(),
  color: textArg('Invalid tag color (max 50 chars)', { max: 50 }).optional(),
}, 'No valid fields to update')

export function registerTagHandlers(): void {
  define(IPC.TAG_GET_ALL, [idArg()], (gridId) => {
    const tags = getDb().prepare('SELECT * FROM tags WHERE grid_id = ? ORDER BY name ASC').all(gridId)
    return ok(tags)
  })

  define(IPC.TAG_GET_FOR_ROW, [idArg()], (rowId) => {
    const rows = getDb().prepare('SELECT tag_id FROM row_tags WHERE row_id = ?').all(rowId) as { tag_id: number }[]
    return ok(rows.map(r => r.tag_id))
  })

  define(IPC.TAG_CREATE, [
    idArg(),
    textArg('Invalid tag name', { min: 1, max: 100 }),
    textArg('Invalid tag color', { max: 30 }),
  ], (gridId, name, color) => {
    const db = getDb()
    const result = db.prepare('INSERT INTO tags (grid_id, name, color) VALUES (?, ?, ?)').run(gridId, name, color)
    const tag = db.prepare('SELECT * FROM tags WHERE id = ?').get(result.lastInsertRowid)
    return ok(tag)
  }, { write: true })

  define(IPC.TAG_UPDATE, [idArg(), tagUpdates], (tagId, updates) => {
    const allowed = ['name', 'color'] as const
    const result = buildSafeSetClause(updates, allowed)
    if (!result) return fail('No valid fields to update')
    getDb().prepare(`UPDATE tags SET ${result.setClause} WHERE id = ?`).run(...result.values, tagId)
    return ok(true)
  }, { write: true })

  define(IPC.TAG_DELETE, [idArg()], (tagId) => {
    getDb().prepare('DELETE FROM tags WHERE id = ?').run(tagId)
    return ok(true)
  }, { write: true })

  define(IPC.TAG_ASSIGN, [idArg(), idArg()], (rowId, tagId) => {
    getDb().prepare('INSERT OR IGNORE INTO row_tags (row_id, tag_id) VALUES (?, ?)').run(rowId, tagId)
    return ok(true)
  }, { write: true })

  define(IPC.TAG_UNASSIGN, [idArg(), idArg()], (rowId, tagId) => {
    getDb().prepare('DELETE FROM row_tags WHERE row_id = ? AND tag_id = ?').run(rowId, tagId)
    return ok(true)
  }, { write: true })
}
