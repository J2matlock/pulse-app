/**
 * Stages in starters and shared files (W06 §8). A stage's on-enter actions
 * point at a checklist and a date column by id, which means nothing in
 * another database; in files they point by name and are resolved on apply.
 */
import type { Database } from 'better-sqlite3'
import { saveStageConfig, StageError } from './stages'
import type { PortableStage, StageConfig } from '../shared/stages'

/** A stage's settings for a file, by name */
export function portableStage(cfg: StageConfig, db: Database, gridId: number): PortableStage {
  const checklist = db.prepare('SELECT name FROM checklist_templates WHERE id = ?')
  const column = db.prepare('SELECT name FROM columns WHERE id = ? AND grid_id = ?')
  return {
    options: cfg.options.map(o => {
      const e = o.onEnter
      const onEnter = e ? Object.fromEntries(Object.entries({
        checklist: e.checklistTemplateId !== undefined ? (checklist.get(e.checklistTemplateId) as { name: string } | undefined)?.name : undefined,
        stampColumn: e.stampColumnId !== undefined ? (column.get(e.stampColumnId, gridId) as { name: string } | undefined)?.name : undefined,
        activityType: e.activityTypeKey,
      }).filter(([, v]) => v !== undefined)) : undefined
      return { value: o.value, ...(o.color ? { color: o.color } : {}), ...(o.done ? { done: true } : {}), ...(onEnter && Object.keys(onEnter).length ? { onEnter } : {}) }
    }),
    ...(cfg.hideDoneAfterDays !== undefined ? { hideDoneAfterDays: cfg.hideDoneAfterDays } : {}),
  }
}

/**
 * Make a column of this list the stage from a file's settings. Actions whose
 * checklist, column or note type can't be found are left out; returns
 * warnings for those and for a stage that couldn't be set up at all.
 */
export function applyPortableStage(db: Database, gridId: number, listName: string, columnName: string, stage: PortableStage): string[] {
  const warnings: string[] = []
  const col = db.prepare('SELECT id FROM columns WHERE grid_id = ? AND LOWER(TRIM(name)) = LOWER(TRIM(?))').get(gridId, columnName) as { id: number } | undefined
  if (!col) return [`The stage column "${columnName}" isn't in ${listName}, so it has no stage.`]
  const checklist = db.prepare('SELECT id FROM checklist_templates WHERE name = ? ORDER BY is_system, id LIMIT 1')
  const dateCol = db.prepare("SELECT id FROM columns WHERE grid_id = ? AND column_type = 'date' AND LOWER(TRIM(name)) = LOWER(TRIM(?))")
  const noteType = db.prepare('SELECT 1 FROM activity_types WHERE key = ?')
  const config: StageConfig = {
    options: stage.options.map(o => {
      const e = o.onEnter
      const checklistTemplateId = e?.checklist ? (checklist.get(e.checklist) as { id: number } | undefined)?.id : undefined
      const stampColumnId = e?.stampColumn ? (dateCol.get(gridId, e.stampColumn) as { id: number } | undefined)?.id : undefined
      const activityTypeKey = e?.activityType && noteType.get(e.activityType) ? e.activityType : undefined
      if (e?.checklist && checklistTemplateId === undefined) warnings.push(`The checklist "${e.checklist}" for "${o.value}" in ${listName} wasn't found, so it isn't added on entering.`)
      if (e?.stampColumn && stampColumnId === undefined) warnings.push(`The date "${e.stampColumn}" for "${o.value}" in ${listName} wasn't found, so it isn't filled in on entering.`)
      const onEnter = Object.fromEntries(Object.entries({ checklistTemplateId, stampColumnId, activityTypeKey }).filter(([, v]) => v !== undefined))
      const color = o.color && /^(#[0-9a-fA-F]{6}|slate|blue|green|purple|orange|teal|amber|red)$/.test(o.color) ? o.color : undefined
      return { value: o.value, ...(color ? { color: color as StageConfig['options'][number]['color'] } : {}), ...(o.done ? { done: true } : {}), ...(Object.keys(onEnter).length ? { onEnter } : {}) }
    }),
    ...(stage.hideDoneAfterDays !== undefined ? { hideDoneAfterDays: stage.hideDoneAfterDays } : {}),
  }
  try {
    saveStageConfig(col.id, config)
  } catch (err) {
    if (!(err instanceof StageError)) throw err
    warnings.push(`${listName} has no stage: ${err.message}`)
  }
  return warnings
}
