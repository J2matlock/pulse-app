/** Stages (W06 commit 1): which column is the stage, its settings, and logging turned on. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'

let t: TestDb
vi.mock('../src/main/database', () => ({ getDb: () => t.db, cachedStmt: (_k: string, sql: string) => t.db.prepare(sql) }))

import { saveStageConfig, StageError, moveStage, undoStageMove, stageDurations, stageSummary } from '../src/main/stages'
import { localDateString } from '../src/shared/dates'
import { stageConfigOf, stageColumnOf, columnOptionLabels } from '../src/shared/stages'

let grid: { gridId: number; columnIds: number[] }
let status: number, other: number, dateCol: number
const config = (id: number) => JSON.parse((t.db.prepare('SELECT config FROM columns WHERE id = ?').get(id) as { config: string }).config) as Record<string, unknown>
const col = (id: number) => t.db.prepare('SELECT column_type, config FROM columns WHERE id = ?').get(id) as { column_type: string; config: string | null }
const statusOptions = [{ label: 'Estimate', color: '#3b82f6' }, { label: 'In progress', color: '#eab308' }, { label: 'Done', color: '#22c55e' }]

beforeEach(() => {
  t = createTestDb()
  grid = seedGrid(t.db, { name: 'Jobs', rowCount: 1, columnCount: 4 })
  ;[, status, other, dateCol] = grid.columnIds as [number, number, number, number]
  t.db.prepare("UPDATE columns SET name = 'Status', column_type = 'status', config = ? WHERE id = ?").run(JSON.stringify({ options: statusOptions }), status)
  t.db.prepare("UPDATE columns SET name = 'Priority', column_type = 'dropdown', config = ? WHERE id = ?").run(JSON.stringify({ options: ['Low', 'High'] }), other)
  t.db.prepare("UPDATE columns SET name = 'Picked up', column_type = 'date' WHERE id = ?").run(dateCol)
})
afterEach(() => cleanupTestDb(t))

const stage = (options: Array<Record<string, unknown>>) => ({ options, hideDoneAfterDays: 7 })

describe('making a column the stage', () => {
  it('saves the settings, turns on change logging and puts the options in stage order', () => {
    const cl = Number(t.db.prepare("INSERT INTO checklist_templates (name, items) VALUES ('Intake', '[]')").run().lastInsertRowid)
    saveStageConfig(status, stage([
      { value: 'In progress', color: 'amber', onEnter: { checklistTemplateId: cl, stampColumnId: dateCol, activityTypeKey: 'note' } },
      { value: 'Estimate' }, { value: 'Done', done: true },
    ]))
    const cfg = config(status)
    expect(cfg.log_changes).toBe(true)
    expect(columnOptionLabels(col(status))).toEqual(['In progress', 'Estimate', 'Done'])
    expect((cfg.options as Array<{ color: string }>)[0]!.color).toBe('#eab308')
    expect(stageConfigOf(col(status))).toMatchObject({ hideDoneAfterDays: 7, options: [{ value: 'In progress', onEnter: { stampColumnId: dateCol } }, { value: 'Estimate' }, { value: 'Done', done: true }] })
  })

  it('allows one stage per list', () => {
    saveStageConfig(status, stage([{ value: 'Estimate' }, { value: 'In progress' }, { value: 'Done' }]))
    expect(saveStageConfig(other, stage([{ value: 'High' }, { value: 'Low' }])).sort()).toEqual([status, other].sort())
    expect(stageConfigOf(col(status))).toBeNull()
    expect(columnOptionLabels(col(other))).toEqual(['High', 'Low'])
    const cols = t.db.prepare('SELECT id, column_type, config FROM columns WHERE grid_id = ?').all(grid.gridId) as Array<{ id: number; column_type: string; config: string | null }>
    expect(stageColumnOf(cols)?.id).toBe(other)
  })

  it('refuses stages that are not the column\'s options, unknown actions and other column types', () => {
    expect(() => saveStageConfig(status, stage([{ value: 'Estimate' }, { value: 'Done' }]))).toThrow(/must be the options of "Status"/)
    expect(() => saveStageConfig(status, stage([{ value: 'Estimate' }, { value: 'Estimate' }, { value: 'Done' }]))).toThrow(/only once/)
    expect(() => saveStageConfig(status, stage([{ value: 'Estimate', onEnter: { stampColumnId: other } }, { value: 'In progress' }, { value: 'Done' }]))).toThrow(/date column of this list/)
    expect(() => saveStageConfig(status, stage([{ value: 'Estimate', onEnter: { activityTypeKey: 'nope' } }, { value: 'In progress' }, { value: 'Done' }]))).toThrow(/kind of note/)
    expect(() => saveStageConfig(dateCol, stage([{ value: 'x' }]))).toThrow(StageError)
    expect(() => saveStageConfig(status, { options: [] })).toThrow(/missing or not allowed/)
  })

  it('stops being the stage, keeping the logging', () => {
    saveStageConfig(status, stage([{ value: 'Estimate' }, { value: 'In progress' }, { value: 'Done' }]))
    saveStageConfig(status, null)
    expect(config(status)).toMatchObject({ log_changes: true })
    expect(stageConfigOf(col(status))).toBeNull()
  })
})

describe('stages and Deadline columns', () => {
  it('fill in today on a date column that became a Deadline column', () => {
    t.db.prepare("UPDATE columns SET column_type = 'deadline' WHERE id = ?").run(dateCol)
    saveStageConfig(status, stage([{ value: 'Estimate' }, { value: 'In progress', onEnter: { stampColumnId: dateCol } }, { value: 'Done', done: true }]))
    const rowId = (t.db.prepare('SELECT id FROM rows WHERE grid_id = ?').get(grid.gridId) as { id: number }).id
    expect(moveStage(rowId, status, 'In progress').stamped).toMatchObject({ columnId: dateCol })
    expect((t.db.prepare('SELECT value FROM cells WHERE row_id = ? AND column_id = ?').get(rowId, dateCol) as { value: string }).value).toBe(localDateString())
  })
})

describe('moving a record to a stage', () => {
  let rowId: number, cl: number
  beforeEach(() => {
    rowId = (t.db.prepare('SELECT id FROM rows WHERE grid_id = ?').get(grid.gridId) as { id: number }).id
    cl = Number(t.db.prepare("INSERT INTO checklist_templates (name, items) VALUES ('Pickup', '[\"Call customer\", {\"title\": \"Invoice\"}]')").run().lastInsertRowid)
    saveStageConfig(status, stage([{ value: 'Estimate' }, { value: 'In progress' },
      { value: 'Done', done: true, onEnter: { checklistTemplateId: cl, stampColumnId: dateCol, activityTypeKey: 'note', restamp: true } }]))
    t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(rowId, dateCol, '2026-01-02')
  })
  const notes = () => (t.db.prepare('SELECT content, log_type FROM case_log WHERE row_id = ? ORDER BY id').all(rowId) as Array<{ content: string; log_type: string }>)
  const cell = (c: number) => (t.db.prepare('SELECT value FROM cells WHERE row_id = ? AND column_id = ?').get(rowId, c) as { value: string | null } | undefined)?.value ?? null

  it('changes the stage with its history and a note', () => {
    const r = moveStage(rowId, status, 'In progress')
    expect(r).toMatchObject({ previous: null, changed: true, checklistItemIds: [], stamped: null })
    expect(cell(status)).toBe('In progress')
    expect(notes()).toEqual([{ content: 'Status changed to "In progress"', log_type: 'system' }])
    expect(t.db.prepare('SELECT old_value, new_value FROM cell_history WHERE row_id = ? AND column_id = ?').all(rowId, status)).toEqual([{ old_value: null, new_value: 'In progress' }])
    expect(moveStage(rowId, status, 'In progress').changed).toBe(false)
  })

  it('runs the stage\'s on-enter actions', () => {
    moveStage(rowId, status, 'In progress')
    const r = moveStage(rowId, status, 'Done')
    expect(r.previous).toBe('In progress')
    expect(r.checklistItemIds).toHaveLength(2)
    expect(t.db.prepare('SELECT title FROM checklist_items WHERE row_id = ? ORDER BY position').all(rowId)).toEqual([{ title: 'Call customer' }, { title: 'Invoice' }])
    expect(r.stamped).toEqual({ columnId: dateCol, previous: '2026-01-02' })
    expect(cell(dateCol)).toBe(localDateString())
    expect(notes().slice(1)).toEqual([{ content: 'Status changed to "Done"', log_type: 'system' }, { content: 'Moved to Done', log_type: 'note' }])
    expect(r.sysLogIds).toHaveLength(2)
  })

  it('coming back to a stage keeps open checklist items and, by default, a filled-in date (audit S-15)', () => {
    saveStageConfig(status, stage([{ value: 'Estimate' }, { value: 'In progress' },
      { value: 'Done', done: true, onEnter: { checklistTemplateId: cl, stampColumnId: dateCol } }]))
    moveStage(rowId, status, 'Done')
    expect(cell(dateCol)).toBe('2026-01-02')
    t.db.prepare("UPDATE checklist_items SET is_completed = 1 WHERE row_id = ? AND title = 'Invoice'").run(rowId)
    moveStage(rowId, status, 'In progress')
    const again = moveStage(rowId, status, 'Done')
    expect(again.stamped).toBeNull()
    expect(t.db.prepare('SELECT title, is_completed FROM checklist_items WHERE row_id = ? ORDER BY id').all(rowId))
      .toEqual([{ title: 'Call customer', is_completed: 0 }, { title: 'Invoice', is_completed: 1 }, { title: 'Invoice', is_completed: 0 }])
    // An empty date is still filled in
    t.db.prepare('UPDATE cells SET value = NULL WHERE row_id = ? AND column_id = ?').run(rowId, dateCol)
    moveStage(rowId, status, 'Estimate')
    expect(moveStage(rowId, status, 'Done').stamped).toEqual({ columnId: dateCol, previous: null })
    expect(cell(dateCol)).toBe(localDateString())
  })

  it('undo puts everything back without a new change, so time in stage is kept (audit S-16)', () => {
    moveStage(rowId, status, 'In progress')
    t.db.prepare("UPDATE cell_history SET changed_at = '2026-09-01 09:00:00' WHERE row_id = ?").run(rowId)
    const before = stageDurations(grid.gridId, status)[rowId]!.current
    const historyBefore = t.db.prepare('SELECT COUNT(*) AS n FROM cell_history WHERE row_id = ?').get(rowId)
    const notesBefore = notes()
    const r = moveStage(rowId, status, 'Done')
    expect(r.historyIds).toHaveLength(2)
    undoStageMove(rowId, status, r)
    expect(cell(status)).toBe('In progress')
    expect(cell(dateCol)).toBe('2026-01-02')
    expect(notes()).toEqual(notesBefore)
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM cell_history WHERE row_id = ?').get(rowId)).toEqual(historyBefore)
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM checklist_items WHERE row_id = ?').get(rowId)).toEqual({ n: 0 })
    expect(stageDurations(grid.gridId, status)[rowId]!.current).toEqual(before)
    expect(before.since).toBe('2026-09-01 09:00:00')
  })

  it('refuses values that are not stages, and columns that are not the stage', () => {
    expect(() => moveStage(rowId, status, 'Lost')).toThrow(/isn't one of the stages/)
    expect(() => moveStage(rowId, other, 'High')).toThrow(/isn't the stage/)
    expect(moveStage(rowId, status, null).changed).toBe(false)
    moveStage(rowId, status, 'Estimate')
    expect(moveStage(rowId, status, null)).toMatchObject({ changed: true, previous: 'Estimate' })
  })
})

describe('time in stage', () => {
  let rowId: number
  const now = new Date('2026-10-02T12:00:00Z')
  const change = (from: string | null, to: string | null, at: string) => {
    t.db.prepare("INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?) ON CONFLICT(row_id, column_id) DO UPDATE SET value = excluded.value").run(rowId, status, to)
    const cellId = (t.db.prepare('SELECT id FROM cells WHERE row_id = ? AND column_id = ?').get(rowId, status) as { id: number }).id
    t.db.prepare('INSERT INTO cell_history (cell_id, row_id, column_id, old_value, new_value, changed_at) VALUES (?, ?, ?, ?, ?, ?)').run(cellId, rowId, status, from, to, at)
  }
  beforeEach(() => {
    rowId = (t.db.prepare('SELECT id FROM rows WHERE grid_id = ?').get(grid.gridId) as { id: number }).id
    t.db.prepare("UPDATE rows SET created_at = '2026-09-01 09:00:00' WHERE id = ?").run(rowId)
  })

  it('counts from when the record was added when there is no history yet', () => {
    t.db.prepare('INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(rowId, status, 'Estimate')
    expect(stageDurations(grid.gridId, status, undefined, now)[rowId]).toEqual({
      current: { stage: 'Estimate', since: '2026-09-01 09:00:00', days: 31, approximate: true }, stays: [],
    })
  })

  it('walks the history, back and forth, including the value before the first change', () => {
    change('Estimate', 'In progress', '2026-09-10 09:00:00')
    change('In progress', 'Estimate', '2026-09-12 09:00:00')
    change('Estimate', 'Estimate', '2026-09-13 09:00:00')
    change('Estimate', 'Done', '2026-09-20 09:00:00')
    const d = stageDurations(grid.gridId, status, [rowId], now)[rowId]!
    expect(d.current).toEqual({ stage: 'Done', since: '2026-09-20 09:00:00', days: 12, approximate: false })
    expect(d.stays.map(s => [s.stage, s.days, s.approximate])).toEqual([['Estimate', 9, true], ['In progress', 2, false], ['Estimate', 8, false]])
  })

  it('counts moves made through moveStage the same way', () => {
    saveStageConfig(status, stage([{ value: 'Estimate' }, { value: 'In progress' }, { value: 'Done' }]))
    moveStage(rowId, status, 'In progress')
    const d = stageDurations(grid.gridId, status)[rowId]!
    expect(d.current).toMatchObject({ stage: 'In progress', days: 0, approximate: false })
  })
})

describe('the dashboard summary', () => {
  it('counts each stage, averages finished stays, and finds who has waited longest', () => {
    saveStageConfig(status, stage([{ value: 'Estimate' }, { value: 'In progress' }, { value: 'Done', done: true }]))
    const ids = (t.db.prepare('SELECT id FROM rows WHERE grid_id = ?').all(grid.gridId) as Array<{ id: number }>).map(r => r.id)
    const extra = [1, 2, 3].map(i => Number(t.db.prepare("INSERT INTO rows (grid_id, position, display_name, created_at) VALUES (?, ?, ?, '2026-09-01 09:00:00')").run(grid.gridId, 10 + i, `J-00${i}`).lastInsertRowid))
    const hist = (rowId: number, from: string | null, to: string, at: string) => {
      t.db.prepare("INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?) ON CONFLICT(row_id, column_id) DO UPDATE SET value = excluded.value").run(rowId, status, to)
      const cellId = (t.db.prepare('SELECT id FROM cells WHERE row_id = ? AND column_id = ?').get(rowId, status) as { id: number }).id
      t.db.prepare('INSERT INTO cell_history (cell_id, row_id, column_id, old_value, new_value, changed_at) VALUES (?, ?, ?, ?, ?, ?)').run(cellId, rowId, status, from, to, at)
    }
    hist(extra[0]!, null, 'Estimate', '2026-09-01 09:00:00'); hist(extra[0]!, 'Estimate', 'In progress', '2026-09-05 09:00:00')
    hist(extra[1]!, null, 'Estimate', '2026-09-01 09:00:00'); hist(extra[1]!, 'Estimate', 'Done', '2026-09-03 09:00:00')
    hist(extra[2]!, null, 'Estimate', '2026-09-25 09:00:00')
    const [s] = stageSummary(new Date('2026-10-02T12:00:00Z'))
    expect(s).toMatchObject({ gridId: grid.gridId, columnName: 'Status', noStage: ids.length })
    expect(s!.stages).toEqual([
      { value: 'Estimate', color: '#3b82f6', done: false, count: 1, avgDays: 3 },
      { value: 'In progress', color: '#eab308', done: false, count: 1, avgDays: null },
      { value: 'Done', color: '#22c55e', done: true, count: 1, avgDays: null },
    ])
    expect(s!.oldest).toEqual({ rowId: extra[0], name: 'J-001', stage: 'In progress', days: 27, approximate: false })
  })
})
