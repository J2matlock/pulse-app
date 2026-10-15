/**
 * ipc-checklists.ts — CHECKLIST_*, CL_TEMPLATE_* IPC handlers
 */

import { readFileSync, statSync } from 'node:fs'
import { atomicWriteFileSync } from '../export-shared'
import { extname } from 'node:path'
import { z } from 'zod'
import { IPC } from '../../shared/ipc-channels'
import { QUERY_LIMITS } from '../../shared/query-limits'
import { ok, fail, buildSafeSetClause, notifyCaseLogChanged, assertSafePath, humanizeError, GENERIC_ERROR_MESSAGE, PATH_REFUSED_MESSAGE } from './ipc-utils'
import { handlersFor, idArg, idListArg, textArg } from './ipc-define'
import { getDb } from '../database'
import type { ChecklistItem, ChecklistTemplate, ChecklistGroup } from '../../shared/types'
import { seedChecklistTemplates } from '../templates'
import { applyChecklistTemplate, ChecklistApplyError } from '../checklist-apply'
import { parseRepeatRule, nextRepeatDate, withAnchorDay, withoutAnchorDay } from '../../shared/recurrence'
import { localDateString } from '../../shared/dates'
import { LIVE_GRID, LIVE_ROW } from '../../shared/liveRecords'
import { deleteKeepingCopy } from '../library-restore'

// ── IPC payload size limits ────────────────────────────────────────────────
const MAX_REORDER_CHECKLIST = 500

const UNSAFE_PATH = PATH_REFUSED_MESSAGE
const NOT_A_CHECKLIST = "This file isn't a Pulse checklist, or it's damaged."

/** The same folder check every other file handler makes */
function safePath(filePath: string): boolean {
  try { assertSafePath(filePath); return true } catch { return false }
}

/** A deleted checklist item put back by undo */
interface RestoredItem {
  id: number; row_id: number; title: string; description: string | null; is_completed: number; due_date: string | null
  completed_at: string | null; completed_by: string | null; position: number; category: string | null; priority: string
  is_archived: number; created_at: string; template_source_id: number | null; recurrence_rule: string | null; group_id: number | null
}

const define = handlersFor('ipc-checklists')

export function registerChecklistHandlers(): void {
  // ── Checklists ─────────────────────────────────────────────────────────────
  define(IPC.CHECKLIST_GET, [idArg()], (rowId) => {
    const items = getDb()
      .prepare('SELECT * FROM checklist_items WHERE row_id = ? AND is_archived = 0 ORDER BY position, id')
      .all(rowId) as ChecklistItem[]
    return ok(items)
  })

  // extra's fields are checked in the body, as before
  define(IPC.CHECKLIST_CREATE_ITEM, [
    idArg(), textArg('Title is required (max 1000 chars)', { max: 1000, notBlank: true }), z.custom<Partial<ChecklistItem> | undefined>(),
  ], (rowId, title, extra) => {
    if (extra?.description !== undefined && typeof extra.description !== 'string') return fail('Invalid description')
    if (extra?.priority !== undefined && !['low', 'normal', 'high', 'urgent'].includes(extra.priority)) return fail('Invalid priority')
    const db = getDb()
    const maxPos = (db.prepare('SELECT MAX(position) as p FROM checklist_items WHERE row_id = ? AND group_id IS ?').get(rowId, extra?.group_id ?? null) as { p: number | null }).p ?? -1
    const result = db.prepare(`
      INSERT INTO checklist_items (row_id, title, description, due_date, category, priority, position, group_id, recurrence_rule, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(rowId, title, extra?.description ?? null, extra?.due_date ?? null, extra?.category ?? null, extra?.priority ?? 'normal', maxPos + 1, extra?.group_id ?? null, extra?.recurrence_rule ?? null)
    const item = db.prepare('SELECT * FROM checklist_items WHERE id = ?').get(result.lastInsertRowid) as ChecklistItem
    return ok(item)
  }, { write: true })

  /**
   * `silent` (undo and redo) puts an item back as it was: no "Completed" or
   * "Reopened" entry in the activity log and no repeat, since undo voids or
   * restores the original entry instead (audit S-23).
   */
  // The update's fields are checked in the body, in order, as before
  define(IPC.CHECKLIST_UPDATE_ITEM, [idArg(), z.custom<Partial<ChecklistItem>>(), z.custom<{ silent?: boolean } | undefined>()], (id, updates, opts) => {
    const silent = !!opts && typeof opts === 'object' && opts.silent === true
    // Validate field values when present
    if (updates.title !== undefined && (typeof updates.title !== 'string' || updates.title.length === 0 || updates.title.length > 500)) return fail('Invalid title (max 500 chars)')
    if (updates.description !== undefined && updates.description !== null && (typeof updates.description !== 'string' || updates.description.length > 5000)) return fail('Invalid description (max 5000 chars)')
    if (updates.due_date !== undefined && updates.due_date !== null) {
      if (typeof updates.due_date !== 'string' || !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?/.test(updates.due_date)) return fail('Invalid due_date (must be ISO date string)')
    }
    if (updates.recurrence_rule !== undefined && updates.recurrence_rule !== null && (typeof updates.recurrence_rule !== 'string' || updates.recurrence_rule.length > 1000)) return fail('Invalid recurrence_rule (max 1000 chars)')
    const db = getDb()
    const allowed = ['title', 'description', 'is_completed', 'due_date', 'completed_at',
      'completed_by', 'category', 'priority', 'position', 'is_archived', 'recurrence_rule'] as const
    const result = buildSafeSetClause(updates as Record<string, unknown>, allowed)
    if (!result) return fail('No valid fields to update')

    // Wrap read-then-write in a transaction to prevent race conditions
    let sysLogId: number | null = null
    let rowIdForNotify: number | null = null
    /** A repeating item ticked off comes straight back with its next due date (audit 1.26) */
    let repeat: { previousDue: string | null; nextDue: string } | null = null
    const updateItem = db.transaction(() => {
      // Fetch item before update so we can detect completion transitions
      const before = db.prepare('SELECT row_id, title, is_completed, due_date, recurrence_rule FROM checklist_items WHERE id = ?').get(id) as { row_id: number; title: string; is_completed: number; due_date: string | null; recurrence_rule: string | null } | undefined

      db.prepare(`UPDATE checklist_items SET ${result.setClause} WHERE id = ?`).run(...result.values, id)

      // A due date changed by hand sets the pattern: forget the day of the month it used to
      // fall on (AUDIT-114). Undo and redo (silent) put the item back exactly as it was.
      let ruleNow = 'recurrence_rule' in updates ? updates.recurrence_rule ?? null : before?.recurrence_rule ?? null
      if (before && !silent && 'due_date' in updates && (updates.due_date ?? null) !== before.due_date) {
        const kept = withoutAnchorDay(ruleNow)
        if (kept !== ruleNow) { db.prepare('UPDATE checklist_items SET recurrence_rule = ? WHERE id = ?').run(kept, id); ruleNow = kept }
      }

      // System log: completion and un-completion events
      if (before && 'is_completed' in updates && !silent) {
        const wasComplete = before.is_completed === 1
        const nowComplete = updates.is_completed === 1
        if (!wasComplete && nowComplete) {
          const logResult = db.prepare(`INSERT INTO case_log (row_id, content, log_type, created_at, updated_at) VALUES (?, ?, 'system', datetime('now'), datetime('now'))`).run(before.row_id, `Completed checklist item: ${before.title}`)
          sysLogId = logResult.lastInsertRowid as number
          rowIdForNotify = before.row_id
          const ruleJson = ruleNow
          const rule = parseRepeatRule(ruleJson)
          const due = 'due_date' in updates ? updates.due_date : before.due_date
          const next = rule ? nextRepeatDate(due, rule, localDateString()) : null
          if (next) {
            db.prepare('UPDATE checklist_items SET is_completed = 0, completed_at = NULL, completed_by = NULL, due_date = ?, recurrence_rule = ? WHERE id = ?').run(next, withAnchorDay(ruleJson, due), id)
            repeat = { previousDue: due ?? null, nextDue: next }
          }
        } else if (wasComplete && !nowComplete) {
          const logResult = db.prepare(`INSERT INTO case_log (row_id, content, log_type, created_at, updated_at) VALUES (?, ?, 'system', datetime('now'), datetime('now'))`).run(before.row_id, `Reopened checklist item: ${before.title}`)
          sysLogId = logResult.lastInsertRowid as number
          rowIdForNotify = before.row_id
        }
      }
    })
    updateItem()

    // Notify outside the transaction (renderer-side effect)
    if (rowIdForNotify !== null) notifyCaseLogChanged(rowIdForNotify)

    return ok({ sysLogId, repeat })
  }, { write: true })

  define(IPC.CHECKLIST_DELETE_ITEM, [idArg()], (id) => {
    getDb().prepare('DELETE FROM checklist_items WHERE id = ?').run(id)
    return ok(true)
  }, { write: true })

  define(IPC.CHECKLIST_REORDER, [
    idArg(), idListArg('Invalid reorder payload', 'Invalid IDs in reorder payload', { max: MAX_REORDER_CHECKLIST }),
  ], (rowId, orderedIds) => {
    const db = getDb()
    const stmt = db.prepare('UPDATE checklist_items SET position = ? WHERE id = ? AND row_id = ?')
    const reorder = db.transaction(() => {
      for (let i = 0; i < orderedIds.length; i++) {
        stmt.run(i, orderedIds[i], rowId)
      }
    })
    reorder()
    return ok(true)
  }, { write: true })

  define(IPC.CHECKLIST_GET_URGENT, [], () => {
    const items = getDb().prepare(`
      SELECT ci.*,
             g.id AS grid_id,
             g.name AS grid_name,
             r.display_name AS client_name
      FROM checklist_items ci
      JOIN rows r ON r.id = ci.row_id AND ${LIVE_ROW}
      JOIN grids g ON g.id = r.grid_id AND ${LIVE_GRID}
      WHERE ci.priority = 'urgent'
        AND ci.is_completed = 0
        AND ci.is_archived = 0
      ORDER BY
        CASE WHEN ci.due_date IS NULL THEN 1 ELSE 0 END,
        ci.due_date ASC,
        ci.created_at ASC
      LIMIT ${QUERY_LIMITS.CHECKLIST_URGENT}
    `).all()
    return ok(items)
  })

  define(IPC.CHECKLIST_GET_DUE, [], () => {
    const items = getDb().prepare(`
      SELECT ci.*,
             g.id AS grid_id,
             g.name AS grid_name,
             r.display_name AS client_name
      FROM checklist_items ci
      JOIN rows r ON r.id = ci.row_id AND ${LIVE_ROW}
      JOIN grids g ON g.id = r.grid_id AND ${LIVE_GRID}
      WHERE ci.due_date IS NOT NULL
        AND ci.is_completed = 0
        AND ci.is_archived = 0
      ORDER BY ci.due_date ASC
      LIMIT 200
    `).all()
    return ok(items)
  })

  define(IPC.CHECKLIST_RESET_CYCLE, [idArg()], (rowId) => {
    getDb().prepare(`
      UPDATE checklist_items
      SET is_completed = 0, completed_at = NULL, completed_by = NULL
      WHERE row_id = ? AND is_completed = 1 AND is_archived = 0
    `).run(rowId)
    return ok(true)
  }, { write: true })

  // The item is checked in the body, field by field, as before
  define(IPC.CHECKLIST_RESTORE_ITEM, [z.custom<RestoredItem>()], (item) => {
    if (!item || typeof item.id !== 'number' || typeof item.row_id !== 'number') return fail('Invalid item format')
    if (!item.title || typeof item.title !== 'string' || item.title.length > 1000) return fail('Give the item a title (up to 1,000 characters).')
    if (item.created_at) {
      const d = new Date(item.created_at)
      if (isNaN(d.getTime())) return fail('Invalid created_at date')
      const now = Date.now()
      if (d.getTime() > now + 365 * 86400000 || d.getTime() < new Date('2020-01-01').getTime()) {
        return fail('created_at out of valid range')
      }
    }
    const db = getDb()
    // Verify the ID doesn't collide with an existing record to prevent overwriting
    const existing = db.prepare('SELECT id FROM checklist_items WHERE id = ?').get(item.id)
    if (existing) return fail('Item with this ID already exists')
    // Its group may have been deleted since: put it back ungrouped (bug sweep S2)
    const groupId = item.group_id != null && db.prepare('SELECT 1 FROM checklist_groups WHERE id = ? AND row_id = ?').get(item.group_id, item.row_id) ? item.group_id : null
    db.prepare(`
      INSERT INTO checklist_items
      (id, row_id, title, description, is_completed, due_date, completed_at, completed_by, position, category, priority, is_archived, created_at, template_source_id, recurrence_rule, group_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(item.id, item.row_id, item.title, item.description ?? null, item.is_completed, item.due_date ?? null, item.completed_at ?? null, item.completed_by ?? null, item.position, item.category ?? null, item.priority, item.is_archived, item.created_at, item.template_source_id ?? null, item.recurrence_rule ?? null, groupId)
    return ok(true)
  }, { write: true })

  define(IPC.CHECKLIST_APPLY_TEMPLATE, [idArg(), idArg(), idArg('Invalid group ID').nullish()], (rowId, templateId, groupId) => {
    try {
      return ok({ createdIds: applyChecklistTemplate(rowId, templateId, groupId ?? null) })
    } catch (err) {
      if (err instanceof ChecklistApplyError) return fail(err.message)
      throw err
    }
  }, { write: true })

  // ── Checklist Groups ──────────────────────────────────────────────────────
  define(IPC.CHECKLIST_GROUP_GET_ALL, [idArg()], (rowId) => {
    const groups = getDb()
      .prepare('SELECT * FROM checklist_groups WHERE row_id = ? ORDER BY position, id')
      .all(rowId) as ChecklistGroup[]
    return ok(groups)
  })

  define(IPC.CHECKLIST_GROUP_CREATE, [idArg(), textArg('Group name is required (max 200 chars)', { max: 200, notBlank: true })], (rowId, name) => {
    const db = getDb()
    const maxPos = (db.prepare('SELECT MAX(position) as p FROM checklist_groups WHERE row_id = ?').get(rowId) as { p: number | null }).p ?? -1
    const result = db.prepare(`
      INSERT INTO checklist_groups (row_id, name, position, created_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(rowId, name.trim(), maxPos + 1)
    const group = db.prepare('SELECT * FROM checklist_groups WHERE id = ?').get(result.lastInsertRowid) as ChecklistGroup
    return ok(group)
  }, { write: true })

  define(IPC.CHECKLIST_GROUP_UPDATE, [idArg(), z.custom<Partial<ChecklistGroup>>()], (groupId, updates) => {
    if (updates.name !== undefined && (typeof updates.name !== 'string' || updates.name.trim().length === 0 || updates.name.length > 200)) return fail('Invalid group name (max 200 chars)')
    const allowed = ['name', 'position', 'is_collapsed'] as const
    const result = buildSafeSetClause(updates as Record<string, unknown>, allowed)
    if (!result) return fail('No valid fields to update')
    getDb().prepare(`UPDATE checklist_groups SET ${result.setClause} WHERE id = ?`).run(...result.values, groupId)
    return ok(true)
  }, { write: true })

  define(IPC.CHECKLIST_GROUP_DELETE, [idArg()], (groupId) => {
    const db = getDb()
    const deleteGroup = db.transaction(() => {
      db.prepare('UPDATE checklist_items SET group_id = NULL WHERE group_id = ?').run(groupId)
      db.prepare('DELETE FROM checklist_groups WHERE id = ?').run(groupId)
    })
    deleteGroup()
    return ok(true)
  }, { write: true })

  define(IPC.CHECKLIST_GROUP_REORDER, [
    idArg(), idListArg('Invalid reorder payload', 'Invalid IDs in reorder payload', { max: 100 }),
  ], (rowId, orderedGroupIds) => {
    const db = getDb()
    const stmt = db.prepare('UPDATE checklist_groups SET position = ? WHERE id = ? AND row_id = ?')
    const reorder = db.transaction(() => {
      for (let i = 0; i < orderedGroupIds.length; i++) {
        stmt.run(i, orderedGroupIds[i], rowId)
      }
    })
    reorder()
    return ok(true)
  }, { write: true })

  define(IPC.CHECKLIST_MOVE_ITEM_TO_GROUP, [idArg('Invalid item ID'), idArg('Invalid group ID').nullable()], (itemId, groupId) => {
    const db = getDb()
    if (groupId !== null) {
      // Validate group exists and get its row_id
      const group = db.prepare('SELECT row_id FROM checklist_groups WHERE id = ?').get(groupId) as { row_id: number } | undefined
      if (!group) return fail('Group not found')
      // Validate item belongs to same row
      const item = db.prepare('SELECT row_id FROM checklist_items WHERE id = ?').get(itemId) as { row_id: number } | undefined
      if (!item) return fail('Item not found')
      if (item.row_id !== group.row_id) return fail('An item can only move to a group on the same checklist.')
    }
    db.prepare('UPDATE checklist_items SET group_id = ? WHERE id = ?').run(groupId, itemId)
    return ok(true)
  }, { write: true })

  // ── Checklist Templates ────────────────────────────────────────────────────
  define(IPC.CL_TEMPLATE_GET_ALL, [], () => {
    // Seed pre-built system templates on first load
    seedChecklistTemplates()
    const templates = getDb().prepare('SELECT * FROM checklist_templates ORDER BY is_system DESC, name ASC').all() as ChecklistTemplate[]
    return ok(templates)
  })

  // The template's fields are checked in the body, in order, as before
  define(IPC.CL_TEMPLATE_CREATE, [z.custom<Omit<ChecklistTemplate, 'id' | 'created_at'>>()], (template) => {
    if (typeof template.name !== 'string' || !template.name.trim() || template.name.length > 200) return fail('Invalid template name')
    if (typeof template.items !== 'string' || template.items.length > 100_000) return fail('Template items too large')
    try { const parsed = JSON.parse(template.items); if (!Array.isArray(parsed)) return fail('Template items must be a JSON array') } catch { return fail('Invalid template items JSON') }
    const db = getDb()
    const result = db.prepare(`
      INSERT INTO checklist_templates (name, description, items, is_recurring, recurrence_days, is_system, created_at)
      VALUES (?, ?, ?, ?, ?, 0, datetime('now'))
    `).run(template.name, template.description ?? null, template.items, template.is_recurring, template.recurrence_days ?? null)
    const created = db.prepare('SELECT * FROM checklist_templates WHERE id = ?').get(result.lastInsertRowid) as ChecklistTemplate
    return ok(created)
  }, { write: true })

  define(IPC.CL_TEMPLATE_UPDATE, [idArg(), z.custom<Partial<ChecklistTemplate>>()], (id, updates) => {
    if (updates.items !== undefined) {
      if (typeof updates.items !== 'string' || updates.items.length > 100_000) return fail('Template items too large (max 100,000 chars)')
      try { const parsed = JSON.parse(updates.items); if (!Array.isArray(parsed)) return fail('Template items must be a JSON array') } catch { return fail('Invalid template items JSON') }
    }
    if (updates.name !== undefined && (typeof updates.name !== 'string' || !updates.name.trim() || updates.name.length > 200)) return fail('Invalid template name')
    const allowed = ['name', 'description', 'items', 'is_recurring', 'recurrence_days'] as const
    const result = buildSafeSetClause(updates as Record<string, unknown>, allowed)
    if (!result) return fail('No valid fields to update')
    const db = getDb()
    db.prepare(`UPDATE checklist_templates SET ${result.setClause} WHERE id = ?`).run(...result.values, id)
    const updated = db.prepare('SELECT * FROM checklist_templates WHERE id = ?').get(id) as ChecklistTemplate
    return ok(updated)
  }, { write: true })

  // Keeps a copy for Undo, which puts it back under the same id (Q4)
  define(IPC.CL_TEMPLATE_DELETE, [idArg()], (id) => {
    const undoToken = deleteKeepingCopy('checklist-template', id, () => { getDb().prepare('DELETE FROM checklist_templates WHERE id = ?').run(id) })
    return ok({ undoToken })
  }, { write: true })

  // ── Checklist Template Export/Import ─────────────────────────────────────
  define(IPC.CL_TEMPLATE_EXPORT, [idArg(), textArg('Invalid file path', { min: 1 })], (id, filePath) => {
    if (extname(filePath).toLowerCase() !== '.pulse-checklist') return fail('Save it as a Pulse checklist file (the name ends in .pulse-checklist).')
    if (!safePath(filePath)) return fail(UNSAFE_PATH)

    const template = getDb().prepare('SELECT * FROM checklist_templates WHERE id = ?').get(id) as ChecklistTemplate | undefined
    if (!template) return fail("That checklist template isn't there any more.")

    let items: unknown[]
    try { items = JSON.parse(template.items) as unknown[] } catch { return fail('That checklist template is damaged. Make it again under Templates.') }

    const exportData = {
      pulse_type: 'checklist-template' as const,
      version: 1,
      template: {
        name: template.name,
        description: template.description,
        items,
        is_recurring: template.is_recurring,
        recurrence_days: template.recurrence_days,
      },
    }

    try {
      // Atomic, so a failed write never leaves half a template file behind (Q-054)
      atomicWriteFileSync(filePath, JSON.stringify(exportData, null, 2), 'utf-8')
    } catch (err) {
      // File-system codes (EACCES, EBUSY, ENOSPC…) get their own sentence; any other raw Node text stays out of the UI
      const raw = err instanceof Error ? err.message : String(err)
      const friendly = humanizeError(err)
      return fail(friendly === raw || friendly === GENERIC_ERROR_MESSAGE ? "Pulse couldn't save the file there. Choose a different folder." : friendly)
    }
    return ok(true)
  })

  define(IPC.CL_TEMPLATE_IMPORT, [textArg('Invalid file path', { min: 1 })], (filePath) => {
    if (extname(filePath).toLowerCase() !== '.pulse-checklist') return fail('Choose a Pulse checklist file (the name ends in .pulse-checklist).')
    if (!safePath(filePath)) return fail(UNSAFE_PATH)

    // Size first: a huge file named .pulse-checklist isn't read into memory to find out (Q-056)
    try { if (statSync(filePath).size > 2_000_000) return fail('That file is too large to be a Pulse checklist.') } catch { return fail("Pulse couldn't open that file. It may have been moved or deleted.") }
    let raw: string
    try { raw = readFileSync(filePath, 'utf-8') } catch { return fail("Pulse couldn't open that file. It may have been moved or deleted.") }
    if (raw.length > 500_000) return fail('That file is too large to be a Pulse checklist.')

    let data: { pulse_type?: string; version?: number; template?: { name?: string; description?: string | null; items?: unknown[]; is_recurring?: 0 | 1; recurrence_days?: number | null } }
    try { data = JSON.parse(raw) as typeof data } catch { return fail(NOT_A_CHECKLIST) }

    if (data.pulse_type !== 'checklist-template') return fail(NOT_A_CHECKLIST)
    if (typeof data.version === 'number' && data.version > 1) return fail('This checklist was made by a newer version of Pulse. Update Pulse, then try again.')
    if (data.version !== 1) return fail(NOT_A_CHECKLIST)
    const t = data.template
    if (!t || typeof t.name !== 'string' || !t.name.trim()) return fail('That checklist file has no name.')
    if (!Array.isArray(t.items) || t.items.length === 0) return fail('That checklist file has no items.')
    if (t.items.length > 500) return fail('That checklist has more than 500 items, which is more than Pulse can bring in.')
    for (const item of t.items) {
      if (typeof item !== 'object' || item === null || typeof (item as { title?: unknown }).title !== 'string') {
        return fail('That checklist file has an item without a title.')
      }
    }

    // Deduplicate name
    const db = getDb()
    let finalName = t.name.trim().slice(0, 200)
    const existing = db.prepare('SELECT name FROM checklist_templates WHERE name = ?').get(finalName)
    if (existing) {
      for (let i = 2; i <= 100; i++) {
        const candidate = `${finalName} (${i})`
        if (!db.prepare('SELECT name FROM checklist_templates WHERE name = ?').get(candidate)) {
          finalName = candidate
          break
        }
      }
    }

    const itemsJson = JSON.stringify(t.items)
    if (itemsJson.length > 100_000) return fail('That checklist is too large for Pulse to bring in.')

    const result = db.prepare(`
      INSERT INTO checklist_templates (name, description, items, is_recurring, recurrence_days, is_system, created_at)
      VALUES (?, ?, ?, ?, ?, 0, datetime('now'))
    `).run(
      finalName,
      typeof t.description === 'string' ? t.description : null,
      itemsJson,
      t.is_recurring === 1 ? 1 : 0,
      typeof t.recurrence_days === 'number' ? t.recurrence_days : null,
    )
    const created = db.prepare('SELECT * FROM checklist_templates WHERE id = ?').get(result.lastInsertRowid) as ChecklistTemplate
    return ok(created)
  }, { write: true })
}
