/**
 * Stages (generalization W06): which column is a list's stage, and its
 * settings. Marking a column as the stage turns on change logging for it,
 * since time in each stage comes from its change history.
 */
import { getDb } from './database'
import { setCellWithHistory } from './cell-write'
import { applyChecklistTemplate } from './checklist-apply'
import { columnAffectsDisplayName, refreshDisplayNames } from './display-names'
import { canBeStage, columnOptionLabels, stageConfigOf, stageConfigSchema, type StageConfig, type StageDurations, type StageMoveResult, type StageSummary } from '../shared/stages'
import { parseDbTimestamp } from '../shared/dates'
import { localDateString } from '../shared/dates'

export class StageError extends Error {}

interface ColumnRow { id: number; grid_id: number; name: string; column_type: string; config: string | null }

function parseConfig(raw: string | null): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || '{}') as unknown
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
  } catch { return {} }
}

/**
 * Make a column the list's stage (or stop, with `null`). The stage order
 * becomes the column's option order. Returns the ids of every column whose
 * settings changed (another column stops being the stage).
 */
export function saveStageConfig(columnId: number, input: unknown): number[] {
  const db = getDb()
  return db.transaction((): number[] => {
    const col = db.prepare('SELECT id, grid_id, name, column_type, config FROM columns WHERE id = ?').get(columnId) as ColumnRow | undefined
    if (!col) throw new StageError('That column no longer exists.')
    if (!canBeStage(col.column_type)) throw new StageError('Only a status or dropdown column can be the stage.')
    const save = db.prepare('UPDATE columns SET config = ? WHERE id = ?')
    const cfg = parseConfig(col.config)

    if (input === null) {
      delete cfg.stage
      save.run(JSON.stringify(cfg), col.id)
      return [col.id]
    }

    const parsed = stageConfigSchema.safeParse(input)
    if (!parsed.success) throw new StageError('Some of the stage settings are missing or not allowed.')
    const config: StageConfig = parsed.data
    const values = config.options.map(o => o.value)
    const labels = columnOptionLabels(col)
    if (new Set(values).size !== values.length) throw new StageError('Each stage can be listed only once.')
    if (values.length !== labels.length || values.some(v => !labels.includes(v))) {
      throw new StageError(`The stages must be the options of "${col.name}". Change the options first, then come back.`)
    }

    for (const o of config.options) {
      const e = o.onEnter
      if (!e) continue
      if (e.checklistTemplateId !== undefined && !db.prepare('SELECT 1 FROM checklist_templates WHERE id = ?').get(e.checklistTemplateId)) {
        throw new StageError(`The checklist for "${o.value}" no longer exists.`)
      }
      if (e.stampColumnId !== undefined && !db.prepare("SELECT 1 FROM columns WHERE id = ? AND grid_id = ? AND column_type = 'date'").get(e.stampColumnId, col.grid_id)) {
        throw new StageError(`The date to fill in for "${o.value}" must be a date column of this list.`)
      }
      if (e.activityTypeKey !== undefined && !db.prepare('SELECT 1 FROM activity_types WHERE key = ?').get(e.activityTypeKey)) {
        throw new StageError(`The kind of note for "${o.value}" no longer exists.`)
      }
    }

    // The board's column order is the option order, so keep them the same
    const options = Array.isArray(cfg.options) ? cfg.options as Array<string | { label?: string }> : []
    cfg.options = col.column_type === 'status'
      ? values.map(v => options.find(o => typeof o === 'object' && o?.label === v) ?? { label: v, color: '#64748b' })
      : values

    // One stage per list
    const changed = [col.id]
    for (const other of db.prepare('SELECT id, grid_id, name, column_type, config FROM columns WHERE grid_id = ? AND id != ?').all(col.grid_id, col.id) as ColumnRow[]) {
      const oc = parseConfig(other.config)
      if (!('stage' in oc)) continue
      delete oc.stage
      save.run(JSON.stringify(oc), other.id)
      changed.push(other.id)
    }

    cfg.stage = config
    cfg.log_changes = true
    save.run(JSON.stringify(cfg), col.id)
    return changed
  })()
}

/**
 * Move a record to a stage (W06 §4): the stage column's change (with its
 * history and note), then the stage's on-enter actions, in one transaction.
 * `null` takes it out of every stage.
 */
export function moveStage(rowId: number, columnId: number, value: string | null): StageMoveResult {
  const db = getDb()
  const col = db.prepare('SELECT c.id, c.grid_id, c.name, c.column_type, c.config, r.grid_id AS row_grid FROM columns c JOIN rows r ON r.id = ? WHERE c.id = ? AND r.deleted_at IS NULL')
    .get(rowId, columnId) as (ColumnRow & { row_grid: number }) | undefined
  if (!col || col.row_grid !== col.grid_id) throw new StageError('That record or column no longer exists.')
  const stage = stageConfigOf(col)
  if (!stage) throw new StageError(`"${col.name}" isn't the stage.`)
  const option = value === null ? null : stage.options.find(o => o.value === value)
  if (value !== null && !option) throw new StageError(`"${value}" isn't one of the stages.`)

  return db.transaction((): StageMoveResult => {
    const result: StageMoveResult = { previous: null, changed: false, sysLogIds: [], checklistItemIds: [], stamped: null }
    result.previous = setCellWithHistory(rowId, columnId, value)
    if (result.previous === value) return result
    result.changed = true
    db.prepare("UPDATE rows SET updated_at = datetime('now') WHERE id = ?").run(rowId)
    const note = db.prepare("INSERT INTO case_log (row_id, content, log_type, created_at, updated_at) VALUES (?, ?, ?, datetime('now'), datetime('now'))")
    // The stage column always logs its changes
    result.sysLogIds.push(Number(note.run(rowId, value === null ? `${col.name} cleared` : `${col.name} changed to "${value}"`, 'system').lastInsertRowid))
    if (columnAffectsDisplayName(col.grid_id, columnId)) refreshDisplayNames(col.grid_id, [rowId])

    const enter = option?.onEnter
    if (enter?.checklistTemplateId !== undefined && db.prepare('SELECT 1 FROM checklist_templates WHERE id = ?').get(enter.checklistTemplateId)) {
      result.checklistItemIds = applyChecklistTemplate(rowId, enter.checklistTemplateId)
    }
    if (enter?.stampColumnId !== undefined && db.prepare("SELECT 1 FROM columns WHERE id = ? AND grid_id = ? AND column_type = 'date'").get(enter.stampColumnId, col.grid_id)) {
      result.stamped = { columnId: enter.stampColumnId, previous: setCellWithHistory(rowId, enter.stampColumnId, localDateString()) }
      if (columnAffectsDisplayName(col.grid_id, enter.stampColumnId)) refreshDisplayNames(col.grid_id, [rowId])
    }
    if (enter?.activityTypeKey !== undefined && db.prepare('SELECT 1 FROM activity_types WHERE key = ?').get(enter.activityTypeKey)) {
      result.sysLogIds.push(Number(note.run(rowId, `Moved to ${value}`, enter.activityTypeKey).lastInsertRowid))
    }
    return result
  })()
}

const DAY_MS = 86_400_000
const daysBetween = (from: string, to: Date): number => Math.max(0, Math.floor((to.getTime() - parseDbTimestamp(from).getTime()) / DAY_MS))

/**
 * Time in each stage (W06 §5), walking the stage column's change history.
 * Edits in the table count the same as board moves. Before any history
 * exists (a column made the stage later), times count from when the record
 * was added and are marked approximate.
 */
export function stageDurations(gridId: number, columnId: number, rowIds?: number[], now = new Date()): Record<number, StageDurations> {
  const db = getDb()
  const ids = rowIds?.length ? rowIds.slice(0, 5000) : null
  const rows = db.prepare(`
    SELECT r.id, r.created_at, c.value FROM rows r LEFT JOIN cells c ON c.row_id = r.id AND c.column_id = ?
    WHERE r.grid_id = ? AND r.deleted_at IS NULL ${ids ? `AND r.id IN (${ids.map(() => '?').join(',')})` : ''}`)
    .all(columnId, gridId, ...(ids ?? [])) as Array<{ id: number; created_at: string; value: string | null }>
  const history = new Map<number, Array<{ old_value: string | null; new_value: string | null; changed_at: string }>>()
  const hist = db.prepare(`
    SELECT h.row_id, h.old_value, h.new_value, h.changed_at FROM cell_history h JOIN rows r ON r.id = h.row_id
    WHERE h.column_id = ? AND r.grid_id = ? ${ids ? `AND h.row_id IN (${ids.map(() => '?').join(',')})` : ''}
    ORDER BY h.row_id, h.changed_at, h.id`).all(columnId, gridId, ...(ids ?? [])) as Array<{ row_id: number; old_value: string | null; new_value: string | null; changed_at: string }>
  for (const h of hist) {
    const list = history.get(h.row_id) ?? []
    list.push(h)
    history.set(h.row_id, list)
  }
  const out: Record<number, StageDurations> = {}
  for (const r of rows) {
    const changes = (history.get(r.id) ?? []).filter(h => h.old_value !== h.new_value)
    const stays: StageDurations['stays'] = []
    if (changes.length === 0) {
      out[r.id] = { current: { stage: r.value, since: r.created_at, days: daysBetween(r.created_at, now), approximate: true }, stays }
      continue
    }
    // Before the first recorded change it held the old value, since it was added (as far as we know)
    const first = changes[0]!
    if (first.old_value !== null) {
      stays.push({ stage: first.old_value, from: r.created_at, to: first.changed_at, days: daysBetween(r.created_at, parseDbTimestamp(first.changed_at)), approximate: true })
    }
    changes.forEach((h, i) => {
      const next = changes[i + 1]
      if (next) stays.push({ stage: h.new_value, from: h.changed_at, to: next.changed_at, days: daysBetween(h.changed_at, parseDbTimestamp(next.changed_at)), approximate: false })
    })
    const last = changes[changes.length - 1]!
    out[r.id] = { current: { stage: r.value, since: last.changed_at, days: daysBetween(last.changed_at, now), approximate: false }, stays }
  }
  return out
}

/**
 * For the dashboard (W06 §6): per list with a stage, how many active
 * records are in each stage, the average finished stay per stage, and the
 * open record that has waited longest.
 */
export function stageSummary(now = new Date()): StageSummary[] {
  const db = getDb()
  const cols = db.prepare(`SELECT c.id, c.grid_id, c.name, c.column_type, c.config, g.name AS grid_name FROM columns c JOIN grids g ON g.id = c.grid_id
    WHERE g.is_active = 1 AND c.column_type IN ('status', 'dropdown') ORDER BY g.position, g.id`).all() as Array<ColumnRow & { grid_name: string }>
  const out: StageSummary[] = []
  for (const col of cols) {
    const stage = stageConfigOf(col)
    if (!stage) continue
    const rows = db.prepare(`SELECT r.id, COALESCE(NULLIF(r.display_name, ''), '(unnamed)') AS name, c.value FROM rows r
      LEFT JOIN cells c ON c.row_id = r.id AND c.column_id = ? WHERE r.grid_id = ? AND r.is_active = 1 AND r.deleted_at IS NULL`)
      .all(col.id, col.grid_id) as Array<{ id: number; name: string; value: string | null }>
    const durations = stageDurations(col.grid_id, col.id, undefined, now)
    const counts = new Map<string, number>()
    let noStage = 0
    for (const r of rows) {
      if (r.value && stage.options.some(o => o.value === r.value)) counts.set(r.value, (counts.get(r.value) ?? 0) + 1)
      else noStage++
    }
    const stays = new Map<string, number[]>()
    for (const d of Object.values(durations)) for (const s of d.stays) if (s.stage && !s.approximate) stays.set(s.stage, [...(stays.get(s.stage) ?? []), s.days])
    const done = new Set(stage.options.filter(o => o.done).map(o => o.value))
    // A status column's own colors stand in where a stage has none
    const statusColors = new Map((((parseConfig(col.config).options ?? []) as Array<{ label?: string; color?: string }>)).filter(o => o && typeof o === 'object').map(o => [o.label, o.color]))
    let oldest: StageSummary['oldest'] = null
    for (const r of rows) {
      if (!r.value || done.has(r.value) || !counts.has(r.value)) continue
      const d = durations[r.id]?.current
      if (d && (!oldest || d.days > oldest.days)) oldest = { rowId: r.id, name: r.name, stage: r.value, days: d.days, approximate: d.approximate }
    }
    out.push({
      gridId: col.grid_id, gridName: col.grid_name, columnId: col.id, columnName: col.name, noStage, oldest,
      stages: stage.options.map(o => {
        const s = stays.get(o.value)
        const color = o.color ?? statusColors.get(o.value)
        return { value: o.value, ...(color ? { color } : {}), done: !!o.done, count: counts.get(o.value) ?? 0,
          avgDays: s?.length ? Math.round(s.reduce((a, b) => a + b, 0) / s.length * 10) / 10 : null }
      }),
    })
  }
  return out
}
