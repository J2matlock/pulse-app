/**
 * ipc-tasks.ts — TASK_*, SNIPPET_* IPC handlers
 */

import { z } from 'zod'
import { IPC } from '../../shared/ipc-channels'
import { QUERY_LIMITS } from '../../shared/query-limits'
import { logNonFatal, ok, fail, buildSafeSetClause, validId } from './ipc-utils'
import { handlersFor, idArg, idListArg, textArg } from './ipc-define'
import { getDb, cachedStmt } from '../database'
import type { CaseloadTask, TaskGroup, Snippet } from '../../shared/types'
import { localDateString } from '../../shared/dates'
import { usesHumanServicesWords } from '../vocab'
import { parseRepeatRule, nextRepeatDate, withAnchorDay, withoutAnchorDay } from '../../shared/recurrence'
import { toYmd } from '../../shared/ymd'
import { LIVE_GRID } from '../../shared/liveRecords'

// ── IPC payload size limits ────────────────────────────────────────────────
const MAX_REORDER_TASKS = 500
const ALLOWED_PRIORITIES = new Set(['low', 'normal', 'high', 'urgent'])
const VALID_RECURRENCE_TYPES = new Set(['daily', 'weekly', 'monthly', 'yearly'])

/**
 * A task date from the screen as a plain calendar day: null or '' clears it,
 * a real date (a time after it is dropped) is kept as YYYY-MM-DD, anything
 * else is refused. Days-until and "due today" compare these as strings.
 */
function taskDay(value: unknown): { day: string | null } | { error: string } {
  if (value === null || value === '') return { day: null }
  const day = typeof value === 'string' ? toYmd(value) : null
  return day ? { day } : { error: 'Choose a real date.' }
}

/** A deleted task put back by undo */
interface RestoredTask {
  id: number; grid_id: number | null; group_id?: number | null; title: string; description: string | null; priority: string
  category: string | null; due_date: string | null; recurrence_rule: string | null; position: number; is_completed: number
  completed_at: string | null; snoozed_until: string | null; created_at: string
}

const define = handlersFor('ipc-tasks')

export function registerTaskHandlers(): void {
  // ── Caseload Tasks ──────────────────────────────────────────────────────────
  define(IPC.TASK_GET_ALL, [idArg().nullish()], (gridId) => {
    const TASK_COLS = 'ct.id, ct.grid_id, ct.group_id, ct.title, ct.description, ct.priority, ct.category, ct.due_date, ct.recurrence_rule, ct.is_completed, ct.completed_at, ct.snoozed_until, ct.position, ct.created_at, ct.updated_at'
    // Tasks of a list in the Trash are left out, as on the Dashboard and calendar (bug sweep S2/S4)
    const FROM = `FROM caseload_tasks ct LEFT JOIN grids g ON g.id = ct.grid_id WHERE (ct.grid_id IS NULL OR ${LIVE_GRID}) AND`
    // Open tasks first, then only the most recent finished ones, so a long
    // history of finished tasks never pushes new ones off the list (audit S-14)
    const where = gridId != null ? 'ct.grid_id = ? AND' : ''
    const args = gridId != null ? [gridId] : []
    const open = cachedStmt(`task_open_v3_${gridId != null ? 'grid' : 'all'}`, `SELECT ${TASK_COLS} ${FROM} ${where} ct.is_completed = 0
      ORDER BY ct.position ASC, ct.due_date ASC NULLS LAST, ct.id ASC LIMIT ${QUERY_LIMITS.TASKS_LIST}`).all(...args) as CaseloadTask[]
    const done = cachedStmt(`task_done_v2_${gridId != null ? 'grid' : 'all'}`, `SELECT * FROM (SELECT ${TASK_COLS} ${FROM} ${where} ct.is_completed = 1
      ORDER BY ct.completed_at DESC, ct.id DESC LIMIT ${QUERY_LIMITS.TASKS_COMPLETED}) ORDER BY position ASC`).all(...args) as CaseloadTask[]
    return ok([...open, ...done])
  })

  define(IPC.TASK_GET_DUE, [], () => {
    const today = localDateString()
    // Only tasks with a due date assigned; LEFT JOIN grids so global tasks
    // still appear, but tasks tied to a deleted/inactive grid are excluded.
    const tasks = getDb().prepare(`
      SELECT ct.* FROM caseload_tasks ct
      LEFT JOIN grids g ON g.id = ct.grid_id
      WHERE ct.is_completed = 0
        AND ct.due_date IS NOT NULL
        AND (ct.snoozed_until IS NULL OR ct.snoozed_until <= ?)
        AND (ct.grid_id IS NULL OR ${LIVE_GRID})
      ORDER BY ct.due_date ASC
    `).all(today) as CaseloadTask[]
    return ok(tasks)
  })

  // The task's fields are checked in the body, in order, as before
  define(IPC.TASK_CREATE, [z.custom<Omit<CaseloadTask, 'id' | 'created_at' | 'updated_at'>>()], (task) => {
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
    const due = task.due_date === undefined ? { day: null } : taskDay(task.due_date)
    if ('error' in due) return fail(due.error)
    const db = getDb()
    // A repeating task needs a date to repeat from; it starts today (audit S-12)
    const dueDate = due.day ?? (task.recurrence_rule ? localDateString() : null)
    const groupId = (task as Record<string, unknown>).group_id != null ? Number((task as Record<string, unknown>).group_id) : null
    const maxPos = (db.prepare('SELECT COALESCE(MAX(position), -1) as m FROM caseload_tasks WHERE group_id IS ?').get(groupId) as { m: number }).m
    const result = db.prepare(`
      INSERT INTO caseload_tasks (grid_id, group_id, title, description, priority, category, due_date, recurrence_rule, position, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(task.grid_id ?? null, groupId, task.title, task.description ?? null, priority,
           task.category ?? null, dueDate, task.recurrence_rule ?? null, maxPos + 1)
    const created = db.prepare('SELECT * FROM caseload_tasks WHERE id = ?').get(result.lastInsertRowid) as CaseloadTask
    return ok(created)
  }, { write: true })

  define(IPC.TASK_UPDATE, [idArg(), z.custom<Partial<CaseloadTask>>()], (id, updates) => {
    if (updates.priority != null && !ALLOWED_PRIORITIES.has(updates.priority)) return fail('Invalid priority')
    if (updates.title !== undefined && (typeof updates.title !== 'string' || !updates.title.trim() || updates.title.length > 500)) return fail('Invalid title (max 500 chars)')
    if (updates.description !== undefined && updates.description !== null && (typeof updates.description !== 'string' || updates.description.length > 100_000)) return fail('Description too long')
    if (updates.recurrence_rule !== undefined && updates.recurrence_rule !== null) {
      if (typeof updates.recurrence_rule !== 'string' || updates.recurrence_rule.length > 2000) return fail('Invalid recurrence rule')
      try { const p = JSON.parse(updates.recurrence_rule) as { type?: string }; if (!p.type || !VALID_RECURRENCE_TYPES.has(p.type)) return fail('Invalid recurrence type') } catch (err) { logNonFatal('ipc-tasks', 'parsing recurrence_rule JSON', err); return fail('Invalid recurrence rule JSON') }
    }
    for (const key of ['due_date', 'snoozed_until'] as const) {
      if (updates[key] === undefined) continue
      const checked = taskDay(updates[key])
      if ('error' in checked) return fail(checked.error)
      updates = { ...updates, [key]: checked.day }
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
      // A due date changed by hand sets the pattern: forget the day of the month it used to fall on (AUDIT-114)
      if (rule && 'due_date' in updates && updates.due_date !== cur.due_date) {
        const kept = withoutAnchorDay(rule)
        if (kept !== rule) updates = { ...updates, recurrence_rule: kept }
      }
    }
    const result = buildSafeSetClause(updates as Record<string, unknown>, allowed, ["updated_at = datetime('now')"])
    if (!result) return fail('No valid fields to update')
    getDb().prepare(`UPDATE caseload_tasks SET ${result.setClause} WHERE id = ?`).run(...result.values, id)
    return ok(true)
  }, { write: true })

  define(IPC.TASK_DELETE, [idArg()], (id) => {
    getDb().prepare('DELETE FROM caseload_tasks WHERE id = ?').run(id)
    return ok(true)
  }, { write: true })

  /**
   * Tick a task off. A repeating one comes back with its next date (rolled
   * forward to today or later; the end date itself still counts). The
   * window passes the due date it saw, so a second click on the same task
   * (already moved on) is ignored instead of skipping a cycle (audit L-27).
   */
  define(IPC.TASK_COMPLETE, [idArg(), z.string('Invalid due date').nullish()], (id, expectedDue) => {
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
  }, { write: true })

  define(IPC.TASK_SNOOZE, [
    idArg(), z.string('Invalid snooze date format').regex(/^\d{4}-\d{2}-\d{2}/, 'Invalid snooze date format'),
  ], (id, until) => {
    getDb().prepare(`UPDATE caseload_tasks SET snoozed_until = ?, updated_at = datetime('now') WHERE id = ?`).run(until, id)
    return ok(true)
  }, { write: true })

  define(IPC.TASK_REORDER, [
    idListArg('Invalid reorder payload', 'Invalid IDs in reorder payload', { max: MAX_REORDER_TASKS }),
  ], (orderedIds) => {
    const db = getDb()
    // The list sends only the tasks it shows (not snoozed or older finished ones). As for
    // columns, tasks left out keep their slots and the sent ones fill the other slots in
    // the new order, so no two tasks share a position and a snoozed task comes back where
    // it was (Q-087). Only positions that change are written.
    const reorder = db.transaction(() => {
      const current = db.prepare('SELECT id, position FROM caseload_tasks ORDER BY position, id').all() as Array<{ id: number; position: number }>
      const positionOf = new Map(current.map(t => [t.id, t.position]))
      const sent = new Set(orderedIds)
      const queue = [...sent].filter(id => positionOf.has(id))
      const stmt = db.prepare('UPDATE caseload_tasks SET position = ? WHERE id = ?')
      current.forEach((t, i) => {
        const id = sent.has(t.id) ? queue.shift()! : t.id
        if (positionOf.get(id) !== i) stmt.run(i, id)
      })
    })
    reorder()
    return ok(true)
  }, { write: true })

  // The task is checked in the body, field by field, as before
  define(IPC.TASK_RESTORE, [z.custom<RestoredTask>()], (task) => {
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
    // Its group may have been deleted (and brought back under a new id) since:
    // put it back ungrouped rather than under a group that isn't there (bug sweep S2)
    const groupId = task.group_id != null && db.prepare('SELECT 1 FROM task_groups WHERE id = ?').get(task.group_id) ? task.group_id : null
    db.prepare(`
      INSERT INTO caseload_tasks
      (id, grid_id, group_id, title, description, priority, category, due_date, recurrence_rule, position, is_completed, completed_at, snoozed_until, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(task.id, task.grid_id ?? null, groupId, task.title, task.description ?? null, task.priority, task.category ?? null, task.due_date ?? null, task.recurrence_rule ?? null, task.position, task.is_completed, task.completed_at ?? null, task.snoozed_until ?? null, task.created_at)
    return ok(true)
  }, { write: true })

  // The saved state's fields are checked in the body, in order, as before
  define(IPC.TASK_UNCOMPLETE, [
    idArg(),
    z.custom<{ is_completed: number; completed_at: string | null; due_date: string | null; snoozed_until?: string | null }>(v => !!v && typeof v === 'object', 'Invalid original state'),
  ], (id, original) => {
    if (original.is_completed !== 0 && original.is_completed !== 1) return fail('is_completed must be 0 or 1')
    if (original.completed_at !== null && (typeof original.completed_at !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(original.completed_at))) return fail('Invalid completed_at date format')
    if (original.due_date !== null && (typeof original.due_date !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(original.due_date))) return fail('Invalid due_date date format')
    const snooze = original.snoozed_until
    if (snooze != null && (typeof snooze !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(snooze))) return fail('Invalid snoozed_until date format')
    const db = getDb()
    db.transaction(() => {
      // Remove the most recent history entry created by the completion. Undo runs newest first, and two
      // completions can share a time stamp, so the later-written row breaks the tie (Q-086)
      db.prepare(`
        DELETE FROM caseload_task_history WHERE id = (
          SELECT id FROM caseload_task_history WHERE task_id = ? ORDER BY completed_at DESC, id DESC LIMIT 1
        )
      `).run(id)
      db.prepare(`
        UPDATE caseload_tasks SET is_completed = ?, completed_at = ?, due_date = ?, updated_at = datetime('now') WHERE id = ?
      `).run(original.is_completed, original.completed_at ?? null, original.due_date ?? null, id)
      // Ticking off a snoozed repeating task clears the snooze; undo puts it back (bug sweep S2)
      if (snooze !== undefined) db.prepare('UPDATE caseload_tasks SET snoozed_until = ? WHERE id = ?').run(snooze ?? null, id)
    })()
    return ok(true)
  }, { write: true })

  // ── Task Groups ─────────────────────────────────────────────────────────────
  define(IPC.TASK_GROUP_GET_ALL, [], () => {
    const groups = getDb().prepare('SELECT * FROM task_groups ORDER BY position, id').all() as TaskGroup[]
    return ok(groups)
  })

  define(IPC.TASK_GROUP_CREATE, [textArg('Invalid group name (max 200 chars)', { max: 200, notBlank: true })], (name) => {
    const db = getDb()
    const maxPos = (db.prepare('SELECT COALESCE(MAX(position), -1) as m FROM task_groups').get() as { m: number }).m
    const result = db.prepare(`
      INSERT INTO task_groups (name, position, created_at) VALUES (?, ?, datetime('now'))
    `).run(name.trim(), maxPos + 1)
    const group = db.prepare('SELECT * FROM task_groups WHERE id = ?').get(result.lastInsertRowid) as TaskGroup
    return ok(group)
  }, { write: true })

  define(IPC.TASK_GROUP_UPDATE, [idArg(), z.custom<Partial<TaskGroup>>()], (groupId, updates) => {
    if (updates.name !== undefined && (typeof updates.name !== 'string' || !updates.name.trim() || updates.name.length > 200)) return fail('Invalid group name (max 200 chars)')
    const allowed = ['name', 'position', 'is_collapsed'] as const
    const result = buildSafeSetClause(updates as Record<string, unknown>, allowed)
    if (!result) return fail('No valid fields to update')
    getDb().prepare(`UPDATE task_groups SET ${result.setClause} WHERE id = ?`).run(...result.values, groupId)
    return ok(true)
  }, { write: true })

  define(IPC.TASK_GROUP_DELETE, [idArg()], (groupId) => {
    const db = getDb()
    db.transaction(() => {
      db.prepare('UPDATE caseload_tasks SET group_id = NULL WHERE group_id = ?').run(groupId)
      db.prepare('DELETE FROM task_groups WHERE id = ?').run(groupId)
    })()
    return ok(true)
  }, { write: true })

  define(IPC.TASK_GROUP_REORDER, [
    idListArg('Invalid reorder payload', 'Invalid IDs in reorder payload', { max: 200 }),
  ], (orderedGroupIds) => {
    const db = getDb()
    db.transaction(() => {
      const stmt = db.prepare('UPDATE task_groups SET position = ? WHERE id = ?')
      for (let i = 0; i < orderedGroupIds.length; i++) {
        stmt.run(i, orderedGroupIds[i])
      }
    })()
    return ok(true)
  }, { write: true })

  define(IPC.TASK_MOVE_TO_GROUP, [idArg('Invalid task ID'), idArg('Invalid group ID').nullish()], (taskId, groupId) => {
    const db = getDb()
    if (groupId != null) {
      const group = db.prepare('SELECT id FROM task_groups WHERE id = ?').get(groupId)
      if (!group) return fail('Task group not found')
    }
    db.prepare('UPDATE caseload_tasks SET group_id = ? WHERE id = ?').run(groupId, taskId)
    return ok(true)
  }, { write: true })

  // The group is checked in the body, after the template: a missing template answers first, as before
  define(IPC.TASK_APPLY_TEMPLATE, [idArg('Invalid template ID'), z.custom<number | null | undefined>()], (templateId, groupId) => {
    const db = getDb()
    const template = db.prepare('SELECT * FROM checklist_templates WHERE id = ?').get(templateId) as { id: number; name: string; items: string; is_recurring: number | null; recurrence_days: number | null } | undefined
    if (!template) return fail('Template not found')

    let templateItems: Array<string | { title: string; category?: string; priority?: string }>
    try {
      templateItems = JSON.parse(template.items)
      if (!Array.isArray(templateItems)) return fail('Invalid template items format')
    } catch { return fail('Invalid template items format') }
    // A group that's a string, negative or gone would be written as is (Q-056)
    if (groupId != null) {
      if (!validId(groupId)) return fail('Invalid group ID')
      if (!db.prepare('SELECT id FROM task_groups WHERE id = ?').get(groupId)) return fail('Task group not found')
    }

    const resolvedGroupId = groupId ?? null
    const maxPos = (db.prepare('SELECT COALESCE(MAX(position), -1) as m FROM caseload_tasks WHERE group_id IS ?').get(resolvedGroupId) as { m: number }).m
    const createdIds: number[] = []
    // A repeating template ("every 30 days") makes repeating tasks, as it makes
    // repeating items on a record page. A repeating task needs a due date, so they start today (bug sweep S2)
    const days = template.is_recurring && template.recurrence_days && template.recurrence_days > 0 ? Math.min(Math.round(template.recurrence_days), 999) : null
    const rule = days ? JSON.stringify({ type: 'daily', interval: days }) : null
    const due = rule ? localDateString() : null

    db.transaction(() => {
      const insert = db.prepare(`
        INSERT INTO caseload_tasks (title, group_id, priority, category, due_date, recurrence_rule, position, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `)
      for (let i = 0; i < templateItems.length; i++) {
        const item = templateItems[i]!
        const title = typeof item === 'string' ? item : item.title
        const priority = typeof item === 'object' && item.priority && ALLOWED_PRIORITIES.has(item.priority) ? item.priority : 'normal'
        const category = typeof item === 'object' && item.category ? item.category : null
        if (!title || typeof title !== 'string') continue
        const result = insert.run(title.slice(0, 500), resolvedGroupId, priority, category, due, rule, maxPos + 1 + i)
        createdIds.push(Number(result.lastInsertRowid))
      }
    })()

    return ok({ createdIds })
  }, { write: true })

  // ── Snippets ────────────────────────────────────────────────────────────────
  define(IPC.SNIPPET_GET_ALL, [], () => {
    const db = getDb()
    // Lazy-seed pre-built snippets once (they're written for human services). The flag
    // stops them coming back after someone deletes every snippet to start fresh.
    const count = (db.prepare('SELECT COUNT(*) as n FROM snippets').get() as { n: number }).n
    const seeded = db.prepare("SELECT 1 FROM app_meta WHERE key = 'snippets_seeded'").get()
    if (count > 0 && !seeded) db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('snippets_seeded', '1')").run()
    if (count === 0 && !seeded && usesHumanServicesWords()) {
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
      db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('snippets_seeded', '1')").run()
    }
    const snippets = db.prepare('SELECT * FROM snippets ORDER BY category ASC, trigger_text ASC').all() as Snippet[]
    return ok(snippets)
  })

  define(IPC.SNIPPET_CREATE, [
    textArg('Invalid snippet trigger (max 50 characters)', { min: 1, max: 50 }),
    textArg('Snippet expansion too large (max 50,000 characters)', { max: 50_000 }),
    z.string('Invalid snippet category').max(100, 'Invalid snippet category').nullish(),
  ], (trigger, expansion, category) => {
    const db = getDb()
    const result = db.prepare(`
      INSERT INTO snippets (trigger_text, expansion, category, created_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(trigger, expansion, category ?? null)
    const snippet = db.prepare('SELECT * FROM snippets WHERE id = ?').get(result.lastInsertRowid) as Snippet
    return ok(snippet)
  }, { write: true })

  define(IPC.SNIPPET_UPDATE, [idArg(), z.custom<{ trigger_text?: string; expansion?: string; category?: string | null }>()], (id, updates) => {
    if (updates.trigger_text !== undefined && (typeof updates.trigger_text !== 'string' || updates.trigger_text.length === 0 || updates.trigger_text.length > 50)) return fail('Invalid trigger (max 50 chars)')
    if (updates.expansion !== undefined && (typeof updates.expansion !== 'string' || updates.expansion.length > 50_000)) return fail('Expansion too large (max 50,000 chars)')
    if (updates.category !== undefined && updates.category !== null && (typeof updates.category !== 'string' || updates.category.length > 200)) return fail('Category too long (max 200 chars)')
    const allowed = ['trigger_text', 'expansion', 'category'] as const
    const result = buildSafeSetClause(updates as Record<string, unknown>, allowed)
    if (!result) return fail('No valid fields to update')
    getDb().prepare(`UPDATE snippets SET ${result.setClause} WHERE id = ?`).run(...result.values, id)
    return ok(true)
  }, { write: true })

  define(IPC.SNIPPET_DELETE, [idArg()], (id) => {
    getDb().prepare('DELETE FROM snippets WHERE id = ?').run(id)
    return ok(true)
  }, { write: true })

}
