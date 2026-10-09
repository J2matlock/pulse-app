/** Adding a checklist template's items to a record (CHECKLIST_APPLY_TEMPLATE, stage on-enter actions). */
import { getDb } from './database'

export class ChecklistApplyError extends Error {}

/** Returns the new checklist item ids. */
export function applyChecklistTemplate(rowId: number, templateId: number, groupId: number | null = null): number[] {
  const db = getDb()
  const template = db.prepare('SELECT items FROM checklist_templates WHERE id = ?').get(templateId) as { items: string } | undefined
  if (!template) throw new ChecklistApplyError('Template not found')
  let items: Array<string | { title: string; priority?: string }>
  try {
    const parsed = JSON.parse(template.items) as unknown
    if (!Array.isArray(parsed)) throw new ChecklistApplyError('Invalid template items format')
    items = parsed as typeof items
  } catch (err) {
    if (err instanceof ChecklistApplyError) throw err
    throw new ChecklistApplyError('Invalid template items format')
  }
  const maxPos = (db.prepare('SELECT MAX(position) as p FROM checklist_items WHERE row_id = ?').get(rowId) as { p: number | null }).p ?? -1
  const insert = db.prepare(`
    INSERT INTO checklist_items (row_id, title, category, priority, position, group_id, template_source_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `)
  return db.transaction(() => items.map((ti, i) => {
    const title = typeof ti === 'string' ? ti : ti.title
    const priority = typeof ti === 'string' ? 'normal' : (ti.priority ?? 'normal')
    return Number(insert.run(rowId, title, null, priority, maxPos + 1 + i, groupId, templateId).lastInsertRowid)
  }))()
}
