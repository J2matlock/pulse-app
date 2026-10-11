/**
 * ipc-checklists.ts — CHECKLIST_*, CL_TEMPLATE_* IPC handlers
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { extname } from 'node:path'
import { IPC } from '../../shared/ipc-channels'
import { QUERY_LIMITS } from '../../shared/query-limits'
import { secureWrap, ok, fail, buildSafeSetClause, validId, notifyCaseLogChanged, enforceWritable, assertSafePath } from './ipc-utils'
import { getDb } from '../database'
import type { ChecklistItem, ChecklistTemplate, ChecklistGroup } from '../../shared/types'
import { seedChecklistTemplates } from '../templates'
import { applyChecklistTemplate, ChecklistApplyError } from '../checklist-apply'
import { parseRepeatRule, nextRepeatDate, withAnchorDay } from '../../shared/recurrence'
import { localDateString } from '../../shared/dates'

// ── IPC payload size limits ────────────────────────────────────────────────
const MAX_REORDER_CHECKLIST = 500

const UNSAFE_PATH = "Pulse can't use that folder. Choose a file in your Documents, Desktop or Downloads folder."

/** The same folder check every other file handler makes */
function safePath(filePath: string): boolean {
  try { assertSafePath(filePath); return true } catch { return false }
}

export function registerChecklistHandlers(): void {
  // ── Checklists ─────────────────────────────────────────────────────────────
  secureWrap(IPC.CHECKLIST_GET, 'ipc-checklists', (_e, rowId: number) => {
    if (!validId(rowId)) return fail('Invalid ID')
    const items = getDb()
      .prepare('SELECT * FROM checklist_items WHERE row_id = ? AND is_archived = 0 ORDER BY position, id')
      .all(rowId) as ChecklistItem[]
    return ok(items)
  })

  secureWrap(IPC.CHECKLIST_CREATE_ITEM, 'ipc-checklists', (_e, rowId: number, title: string, extra?: Partial<ChecklistItem>) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(rowId)) return fail('Invalid ID')
    if (typeof title !== 'string' || title.trim().length === 0 || title.length > 1000) return fail('Title is required (max 1000 chars)')
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
  })

  /**
   * `silent` (undo and redo) puts an item back as it was: no "Completed" or
   * "Reopened" entry in the activity log and no repeat, since undo voids or
   * restores the original entry instead (audit S-23).
   */
  secureWrap(IPC.CHECKLIST_UPDATE_ITEM, 'ipc-checklists', (_e, id: number, updates: Partial<ChecklistItem>, opts?: { silent?: boolean }) => {
    const silent = !!opts && typeof opts === 'object' && opts.silent === true
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(id)) return fail('Invalid ID')
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

      // System log: completion and un-completion events
      if (before && 'is_completed' in updates && !silent) {
        const wasComplete = before.is_completed === 1
        const nowComplete = updates.is_completed === 1
        if (!wasComplete && nowComplete) {
          const logResult = db.prepare(`INSERT INTO case_log (row_id, content, log_type, created_at, updated_at) VALUES (?, ?, 'system', datetime('now'), datetime('now'))`).run(before.row_id, `Completed checklist item: ${before.title}`)
          sysLogId = logResult.lastInsertRowid as number
          rowIdForNotify = before.row_id
          const ruleJson = 'recurrence_rule' in updates ? updates.recurrence_rule : before.recurrence_rule
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
  })

  secureWrap(IPC.CHECKLIST_DELETE_ITEM, 'ipc-checklists', (_e, id: number) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(id)) return fail('Invalid ID')
    getDb().prepare('DELETE FROM checklist_items WHERE id = ?').run(id)
    return ok(true)
  })

  secureWrap(IPC.CHECKLIST_REORDER, 'ipc-checklists', (_e, rowId: number, orderedIds: number[]) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(rowId)) return fail('Invalid ID')
    if (!Array.isArray(orderedIds) || orderedIds.length > MAX_REORDER_CHECKLIST) return fail('Invalid reorder payload')
    if (!orderedIds.every(id => Number.isInteger(id) && id > 0)) return fail('Invalid IDs in reorder payload')
    const db = getDb()
    const stmt = db.prepare('UPDATE checklist_items SET position = ? WHERE id = ? AND row_id = ?')
    const reorder = db.transaction(() => {
      for (let i = 0; i < orderedIds.length; i++) {
        stmt.run(i, orderedIds[i], rowId)
      }
    })
    reorder()
    return ok(true)
  })

  secureWrap(IPC.CHECKLIST_GET_URGENT, 'ipc-checklists', () => {
    const items = getDb().prepare(`
      SELECT ci.*,
             g.id AS grid_id,
             g.name AS grid_name,
             r.display_name AS client_name
      FROM checklist_items ci
      JOIN rows r ON r.id = ci.row_id AND r.is_active = 1 AND r.deleted_at IS NULL
      JOIN grids g ON g.id = r.grid_id
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

  secureWrap(IPC.CHECKLIST_GET_DUE, 'ipc-checklists', () => {
    const items = getDb().prepare(`
      SELECT ci.*,
             g.id AS grid_id,
             g.name AS grid_name,
             r.display_name AS client_name
      FROM checklist_items ci
      JOIN rows r ON r.id = ci.row_id AND r.is_active = 1 AND r.deleted_at IS NULL
      JOIN grids g ON g.id = r.grid_id AND g.is_active = 1
      WHERE ci.due_date IS NOT NULL
        AND ci.is_completed = 0
        AND ci.is_archived = 0
      ORDER BY ci.due_date ASC
      LIMIT 200
    `).all()
    return ok(items)
  })

  secureWrap(IPC.CHECKLIST_RESET_CYCLE, 'ipc-checklists', (_e, rowId: number) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(rowId)) return fail('Invalid ID')
    getDb().prepare(`
      UPDATE checklist_items
      SET is_completed = 0, completed_at = NULL, completed_by = NULL
      WHERE row_id = ? AND is_completed = 1 AND is_archived = 0
    `).run(rowId)
    return ok(true)
  })

  secureWrap(IPC.CHECKLIST_RESTORE_ITEM, 'ipc-checklists', (_e, item: { id: number; row_id: number; title: string; description: string | null; is_completed: number; due_date: string | null; completed_at: string | null; completed_by: string | null; position: number; category: string | null; priority: string; is_archived: number; created_at: string; template_source_id: number | null; recurrence_rule: string | null; group_id: number | null }) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!item || typeof item.id !== 'number' || typeof item.row_id !== 'number') return fail('Invalid item format')
    if (!item.title || typeof item.title !== 'string' || item.title.length > 1000) return fail('Title missing or too long')
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
    db.prepare(`
      INSERT INTO checklist_items
      (id, row_id, title, description, is_completed, due_date, completed_at, completed_by, position, category, priority, is_archived, created_at, template_source_id, recurrence_rule, group_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(item.id, item.row_id, item.title, item.description ?? null, item.is_completed, item.due_date ?? null, item.completed_at ?? null, item.completed_by ?? null, item.position, item.category ?? null, item.priority, item.is_archived, item.created_at, item.template_source_id ?? null, item.recurrence_rule ?? null, item.group_id ?? null)
    return ok(true)
  })

  secureWrap(IPC.CHECKLIST_APPLY_TEMPLATE, 'ipc-checklists', (_e, rowId: number, templateId: number, groupId?: number | null) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(rowId) || !validId(templateId)) return fail('Invalid ID')
    if (groupId !== undefined && groupId !== null && !validId(groupId)) return fail('Invalid group ID')
    try {
      return ok({ createdIds: applyChecklistTemplate(rowId, templateId, groupId ?? null) })
    } catch (err) {
      if (err instanceof ChecklistApplyError) return fail(err.message)
      throw err
    }
  })

  // ── Checklist Groups ──────────────────────────────────────────────────────
  secureWrap(IPC.CHECKLIST_GROUP_GET_ALL, 'ipc-checklists', (_e, rowId: number) => {
    if (!validId(rowId)) return fail('Invalid ID')
    const groups = getDb()
      .prepare('SELECT * FROM checklist_groups WHERE row_id = ? ORDER BY position, id')
      .all(rowId) as ChecklistGroup[]
    return ok(groups)
  })

  secureWrap(IPC.CHECKLIST_GROUP_CREATE, 'ipc-checklists', (_e, rowId: number, name: string) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(rowId)) return fail('Invalid ID')
    if (typeof name !== 'string' || name.trim().length === 0 || name.length > 200) return fail('Group name is required (max 200 chars)')
    const db = getDb()
    const maxPos = (db.prepare('SELECT MAX(position) as p FROM checklist_groups WHERE row_id = ?').get(rowId) as { p: number | null }).p ?? -1
    const result = db.prepare(`
      INSERT INTO checklist_groups (row_id, name, position, created_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(rowId, name.trim(), maxPos + 1)
    const group = db.prepare('SELECT * FROM checklist_groups WHERE id = ?').get(result.lastInsertRowid) as ChecklistGroup
    return ok(group)
  })

  secureWrap(IPC.CHECKLIST_GROUP_UPDATE, 'ipc-checklists', (_e, groupId: number, updates: Partial<ChecklistGroup>) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(groupId)) return fail('Invalid ID')
    if (updates.name !== undefined && (typeof updates.name !== 'string' || updates.name.trim().length === 0 || updates.name.length > 200)) return fail('Invalid group name (max 200 chars)')
    const allowed = ['name', 'position', 'is_collapsed'] as const
    const result = buildSafeSetClause(updates as Record<string, unknown>, allowed)
    if (!result) return fail('No valid fields to update')
    getDb().prepare(`UPDATE checklist_groups SET ${result.setClause} WHERE id = ?`).run(...result.values, groupId)
    return ok(true)
  })

  secureWrap(IPC.CHECKLIST_GROUP_DELETE, 'ipc-checklists', (_e, groupId: number) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(groupId)) return fail('Invalid ID')
    const db = getDb()
    const deleteGroup = db.transaction(() => {
      db.prepare('UPDATE checklist_items SET group_id = NULL WHERE group_id = ?').run(groupId)
      db.prepare('DELETE FROM checklist_groups WHERE id = ?').run(groupId)
    })
    deleteGroup()
    return ok(true)
  })

  secureWrap(IPC.CHECKLIST_GROUP_REORDER, 'ipc-checklists', (_e, rowId: number, orderedGroupIds: number[]) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(rowId)) return fail('Invalid ID')
    if (!Array.isArray(orderedGroupIds) || orderedGroupIds.length > 100) return fail('Invalid reorder payload')
    if (!orderedGroupIds.every(id => Number.isInteger(id) && id > 0)) return fail('Invalid IDs in reorder payload')
    const db = getDb()
    const stmt = db.prepare('UPDATE checklist_groups SET position = ? WHERE id = ? AND row_id = ?')
    const reorder = db.transaction(() => {
      for (let i = 0; i < orderedGroupIds.length; i++) {
        stmt.run(i, orderedGroupIds[i], rowId)
      }
    })
    reorder()
    return ok(true)
  })

  secureWrap(IPC.CHECKLIST_MOVE_ITEM_TO_GROUP, 'ipc-checklists', (_e, itemId: number, groupId: number | null) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(itemId)) return fail('Invalid item ID')
    if (groupId !== null && !validId(groupId)) return fail('Invalid group ID')
    const db = getDb()
    if (groupId !== null) {
      // Validate group exists and get its row_id
      const group = db.prepare('SELECT row_id FROM checklist_groups WHERE id = ?').get(groupId) as { row_id: number } | undefined
      if (!group) return fail('Group not found')
      // Validate item belongs to same row
      const item = db.prepare('SELECT row_id FROM checklist_items WHERE id = ?').get(itemId) as { row_id: number } | undefined
      if (!item) return fail('Item not found')
      if (item.row_id !== group.row_id) return fail('Item and group must belong to the same client')
    }
    db.prepare('UPDATE checklist_items SET group_id = ? WHERE id = ?').run(groupId, itemId)
    return ok(true)
  })

  // ── Checklist Templates ────────────────────────────────────────────────────
  secureWrap(IPC.CL_TEMPLATE_GET_ALL, 'ipc-checklists', () => {
    // Seed pre-built system templates on first load
    seedChecklistTemplates()
    const templates = getDb().prepare('SELECT * FROM checklist_templates ORDER BY is_system DESC, name ASC').all() as ChecklistTemplate[]
    return ok(templates)
  })

  secureWrap(IPC.CL_TEMPLATE_CREATE, 'ipc-checklists', (_e, template: Omit<ChecklistTemplate, 'id' | 'created_at'>) => {
    const guard = enforceWritable(); if (guard) return guard
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
  })

  secureWrap(IPC.CL_TEMPLATE_UPDATE, 'ipc-checklists', (_e, id: number, updates: Partial<ChecklistTemplate>) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(id)) return fail('Invalid ID')
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
  })

  secureWrap(IPC.CL_TEMPLATE_DELETE, 'ipc-checklists', (_e, id: number) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(id)) return fail('Invalid ID')
    getDb().prepare('DELETE FROM checklist_templates WHERE id = ?').run(id)
    return ok(true)
  })

  // ── Checklist Template Export/Import ─────────────────────────────────────
  secureWrap(IPC.CL_TEMPLATE_EXPORT, 'ipc-checklists', (_e, id: number, filePath: string) => {
    if (!validId(id)) return fail('Invalid ID')
    if (typeof filePath !== 'string' || !filePath) return fail('Invalid file path')
    if (extname(filePath).toLowerCase() !== '.pulse-checklist') return fail('File must have .pulse-checklist extension')
    if (!safePath(filePath)) return fail(UNSAFE_PATH)

    const template = getDb().prepare('SELECT * FROM checklist_templates WHERE id = ?').get(id) as ChecklistTemplate | undefined
    if (!template) return fail('Template not found')

    let items: unknown[]
    try { items = JSON.parse(template.items) as unknown[] } catch { return fail('Template items are corrupted') }

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
      writeFileSync(filePath, JSON.stringify(exportData, null, 2), 'utf-8')
    } catch (err) {
      return fail(`Could not write file: ${err instanceof Error ? err.message : 'unknown error'}`)
    }
    return ok(true)
  })

  secureWrap(IPC.CL_TEMPLATE_IMPORT, 'ipc-checklists', (_e, filePath: string) => {
    const guard = enforceWritable(); if (guard) return guard
    if (typeof filePath !== 'string' || !filePath) return fail('Invalid file path')
    if (extname(filePath).toLowerCase() !== '.pulse-checklist') return fail('File must have .pulse-checklist extension')
    if (!safePath(filePath)) return fail(UNSAFE_PATH)

    let raw: string
    try { raw = readFileSync(filePath, 'utf-8') } catch { return fail('Could not read file') }
    if (raw.length > 500_000) return fail('File is too large (max 500KB)')

    let data: { pulse_type?: string; version?: number; template?: { name?: string; description?: string | null; items?: unknown[]; is_recurring?: 0 | 1; recurrence_days?: number | null } }
    try { data = JSON.parse(raw) as typeof data } catch { return fail('File is not valid JSON') }

    if (data.pulse_type !== 'checklist-template') return fail('This file is not a checklist template')
    if (data.version !== 1) return fail(`Unsupported template version: ${data.version}`)
    const t = data.template
    if (!t || typeof t.name !== 'string' || !t.name.trim()) return fail('Template is missing a name')
    if (!Array.isArray(t.items) || t.items.length === 0) return fail('Template has no items')
    if (t.items.length > 500) return fail('Template has too many items (max 500)')
    for (const item of t.items) {
      if (typeof item !== 'object' || item === null || typeof (item as { title?: unknown }).title !== 'string') {
        return fail('Each item must have a title')
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
    if (itemsJson.length > 100_000) return fail('Template items too large')

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
  })
}
