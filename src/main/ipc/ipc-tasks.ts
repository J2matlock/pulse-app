/**
 * ipc-tasks.ts — TASK_*, SNIPPET_* IPC handlers
 */

import { IPC } from '../../shared/ipc-channels'
import { QUERY_LIMITS } from '../../shared/query-limits'
import { secureWrap, logNonFatal, ok, fail, buildSafeSetClause, validId, enforceWritable } from './ipc-utils'
import { getDb, cachedStmt } from '../database'
import type { CaseloadTask, TaskGroup, Snippet } from '../../shared/types'
import { localDateString } from '../../shared/dates'
import { usesHumanServicesWords } from '../vocab'
import { parseRepeatRule, nextRepeatDate, withAnchorDay } from '../../shared/recurrence'

// ── IPC payload size limits ────────────────────────────────────────────────
const MAX_REORDER_TASKS = 500
const ALLOWED_PRIORITIES = new Set(['low', 'normal', 'high', 'urgent'])
const VALID_RECURRENCE_TYPES = new Set(['daily', 'weekly', 'monthly', 'yearly'])

export function registerTaskHandlers(): void {
  // ── Caseload Tasks ──────────────────────────────────────────────────────────
  secureWrap(IPC.TASK_GET_ALL, 'ipc-tasks', (_e, gridId?: number) => {
    if (gridId != null && !validId(gridId)) return fail('Invalid ID')
    const TASK_COLS = 'id, grid_id, group_id, title, description, priority, category, due_date, recurrence_rule, is_completed, completed_at, snoozed_until, position, created_at, updated_at'
    // Open tasks first, then only the most recent finished ones, so a long
    // history of finished tasks never pushes new ones off the list (audit S-14)
    const where = gridId != null ? 'grid_id = ? AND' : ''
    const args = gridId != null ? [gridId] : []
    const open = cachedStmt(`task_open_${gridId != null ? 'grid' : 'all'}`, `SELECT ${TASK_COLS} FROM caseload_tasks WHERE ${where} is_completed = 0
      ORDER BY position ASC, due_date ASC NULLS LAST LIMIT ${QUERY_LIMITS.TASKS_LIST}`).all(...args) as CaseloadTask[]
    const done = cachedStmt(`task_done_${gridId != null ? 'grid' : 'all'}`, `SELECT * FROM (SELECT ${TASK_COLS} FROM caseload_tasks WHERE ${where} is_completed = 1
      ORDER BY completed_at DESC, id DESC LIMIT ${QUERY_LIMITS.TASKS_COMPLETED}) ORDER BY position ASC`).all(...args) as CaseloadTask[]
    return ok([...open, ...done])
  })

  secureWrap(IPC.TASK_GET_DUE, 'ipc-tasks', () => {
    const today = localDateString()
    // Only tasks with a due date assigned; LEFT JOIN grids so global tasks
    // still appear, but tasks tied to a deleted/inactive grid are excluded.
    const tasks = getDb().prepare(`
      SELECT ct.* FROM caseload_tasks ct
      LEFT JOIN grids g ON g.id = ct.grid_id
      WHERE ct.is_completed = 0
        AND ct.due_date IS NOT NULL
        AND (ct.snoozed_until IS NULL OR ct.snoozed_until <= ?)
        AND (ct.grid_id IS NULL OR g.is_active = 1)
      ORDER BY ct.due_date ASC
    `).all(today) as CaseloadTask[]
    return ok(tasks)
  })

  secureWrap(IPC.TASK_CREATE, 'ipc-tasks', (_e, task: Omit<CaseloadTask, 'id' | 'created_at' | 'updated_at'>) => {
    const guard = enforceWritable(); if (guard) return guard
    const priority = task.priority ?? 'normal'
    if (!ALLOWED_PRIORITIES.has(priority)) return fail(`Invalid priority: ${priority}`)
    if (typeof task.title !== 'string' || !task.title.trim() || task.title.length > 500) return fail('Invalid task title')
    if (task.recurrence_rule != null) {
      if (typeof task.recurrence_rule !== 'string' || task.recurrence_rule.length > 2000) return fail('Invalid recurrence rule')
      try {
        const parsed = JSON.parse(task.recurrence_rule) as { type?: string }
        if (!parsed.type || !VALID_RECURRENCE_TYPES.has(parsed.type)) return fail('Invalid recurrence type')
      } catch (err) { logNonFatal('ipc-tasks', 'parsing recurrence_rule JSON', err); return fail('Invalid recurrence rule JSON') }
    }
    const db = getDb()
    // A repeating task needs a date to repeat from; it starts today (audit S-12)
    const dueDate = task.due_date ?? (task.recurrence_rule ? localDateString() : null)
    const groupId = (task as Record<string, unknown>).group_id != null ? Number((task as Record<string, unknown>).group_id) : null
    const maxPos = (db.prepare('SELECT COALESCE(MAX(position), -1) as m FROM caseload_tasks WHERE group_id IS ?').get(groupId) as { m: number }).m
    const result = db.prepare(`
      INSERT INTO caseload_tasks (grid_id, group_id, title, description, priority, category, due_date, recurrence_rule, position, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(task.grid_id ?? null, groupId, task.title, task.description ?? null, priority,
           task.category ?? null, dueDate, task.recurrence_rule ?? null, maxPos + 1)
    const created = db.prepare('SELECT * FROM caseload_tasks WHERE id = ?').get(result.lastInsertRowid) as CaseloadTask
    return ok(created)
  })

  secureWrap(IPC.TASK_UPDATE, 'ipc-tasks', (_e, id: number, updates: Partial<CaseloadTask>) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(id)) return fail('Invalid ID')
    if (updates.priority != null && !ALLOWED_PRIORITIES.has(updates.priority)) return fail('Invalid priority')
    if (updates.title !== undefined && (typeof updates.title !== 'string' || !updates.title.trim() || updates.title.length > 500)) return fail('Invalid title (max 500 chars)')
    if (updates.description !== undefined && updates.description !== null && (typeof updates.description !== 'string' || updates.description.length > 100_000)) return fail('Description too long')
    if (updates.recurrence_rule !== undefined && updates.recurrence_rule !== null) {
      if (typeof updates.recurrence_rule !== 'string' || updates.recurrence_rule.length > 2000) return fail('Invalid recurrence rule')
      try { const p = JSON.parse(updates.recurrence_rule) as { type?: string }; if (!p.type || !VALID_RECURRENCE_TYPES.has(p.type)) return fail('Invalid recurrence type') } catch (err) { logNonFatal('ipc-tasks', 'parsing recurrence_rule JSON', err); return fail('Invalid recurrence rule JSON') }
    }
    const allowed = ['title', 'description', 'priority', 'category', 'due_date', 'recurrence_rule', 'snoozed_until', 'grid_id', 'group_id', 'position', 'is_completed', 'completed_at'] as const
    // A repeating task needs a due date: clearing it is refused, and turning repeat on starts it today
    const cur = getDb().prepare('SELECT due_date, recurrence_rule FROM caseload_tasks WHERE id = ?').get(id) as { due_date: string | null; recurrence_rule: string | null } | undefined
    if (cur) {
      const rule = 'recurrence_rule' in updates ? updates.recurrence_rule : cur.recurrence_rule
      const due = 'due_date' in updates ? updates.due_date : cur.due_date
      if (rule && !due) {
        if ('due_date' in updates) return fail('A repeating task needs a due date. Turn off Repeat to remove the date.')
        updates = { ...updates, due_date: localDateString() }
      }
    }
    const result = buildSafeSetClause(updates as Record<string, unknown>, allowed, ["updated_at = datetime('now')"])
    if (!result) return fail('No valid fields to update')
    getDb().prepare(`UPDATE caseload_tasks SET ${result.setClause} WHERE id = ?`).run(...result.values, id)
    return ok(true)
  })

  secureWrap(IPC.TASK_DELETE, 'ipc-tasks', (_e, id: number) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(id)) return fail('Invalid ID')
    getDb().prepare('DELETE FROM caseload_tasks WHERE id = ?').run(id)
    return ok(true)
  })

  /**
   * Tick a task off. A repeating one comes back with its next date (rolled
   * forward to today or later; the end date itself still counts). The
   * window passes the due date it saw, so a second click on the same task
   * (already moved on) is ignored instead of skipping a cycle (audit L-27).
   */
  secureWrap(IPC.TASK_COMPLETE, 'ipc-tasks', (_e, id: number, expectedDue?: string | null) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(id)) return fail('Invalid ID')
    if (expectedDue !== undefined && expectedDue !== null && typeof expectedDue !== 'string') return fail('Invalid due date')
    const db = getDb()
    const doComplete = db.transaction((): boolean => {
      const task = db.prepare('SELECT * FROM caseload_tasks WHERE id = ?').get(id) as CaseloadTask | undefined
      if (!task) throw new Error('Task not found')
      if (task.is_completed === 1) return false
      if (expectedDue !== undefined && (task.due_date ?? null) !== (expectedDue ?? null)) return false

      const now = new Date().toISOString()

      // Record completion history
      const histCount = (db.prepare('SELECT COUNT(*) as n FROM caseload_task_history WHERE task_id = ?').get(id) as { n: number }).n
      db.prepare(`
        INSERT INTO caseload_task_history (task_id, completed_at, cycle_number)
        VALUES (?, ?, ?)
      `).run(id, now, histCount + 1)

      const rule = parseRepeatRule(task.recurrence_rule)
      const next = rule ? nextRepeatDate(task.due_date, rule, localDateString()) : null
      if (next) {
        db.prepare(`
          UPDATE caseload_tasks SET is_completed = 0, completed_at = NULL,
            snoozed_until = NULL, due_date = ?, recurrence_rule = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(next, withAnchorDay(task.recurrence_rule, task.due_date), id)
      } else {
        // Doesn't repeat, or the repeats have ended
        db.prepare(`
          UPDATE caseload_tasks SET is_completed = 1, completed_at = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(now, id)
      }
      return true
    })
    return ok(doComplete())
  })

  secureWrap(IPC.TASK_SNOOZE, 'ipc-tasks', (_e, id: number, until: string) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(id)) return fail('Invalid ID')
    if (typeof until !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(until)) return fail('Invalid snooze date format')
    getDb().prepare(`UPDATE caseload_tasks SET snoozed_until = ?, updated_at = datetime('now') WHERE id = ?`).run(until, id)
    return ok(true)
  })

  secureWrap(IPC.TASK_REORDER, 'ipc-tasks', (_e, orderedIds: number[]) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!Array.isArray(orderedIds) || orderedIds.length > MAX_REORDER_TASKS) return fail('Invalid reorder payload')
    if (!orderedIds.every(id => Number.isInteger(id) && id > 0)) return fail('Invalid IDs in reorder payload')
    const db = getDb()
    const reorder = db.transaction(() => {
      const stmt = db.prepare('UPDATE caseload_tasks SET position = ? WHERE id = ?')
      for (let i = 0; i < orderedIds.length; i++) {
        stmt.run(i, orderedIds[i])
      }
    })
    reorder()
    return ok(true)
  })

  secureWrap(IPC.TASK_RESTORE, 'ipc-tasks', (_e, task: { id: number; grid_id: number | null; group_id?: number | null; title: string; description: string | null; priority: string; category: string | null; due_date: string | null; recurrence_rule: string | null; position: number; is_completed: number; completed_at: string | null; snoozed_until: string | null; created_at: string }) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!task || typeof task.id !== 'number') return fail('Invalid task format')
    if (!task.title || typeof task.title !== 'string' || task.title.length > 1000) return fail('Title missing or too long')
    if (!ALLOWED_PRIORITIES.has(task.priority)) return fail(`Invalid priority: ${task.priority}`)
    if (task.created_at) {
      const d = new Date(task.created_at)
      if (isNaN(d.getTime())) return fail('Invalid created_at date')
      const now = Date.now()
      if (d.getTime() > now + 365 * 86400000 || d.getTime() < new Date('2020-01-01').getTime()) {
        return fail('created_at out of valid range')
      }
    }
    const db = getDb()
    // Verify the ID doesn't collide with an existing record to prevent overwriting
    const existing = db.prepare('SELECT id FROM caseload_tasks WHERE id = ?').get(task.id)
    if (existing) return fail('Task with this ID already exists')
    db.prepare(`
      INSERT INTO caseload_tasks
      (id, grid_id, group_id, title, description, priority, category, due_date, recurrence_rule, position, is_completed, completed_at, snoozed_until, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(task.id, task.grid_id ?? null, task.group_id ?? null, task.title, task.description ?? null, task.priority, task.category ?? null, task.due_date ?? null, task.recurrence_rule ?? null, task.position, task.is_completed, task.completed_at ?? null, task.snoozed_until ?? null, task.created_at)
    return ok(true)
  })

  secureWrap(IPC.TASK_UNCOMPLETE, 'ipc-tasks', (_e, id: number, original: { is_completed: number; completed_at: string | null; due_date: string | null }) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(id)) return fail('Invalid ID')
    if (!original || typeof original !== 'object') return fail('Invalid original state')
    if (original.is_completed !== 0 && original.is_completed !== 1) return fail('is_completed must be 0 or 1')
    if (original.completed_at !== null && (typeof original.completed_at !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(original.completed_at))) return fail('Invalid completed_at date format')
    if (original.due_date !== null && (typeof original.due_date !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(original.due_date))) return fail('Invalid due_date date format')
    const db = getDb()
    db.transaction(() => {
      // Remove the most recent history entry created by the completion
      db.prepare(`
        DELETE FROM caseload_task_history WHERE id = (
          SELECT id FROM caseload_task_history WHERE task_id = ? ORDER BY completed_at DESC LIMIT 1
        )
      `).run(id)
      db.prepare(`
        UPDATE caseload_tasks SET is_completed = ?, completed_at = ?, due_date = ?, updated_at = datetime('now') WHERE id = ?
      `).run(original.is_completed, original.completed_at ?? null, original.due_date ?? null, id)
    })()
    return ok(true)
  })

  // ── Task Groups ─────────────────────────────────────────────────────────────
  secureWrap(IPC.TASK_GROUP_GET_ALL, 'ipc-tasks', () => {
    const groups = getDb().prepare('SELECT * FROM task_groups ORDER BY position, id').all() as TaskGroup[]
    return ok(groups)
  })

  secureWrap(IPC.TASK_GROUP_CREATE, 'ipc-tasks', (_e, name: string) => {
    const guard = enforceWritable(); if (guard) return guard
    if (typeof name !== 'string' || !name.trim() || name.length > 200) return fail('Invalid group name (max 200 chars)')
    const db = getDb()
    const maxPos = (db.prepare('SELECT COALESCE(MAX(position), -1) as m FROM task_groups').get() as { m: number }).m
    const result = db.prepare(`
      INSERT INTO task_groups (name, position, created_at) VALUES (?, ?, datetime('now'))
    `).run(name.trim(), maxPos + 1)
    const group = db.prepare('SELECT * FROM task_groups WHERE id = ?').get(result.lastInsertRowid) as TaskGroup
    return ok(group)
  })

  secureWrap(IPC.TASK_GROUP_UPDATE, 'ipc-tasks', (_e, groupId: number, updates: Partial<TaskGroup>) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(groupId)) return fail('Invalid ID')
    if (updates.name !== undefined && (typeof updates.name !== 'string' || !updates.name.trim() || updates.name.length > 200)) return fail('Invalid group name (max 200 chars)')
    const allowed = ['name', 'position', 'is_collapsed'] as const
    const result = buildSafeSetClause(updates as Record<string, unknown>, allowed)
    if (!result) return fail('No valid fields to update')
    getDb().prepare(`UPDATE task_groups SET ${result.setClause} WHERE id = ?`).run(...result.values, groupId)
    return ok(true)
  })

  secureWrap(IPC.TASK_GROUP_DELETE, 'ipc-tasks', (_e, groupId: number) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(groupId)) return fail('Invalid ID')
    const db = getDb()
    db.transaction(() => {
      db.prepare('UPDATE caseload_tasks SET group_id = NULL WHERE group_id = ?').run(groupId)
      db.prepare('DELETE FROM task_groups WHERE id = ?').run(groupId)
    })()
    return ok(true)
  })

  secureWrap(IPC.TASK_GROUP_REORDER, 'ipc-tasks', (_e, orderedGroupIds: number[]) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!Array.isArray(orderedGroupIds) || orderedGroupIds.length > 200) return fail('Invalid reorder payload')
    if (!orderedGroupIds.every(id => Number.isInteger(id) && id > 0)) return fail('Invalid IDs in reorder payload')
    const db = getDb()
    db.transaction(() => {
      const stmt = db.prepare('UPDATE task_groups SET position = ? WHERE id = ?')
      for (let i = 0; i < orderedGroupIds.length; i++) {
        stmt.run(i, orderedGroupIds[i])
      }
    })()
    return ok(true)
  })

  secureWrap(IPC.TASK_MOVE_TO_GROUP, 'ipc-tasks', (_e, taskId: number, groupId: number | null) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(taskId)) return fail('Invalid task ID')
    const db = getDb()
    if (groupId != null) {
      if (!validId(groupId)) return fail('Invalid group ID')
      const group = db.prepare('SELECT id FROM task_groups WHERE id = ?').get(groupId)
      if (!group) return fail('Task group not found')
    }
    db.prepare('UPDATE caseload_tasks SET group_id = ? WHERE id = ?').run(groupId, taskId)
    return ok(true)
  })

  secureWrap(IPC.TASK_APPLY_TEMPLATE, 'ipc-tasks', (_e, templateId: number, groupId?: number | null) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(templateId)) return fail('Invalid template ID')
    const db = getDb()
    const template = db.prepare('SELECT * FROM checklist_templates WHERE id = ?').get(templateId) as { id: number; name: string; items: string } | undefined
    if (!template) return fail('Template not found')

    let templateItems: Array<string | { title: string; category?: string; priority?: string }>
    try {
      templateItems = JSON.parse(template.items)
      if (!Array.isArray(templateItems)) return fail('Invalid template items format')
    } catch { return fail('Invalid template items format') }

    const resolvedGroupId = groupId ?? null
    const maxPos = (db.prepare('SELECT COALESCE(MAX(position), -1) as m FROM caseload_tasks WHERE group_id IS ?').get(resolvedGroupId) as { m: number }).m
    const createdIds: number[] = []

    db.transaction(() => {
      const insert = db.prepare(`
        INSERT INTO caseload_tasks (title, group_id, priority, category, position, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `)
      for (let i = 0; i < templateItems.length; i++) {
        const item = templateItems[i]!
        const title = typeof item === 'string' ? item : item.title
        const priority = typeof item === 'object' && item.priority ? item.priority : 'normal'
        const category = typeof item === 'object' && item.category ? item.category : null
        if (!title || typeof title !== 'string') continue
        const result = insert.run(title, resolvedGroupId, priority, category, maxPos + 1 + i)
        createdIds.push(Number(result.lastInsertRowid))
      }
    })()

    return ok({ createdIds })
  })

  // ── Snippets ────────────────────────────────────────────────────────────────
  secureWrap(IPC.SNIPPET_GET_ALL, 'ipc-tasks', () => {
    const db = getDb()
    // Lazy-seed pre-built snippets on first load (they're written for human services)
    const count = (db.prepare('SELECT COUNT(*) as n FROM snippets').get() as { n: number }).n
    if (count === 0 && usesHumanServicesWords()) {
      const insert = db.prepare(`
        INSERT OR IGNORE INTO snippets (trigger_text, expansion, category, created_at)
        VALUES (?, ?, ?, datetime('now'))
      `)
      const seedAll = db.transaction(() => {
        insert.run('nm',   'No answer, no machine.',                                    'Phone')
        insert.run('met',  'Met with client at residence.',                              'Visit')
        insert.run('nc',   'Client reports no changes in medical status.',               'General')
        insert.run('ref',  'Referral submitted to ',                                     'Admin')
        insert.run('fup',  'Follow-up needed regarding ',                               'Admin')
        insert.run('lm',   'Left message on voicemail on {today}.',                     'Phone')
        insert.run('att',  'Attempted to contact client on {today}.',                   'Phone')
        insert.run('fup7', 'Follow up by {today+7}.',                                   'Admin')
        insert.run('fup14','Follow up by {today+14}.',                                  'Admin')
        insert.run('fup30','Follow up by {today+30}.',                                  'Admin')
        insert.run('vc',   'Visited {client_name} at residence on {today}.',            'Visit')
        insert.run('tc',   'Telephone contact with {client_name} on {today} at {now}.', 'Phone')
      })
      seedAll()
    }
    const snippets = db.prepare('SELECT * FROM snippets ORDER BY category ASC, trigger_text ASC').all() as Snippet[]
    return ok(snippets)
  })

  secureWrap(IPC.SNIPPET_CREATE, 'ipc-tasks', (_e, trigger: string, expansion: string, category: string | null) => {
    const guard = enforceWritable(); if (guard) return guard
    if (typeof trigger !== 'string' || trigger.length === 0 || trigger.length > 50) return fail('Invalid snippet trigger (max 50 characters)')
    if (typeof expansion !== 'string' || expansion.length > 50_000) return fail('Snippet expansion too large (max 50,000 characters)')
    const db = getDb()
    const result = db.prepare(`
      INSERT INTO snippets (trigger_text, expansion, category, created_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(trigger, expansion, category ?? null)
    const snippet = db.prepare('SELECT * FROM snippets WHERE id = ?').get(result.lastInsertRowid) as Snippet
    return ok(snippet)
  })

  secureWrap(IPC.SNIPPET_UPDATE, 'ipc-tasks', (_e, id: number, updates: { trigger_text?: string; expansion?: string; category?: string | null }) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(id)) return fail('Invalid ID')
    if (updates.trigger_text !== undefined && (typeof updates.trigger_text !== 'string' || updates.trigger_text.length === 0 || updates.trigger_text.length > 50)) return fail('Invalid trigger (max 50 chars)')
    if (updates.expansion !== undefined && (typeof updates.expansion !== 'string' || updates.expansion.length > 50_000)) return fail('Expansion too large (max 50,000 chars)')
    if (updates.category !== undefined && updates.category !== null && (typeof updates.category !== 'string' || updates.category.length > 200)) return fail('Category too long (max 200 chars)')
    const allowed = ['trigger_text', 'expansion', 'category'] as const
    const result = buildSafeSetClause(updates as Record<string, unknown>, allowed)
    if (!result) return fail('No valid fields to update')
    getDb().prepare(`UPDATE snippets SET ${result.setClause} WHERE id = ?`).run(...result.values, id)
    return ok(true)
  })

  secureWrap(IPC.SNIPPET_DELETE, 'ipc-tasks', (_e, id: number) => {
    const guard = enforceWritable(); if (guard) return guard
    if (!validId(id)) return fail('Invalid ID')
    getDb().prepare('DELETE FROM snippets WHERE id = ?').run(id)
    return ok(true)
  })

}
