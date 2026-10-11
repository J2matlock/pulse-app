/**
 * ipc-tags.ts — TAG_* IPC handlers
 */

import { IPC } from '../../shared/ipc-channels'
import { secureWrap, ok, fail, buildSafeSetClause, validId, enforceWritable } from './ipc-utils'
import { getDb } from '../database'

export function registerTagHandlers(): void {
  secureWrap(IPC.TAG_GET_ALL, 'ipc-tags', (_e, gridId: number) => {
    if (!validId(gridId)) return fail('Invalid ID')
    const tags = getDb().prepare('SELECT * FROM tags WHERE grid_id = ? ORDER BY name ASC').all(gridId)
    return ok(tags)
  })

  secureWrap(IPC.TAG_GET_FOR_ROW, 'ipc-tags', (_e, rowId: number) => {
    if (!validId(rowId)) return fail('Invalid ID')
    const rows = getDb().prepare('SELECT tag_id FROM row_tags WHERE row_id = ?').all(rowId) as { tag_id: number }[]
    return ok(rows.map(r => r.tag_id))
  })

  secureWrap(IPC.TAG_CREATE, 'ipc-tags', (_e, gridId: number, name: string, color: string) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(gridId)) return fail('Invalid ID')
    if (typeof name !== 'string' || name.length === 0 || name.length > 100) return fail('Invalid tag name')
    if (typeof color !== 'string' || color.length > 30) return fail('Invalid tag color')
    const db = getDb()
    const result = db.prepare('INSERT INTO tags (grid_id, name, color) VALUES (?, ?, ?)').run(gridId, name, color)
    const tag = db.prepare('SELECT * FROM tags WHERE id = ?').get(result.lastInsertRowid)
    return ok(tag)
  })

  secureWrap(IPC.TAG_UPDATE, 'ipc-tags', (_e, tagId: number, updates: { name?: string; color?: string }) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(tagId)) return fail('Invalid ID')
    if (updates.name !== undefined && (typeof updates.name !== 'string' || updates.name.length === 0 || updates.name.length > 100)) return fail('Invalid tag name (max 100 chars)')
    if (updates.color !== undefined && (typeof updates.color !== 'string' || updates.color.length > 50)) return fail('Invalid tag color (max 50 chars)')
    const allowed = ['name', 'color'] as const
    const result = buildSafeSetClause(updates as Record<string, unknown>, allowed)
    if (!result) return fail('No valid fields to update')
    getDb().prepare(`UPDATE tags SET ${result.setClause} WHERE id = ?`).run(...result.values, tagId)
    return ok(true)
  })

  secureWrap(IPC.TAG_DELETE, 'ipc-tags', (_e, tagId: number) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(tagId)) return fail('Invalid ID')
    getDb().prepare('DELETE FROM tags WHERE id = ?').run(tagId)
    return ok(true)
  })

  secureWrap(IPC.TAG_ASSIGN, 'ipc-tags', (_e, rowId: number, tagId: number) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(rowId) || !validId(tagId)) return fail('Invalid ID')
    getDb().prepare('INSERT OR IGNORE INTO row_tags (row_id, tag_id) VALUES (?, ?)').run(rowId, tagId)
    return ok(true)
  })

  secureWrap(IPC.TAG_UNASSIGN, 'ipc-tags', (_e, rowId: number, tagId: number) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(rowId) || !validId(tagId)) return fail('Invalid ID')
    getDb().prepare('DELETE FROM row_tags WHERE row_id = ? AND tag_id = ?').run(rowId, tagId)
    return ok(true)
  })
}
