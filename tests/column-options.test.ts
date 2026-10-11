/** Editing a column's choices (audit 1.15): renames carry records along, the stage follows its options. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'

let t: TestDb
vi.mock('../src/main/database', () => ({ getDb: () => t.db, cachedStmt: (_k: string, sql: string) => t.db.prepare(sql) }))

import { saveColumnOptions, optionUsage, OptionsError } from '../src/main/column-options'
import { saveStageConfig, moveStage } from '../src/main/stages'
import { stageConfigOf, columnOptionLabels } from '../src/shared/stages'

let grid: { gridId: number; columnIds: number[]; rowIds: number[] }
let status: number, dateCol: number
const col = (id: number) => t.db.prepare('SELECT column_type, config FROM columns WHERE id = ?').get(id) as { column_type: string; config: string | null }
const cell = (rowId: number, colId: number) => (t.db.prepare('SELECT value FROM cells WHERE row_id = ? AND column_id = ?').get(rowId, colId) as { value: string } | undefined)?.value

beforeEach(() => {
  t = createTestDb()
  grid = seedGrid(t.db, { name: 'Jobs', rowCount: 3, columnCount: 3 })
  ;[, status, dateCol] = grid.columnIds as [number, number, number]
  t.db.prepare("UPDATE columns SET name = 'Stage', column_type = 'status', config = ? WHERE id = ?")
    .run(JSON.stringify({ options: [{ label: 'Scheduled', color: '#3b82f6' }, { label: 'Done', color: '#22c55e' }] }), status)
  t.db.prepare("UPDATE columns SET name = 'Booked on', column_type = 'date' WHERE id = ?").run(dateCol)
})
afterEach(() => cleanupTestDb(t))

describe('saving choices', () => {
  it('renames a choice, keeps its color and changes the records that use it when asked', () => {
    const put = t.db.prepare("INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)")
    put.run(grid.rowIds[0], status, 'Scheduled'); put.run(grid.rowIds[1], status, 'Scheduled'); put.run(grid.rowIds[2], status, 'Done')
    expect(optionUsage(status)).toEqual({ Scheduled: 2, Done: 1 })
    const res = saveColumnOptions(status, { options: ['Booked', 'Done', 'On hold'], renames: { Scheduled: 'Booked' }, updateRecords: true })
    expect(res.updated).toBe(2)
    expect(cell(grid.rowIds[0]!, status)).toBe('Booked')
    const opts = JSON.parse(col(status).config!).options as Array<{ label: string; color: string }>
    expect(opts.map(o => o.label)).toEqual(['Booked', 'Done', 'On hold'])
    expect(opts[0]!.color).toBe('#3b82f6')
    const hist = t.db.prepare('SELECT old_value, new_value FROM cell_history WHERE row_id = ? AND column_id = ?').all(grid.rowIds[0], status)
    expect(hist).toEqual([{ old_value: 'Scheduled', new_value: 'Booked' }])
  })

  it('swapping two choices swaps the records too, instead of merging them (bug sweep S3)', () => {
    const put = t.db.prepare("INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)")
    put.run(grid.rowIds[0], status, 'Scheduled'); put.run(grid.rowIds[1], status, 'Done'); put.run(grid.rowIds[2], status, 'Done')
    const res = saveColumnOptions(status, { options: ['Done', 'Scheduled'], renames: { Scheduled: 'Done', Done: 'Scheduled' }, updateRecords: true })
    expect(res.updated).toBe(3)
    expect([cell(grid.rowIds[0]!, status), cell(grid.rowIds[1]!, status), cell(grid.rowIds[2]!, status)]).toEqual(['Done', 'Scheduled', 'Scheduled'])
    // Each choice keeps its colour through the rename
    const opts = JSON.parse(col(status).config!).options as Array<{ label: string; color: string }>
    expect(opts).toEqual([{ label: 'Done', color: '#3b82f6' }, { label: 'Scheduled', color: '#22c55e' }])
  })

  it('a chain (A → B, B → C) keeps the two groups apart, and relabels records in the Trash too', () => {
    const put = t.db.prepare("INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, ?)")
    put.run(grid.rowIds[0], status, 'Scheduled'); put.run(grid.rowIds[1], status, 'Done'); put.run(grid.rowIds[2], status, 'Done')
    t.db.prepare("UPDATE rows SET is_active = 0, deleted_at = datetime('now') WHERE id = ?").run(grid.rowIds[2])
    const res = saveColumnOptions(status, { options: ['Done', 'Closed'], renames: { Scheduled: 'Done', Done: 'Closed' }, updateRecords: true })
    expect(res.updated).toBe(2)
    expect([cell(grid.rowIds[0]!, status), cell(grid.rowIds[1]!, status), cell(grid.rowIds[2]!, status)]).toEqual(['Done', 'Closed', 'Closed'])
  })

  it('leaves records alone when not asked, and refuses duplicate choices', () => {
    t.db.prepare("INSERT INTO cells (row_id, column_id, value) VALUES (?, ?, 'Scheduled')").run(grid.rowIds[0], status)
    expect(saveColumnOptions(status, { options: ['Booked', 'Done'], renames: { Scheduled: 'Booked' } }).updated).toBe(0)
    expect(cell(grid.rowIds[0]!, status)).toBe('Scheduled')
    expect(() => saveColumnOptions(status, { options: ['A', 'a'] })).toThrow(OptionsError)
    expect(() => saveColumnOptions(dateCol, { options: ['A'] })).toThrow(OptionsError)
  })

  it('keeps the stage in step: new choices become stages, a renamed one keeps its settings (G-02)', () => {
    saveStageConfig(status, { options: [{ value: 'Scheduled', onEnter: { stampColumnId: dateCol } }, { value: 'Done', done: true }] })
    saveColumnOptions(status, { options: ['Booked', 'On hold', 'Done'], renames: { Scheduled: 'Booked' } })
    expect(columnOptionLabels(col(status))).toEqual(['Booked', 'On hold', 'Done'])
    expect(stageConfigOf(col(status))?.options).toEqual([
      { value: 'Booked', onEnter: { stampColumnId: dateCol } }, { value: 'On hold' }, { value: 'Done', done: true },
    ])
    // A record can now move to the new choice
    expect(moveStage(grid.rowIds[0]!, status, 'On hold').changed).toBe(true)
    // And the stage settings still save
    expect(() => saveStageConfig(status, stageConfigOf(col(status)))).not.toThrow()
  })
})
