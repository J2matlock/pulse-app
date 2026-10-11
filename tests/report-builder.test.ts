/** Report builder engine (W10 commit 6): validation, each source, grouping, sums, limits, saved reports. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, cleanupTestDb, seedGrid, setDbWords, createEmptyEncryptedDb, allMigrations, type TestDb } from './helpers'

let t: TestDb
vi.mock('electron', () => ({ app: { getPath: () => '/tmp', isPackaged: false }, BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../src/main/database', async () => {
  const actual = await vi.importActual<typeof import('../src/main/database')>('../src/main/database')
  return { ...actual, getDb: () => t.db, cachedStmt: (_k: string, sql: string) => t.db.prepare(sql) }
})

import { reportFields, runReport, validateReportConfig, saveReport, listReports, deleteReport, getReport, ReportError } from '../src/main/report-builder'
import { bucketDate, presetRange, matchReportFilter, valueLabel, formatReportCell, defaultFilterField, defaultGroupField, defaultValueField, suggestReportName, describeReport, explainReport, chartableReport } from '../src/shared/reports'
import { up as migration043 } from '../src/main/migrations/043_report_definitions'

let gridId: number
let nameCol: number, makeCol: number, costCol: number, dueCol: number
let rows: number[]
const NOW = new Date(2026, 9, 15, 12, 0, 0) // Oct 15, 2026

const cell = (rowId: number, colId: number, v: string) => t.db.prepare('INSERT OR REPLACE INTO cells (row_id, column_id, value) VALUES (?, ?, ?)').run(rowId, colId, v)
const note = (rowId: number, localTime: string, type: string, extra: Record<string, number> | null = null, minutes: number | null = null) =>
  t.db.prepare("INSERT INTO case_log (row_id, content, log_type, created_at, updated_at, extra_measures, minutes) VALUES (?, 'x', ?, datetime(?, 'utc'), datetime('now'), ?, ?)")
    .run(rowId, type, localTime, extra ? JSON.stringify(extra) : null, minutes)

beforeEach(() => {
  t = createTestDb()
  setDbWords(t.db)
  const g = seedGrid(t.db, { name: 'Vehicles', rowCount: 4, columnCount: 4, columnTypes: ['text', 'dropdown', 'currency', 'date'] })
  gridId = g.gridId; rows = g.rowIds
  ;[nameCol, makeCol, costCol, dueCol] = g.columnIds as [number, number, number, number]
  t.db.prepare("UPDATE columns SET name = 'Make' WHERE id = ?").run(makeCol)
  t.db.prepare("UPDATE columns SET name = 'Cost' WHERE id = ?").run(costCol)
  t.db.prepare("UPDATE columns SET name = 'Inspection' WHERE id = ?").run(dueCol)
  const data: Array<[string, string, string]> = [['Civic', 'Honda', '1,200.50'], ['Accord', 'Honda', '800'], ['F-150', 'Ford', '2000'], ['Prius', 'Toyota', '']]
  data.forEach(([n, m, c], i) => { cell(rows[i]!, nameCol, n); cell(rows[i]!, makeCol, m); if (c) cell(rows[i]!, costCol, c) })
  t.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('workspace_measures', ?)").run(JSON.stringify([
    { key: 'parts', label: 'Parts', kind: 'currency', decimals: 2 },
    { key: 'labor', label: 'Labor', kind: 'hours', decimals: 2 },
  ]))
})
afterEach(() => cleanupTestDb(t))

describe('fields', () => {
  it('lists the source’s own fields and the record’s columns', () => {
    const ids = reportFields(gridId, 'activities').map(f => f.id)
    expect(ids).toEqual(expect.arrayContaining(['act:date', 'act:type', 'act:m:parts', 'act:m:labor', 'rec:created', `col:${costCol}`]))
    expect(reportFields(gridId, 'activities').find(f => f.id === 'act:m:parts')!.kind).toBe('currency')
    expect(reportFields(gridId, 'records').some(f => f.id.startsWith('act:'))).toBe(false)
    expect(reportFields(gridId, 'records').find(f => f.id === `col:${costCol}`)).toMatchObject({ label: 'Cost', kind: 'currency', group: 'Client' })
  })
})

describe('validation', () => {
  it('refuses settings that aren’t valid or name fields the list doesn’t have', () => {
    expect(() => validateReportConfig(gridId, { source: 'everything' })).toThrow(ReportError)
    expect(() => validateReportConfig(gridId, { source: 'records', filters: [{ field: "col:1; DROP TABLE rows", operator: 'equals', value: 'x' }] })).toThrow(/aren't valid/)
    expect(() => validateReportConfig(gridId, { source: 'records', groupBy: [{ field: 'col:99999' }] })).toThrow(/no longer on the list/)
    expect(() => validateReportConfig(gridId, { source: 'records', values: [{ fn: 'sum', field: `col:${makeCol}` }] })).toThrow(/isn't a number/)
    expect(() => validateReportConfig(gridId, { source: 'records', groupBy: [{ field: `col:${makeCol}`, bucket: 'month' }] })).toThrow(/Only dates/)
    expect(() => validateReportConfig(gridId, { source: 'records', dateRange: { field: `col:${makeCol}`, preset: 'this_month' } })).toThrow(/needs a date/)
    expect(() => validateReportConfig(gridId, { source: 'records', values: Array(7).fill({ fn: 'count' }) })).toThrow(ReportError)
  })

  it('treats filter values as plain text, never SQL', () => {
    cell(rows[3]!, makeCol, "Toyota' OR 1=1 --")
    const r = runReport(gridId, { source: 'records', filters: [{ field: `col:${makeCol}`, operator: 'equals', value: "Toyota' OR 1=1 --" }], columns: [`col:${nameCol}`] }, NOW)
    expect(r.rows).toEqual([{ [`col:${nameCol}`]: 'Prius' }])
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM rows').get()).toEqual({ n: 4 })
  })
})

describe('records', () => {
  it('groups by a column with count, total and average; blanks last', () => {
    const r = runReport(gridId, { source: 'records', groupBy: [{ field: `col:${makeCol}` }], values: [{ fn: 'count' }, { fn: 'sum', field: `col:${costCol}` }, { fn: 'avg', field: `col:${costCol}` }] }, NOW)
    expect(r.columns.map(c => c.label)).toEqual(['Make', 'How many', 'Total Cost', 'Average Cost'])
    expect(r.rows).toEqual([
      { g0: 'Ford', v0: 1, v1: 2000, v2: 2000 },
      { g0: 'Honda', v0: 2, v1: 2000.5, v2: 1000.25 },
      { g0: 'Toyota', v0: 1, v1: null, v2: null },
    ])
    expect(r.totals).toEqual({ v0: 4, v1: 4000.5, v2: 1333.5 })
    expect(r.columns[2]!.kind).toBe('currency')
  })

  it('lists chosen columns with filters and a sort', () => {
    const r = runReport(gridId, { source: 'records', filters: [{ field: `col:${costCol}`, operator: 'gt', value: '900' }], columns: [`col:${nameCol}`, `col:${costCol}`], sort: { field: `col:${costCol}`, dir: 'desc' } }, NOW)
    expect(r.rows).toEqual([{ [`col:${nameCol}`]: 'F-150', [`col:${costCol}`]: 2000 }, { [`col:${nameCol}`]: 'Civic', [`col:${costCol}`]: 1200.5 }])
    expect(r.matched).toBe(2)
  })

  it('with no grouping or columns gives one line of values', () => {
    expect(runReport(gridId, { source: 'records' }, NOW).rows).toEqual([{ v0: 4 }])
    expect(runReport(gridId, { source: 'records', values: [{ fn: 'max', field: `col:${costCol}` }] }, NOW).rows).toEqual([{ v0: 2000 }])
  })

  it('ignores a filter until its value is filled in', () => {
    const blank = { source: 'records', filters: [{ field: 'rec:created', operator: 'before', value: '' }] }
    expect(runReport(gridId, blank, NOW).matched).toBe(4)
    expect(runReport(gridId, { source: 'records', filters: [{ field: `col:${costCol}`, operator: 'is_empty', value: '' }] }, NOW).matched).toBe(1)
  })

  it('groups a dropdown in its own order, with the choices offered for filters', () => {
    t.db.prepare('UPDATE columns SET config = ? WHERE id = ?').run(JSON.stringify({ options: ['Toyota', 'Honda', 'Ford'] }), makeCol)
    const make = reportFields(gridId, 'records').find(f => f.id === `col:${makeCol}`)!
    expect(make.options).toEqual(['Toyota', 'Honda', 'Ford'])
    const r = runReport(gridId, { source: 'records', groupBy: [{ field: `col:${makeCol}` }] }, NOW)
    expect(r.rows.map(x => x.g0)).toEqual(['Toyota', 'Honda', 'Ford'])
  })

  it('marks the name and numbers Pulse works out, and keeps the period on date groups', () => {
    const fields = reportFields(gridId, 'records')
    expect(fields.find(f => f.id === `col:${nameCol}`)!.hint).toBe('name')
    expect(reportFields(gridId, 'deadlines').find(f => f.id === 'dl:overdue')!.hint).toBe('derived')
    const r = runReport(gridId, { source: 'records', groupBy: [{ field: 'rec:created', bucket: 'month' }] }, NOW)
    expect(r.columns[0]).toMatchObject({ kind: 'date', bucket: 'month' })
  })

  it('leaves out archived records unless asked', () => {
    t.db.prepare('UPDATE rows SET is_active = 0 WHERE id = ?').run(rows[0])
    expect(runReport(gridId, { source: 'records' }, NOW).rows).toEqual([{ v0: 3 }])
    expect(runReport(gridId, { source: 'records', includeArchived: true }, NOW).rows).toEqual([{ v0: 4 }])
  })
})

describe('notes', () => {
  beforeEach(() => {
    t.db.prepare("INSERT OR IGNORE INTO activity_types (key, label, position) VALUES ('repair', 'Repair', 50)").run()
    note(rows[0]!, '2026-09-03 10:00:00', 'repair', { parts: 100.1, labor: 1.5 })
    note(rows[0]!, '2026-09-20 10:00:00', 'repair', { parts: 50 })
    note(rows[2]!, '2026-10-02 10:00:00', 'repair', { parts: 25.25, labor: 2 })
    note(rows[2]!, '2026-10-05 10:00:00', 'note', null, 30)
    note(rows[2]!, '2026-10-06 10:00:00', 'system')
    t.db.prepare("UPDATE case_log SET voided_at = datetime('now') WHERE row_id = ? AND log_type = 'note'").run(rows[2])
  })

  it('totals your own numbers per month, leaving out system and voided entries', () => {
    const r = runReport(gridId, { source: 'activities', groupBy: [{ field: 'act:date', bucket: 'month' }], values: [{ fn: 'count' }, { fn: 'sum', field: 'act:m:parts' }, { fn: 'sum', field: 'act:m:labor' }] }, NOW)
    expect(r.rows).toEqual([{ g0: '2026-09', v0: 2, v1: 150.1, v2: 1.5 }, { g0: '2026-10', v0: 1, v1: 25.25, v2: 2 }])
    expect(r.columns[0]).toMatchObject({ label: 'Date', kind: 'date', bucket: 'month' })
  })

  it('groups by type and a record column together, within a date range', () => {
    const r = runReport(gridId, { source: 'activities', dateRange: { field: 'act:date', from: '2026-09-01', to: '2026-09-30' }, groupBy: [{ field: 'act:type' }, { field: `col:${makeCol}` }] }, NOW)
    expect(r.rows).toEqual([{ g0: 'Repair', g1: 'Honda', v0: 2 }])
    const thisMonth = runReport(gridId, { source: 'activities', dateRange: { field: 'act:date', preset: 'this_month' } }, NOW)
    expect(thisMonth.rows).toEqual([{ v0: 1 }])
  })

  it('dates a late write-up by the day it happened (audit 1.22)', () => {
    t.db.prepare(`INSERT INTO case_log (row_id, content, log_type, occurred_at, created_at, updated_at)
      VALUES (?, 'x', 'repair', datetime('2026-09-29 12:00:00', 'utc'), datetime('2026-10-02 09:00:00', 'utc'), datetime('now'))`).run(rows[0])
    const r = runReport(gridId, { source: 'activities', dateRange: { field: 'act:date', from: '2026-10-01', to: '2026-10-31' } }, NOW)
    expect(r.rows).toEqual([{ v0: 1 }])
    const sept = runReport(gridId, { source: 'activities', dateRange: { field: 'act:date', from: '2026-09-01', to: '2026-09-30' } }, NOW)
    expect(sept.rows).toEqual([{ v0: 3 }])
  })
})

describe('appointments and deadlines', () => {
  it('counts appointments by status with their length', () => {
    const ins = t.db.prepare('INSERT INTO appointments (row_id, title, start_at, end_at, status) VALUES (?, ?, ?, ?, ?)')
    ins.run(rows[0], 'Oil change', '2026-10-01T09:00', '2026-10-01T10:30', 'done')
    ins.run(rows[1], 'Brakes', '2026-10-02T09:00', '2026-10-02T09:30', 'done')
    ins.run(rows[1], 'Check', '2026-10-20T09:00', null, 'scheduled')
    const r = runReport(gridId, { source: 'appointments', groupBy: [{ field: 'appt:status' }], values: [{ fn: 'count' }, { fn: 'sum', field: 'appt:minutes' }] }, NOW)
    // Statuses in their own order: Scheduled before Done
    expect(r.rows).toEqual([{ g0: 'Scheduled', v0: 1, v1: null }, { g0: 'Done', v0: 2, v1: 120 }])
  })

  it('reports deadlines through the deadline engine', () => {
    const rule = Number(t.db.prepare("INSERT INTO alert_rules (name, thresholds, interval_days) VALUES ('Yearly', '[]', 365)").run().lastInsertRowid)
    t.db.prepare('UPDATE columns SET config = ? WHERE id = ?').run(JSON.stringify({ alert_rule_id: rule }), dueCol)
    cell(rows[0]!, dueCol, '2025-09-01') // due 2026-09-01: overdue
    cell(rows[1]!, dueCol, '2026-06-01') // due 2027-06-01: fine
    const r = runReport(gridId, { source: 'deadlines', groupBy: [{ field: 'dl:state' }], values: [{ fn: 'count' }, { fn: 'max', field: 'dl:overdue' }] }, NOW)
    expect(r.rows.find(x => x.g0 === 'Overdue')).toEqual({ g0: 'Overdue', v0: 1, v1: 44 })
    expect(r.matched).toBe(2)
  })

  it('offers a date column whose rule was chosen in the app (by id) as a Deadline, and not one whose rule was removed', () => {
    const rule = Number(t.db.prepare("INSERT INTO alert_rules (name, thresholds, interval_days) VALUES ('Yearly', '[]', 365)").run().lastInsertRowid)
    t.db.prepare('UPDATE columns SET config = ? WHERE id = ?').run(JSON.stringify({ alert_rule_id: rule }), dueCol)
    const options = () => reportFields(gridId, 'deadlines').find(f => f.id === 'dl:rule')!.options
    expect(options()).toEqual(['Inspection'])
    t.db.prepare('UPDATE columns SET config = ? WHERE id = ?').run(JSON.stringify({ alert_rule_name: 'Yearly' }), dueCol)
    expect(options()).toEqual([])
  })

  it('names a Deadline column by what it holds: the day it was last done', () => {
    t.db.prepare("UPDATE columns SET column_type = 'deadline' WHERE id = ?").run(dueCol)
    expect(reportFields(gridId, 'records').find(f => f.id === `col:${dueCol}`)!.label).toBe('Inspection (last done)')
  })
})

describe('limits', () => {
  it('shows at most 2,000 lines and says so', () => {
    t.db.transaction(() => {
      const ins = t.db.prepare('INSERT INTO rows (grid_id, position) VALUES (?, ?)')
      for (let i = 0; i < 2100; i++) ins.run(gridId, 10 + i)
    })()
    const r = runReport(gridId, { source: 'records', columns: [`col:${nameCol}`] }, NOW)
    expect(r.rows).toHaveLength(2000)
    expect(r.matched).toBe(2104)
    expect(r.truncated).toMatch(/first 2,000 lines/)
  })
})

describe('helpers', () => {
  it('buckets dates and works out preset ranges', () => {
    expect(bucketDate('2026-10-15', 'week')).toBe('2026-10-11')
    expect(bucketDate('2026-10-15', 'quarter')).toBe('2026 Q4')
    expect(bucketDate('2026-10-15', 'year')).toBe('2026')
    expect(presetRange('last_month', NOW)).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(presetRange('this_quarter', NOW)).toEqual({ from: '2026-10-01', to: '2026-12-31' })
    expect(matchReportFilter('$1,200.50', 'currency', 'gt', '1000')).toBe(true)
    expect(matchReportFilter('2026-10-02', 'date', 'before', '2026-10-03')).toBe(true)
    expect(valueLabel({ fn: 'sum', field: 'x', label: ' Parts total ' }, [])).toBe('Parts total')
  })

  it('spells dates out for people', () => {
    expect(formatReportCell('2026-07-31', 'date')).toBe('Jul 31, 2026')
    expect(formatReportCell('2026-10', 'date', 'month')).toBe('Oct 2026')
    expect(formatReportCell('2026-10-11', 'date', 'week')).toBe('Week of Oct 11, 2026')
    expect(formatReportCell('2026 Q4', 'date', 'quarter')).toBe('Q4 2026')
    expect(formatReportCell('(blank)', 'date', 'month')).toBe('(blank)')
    expect(formatReportCell('Honda', 'text')).toBe('Honda')
  })

  it('picks sensible defaults: the stage or a choice to filter and group by, money to add up', () => {
    const fields = [
      { id: 'rec:created', label: 'Date added', kind: 'date' as const, group: 'Job' },
      { id: 'rec:stage_days', label: 'Days in stage', kind: 'number' as const, group: 'Job', hint: 'derived' as const },
      { id: 'col:1', label: 'Job', kind: 'text' as const, group: 'Job', hint: 'name' as const },
      { id: 'col:2', label: 'Stage', kind: 'text' as const, group: 'Job', hint: 'stage' as const, options: ['New', 'Done'] },
      { id: 'col:3', label: 'Hours', kind: 'number' as const, group: 'Job' },
      { id: 'col:4', label: 'Estimate', kind: 'currency' as const, group: 'Job' },
      { id: 'act:type', label: 'Type', kind: 'text' as const, group: 'Note', options: ['Call'] },
    ]
    expect(defaultFilterField(fields)!.id).toBe('col:2')
    expect(defaultGroupField(fields, 'records')!.id).toBe('col:2')
    expect(defaultGroupField(fields, 'activities')!.id).toBe('act:type')
    expect(defaultGroupField(fields, 'records', ['col:2'])!.id).toBe('act:type')
    expect(defaultValueField(fields)!.id).toBe('col:4')
    expect(defaultValueField(fields.filter(f => f.kind !== 'currency'))!.id).toBe('col:3')
  })

  it('explains a report in a sentence', () => {
    const fields = [{ id: 'col:2', label: 'Stage', kind: 'text' as const, group: 'Job' }, { id: 'col:4', label: 'Estimate', kind: 'currency' as const, group: 'Job' },
      { id: 'act:date', label: 'Date', kind: 'date' as const, group: 'Note' }, { id: 'col:1', label: 'Job', kind: 'text' as const, group: 'Job' }]
    expect(explainReport({ source: 'records', filters: [], groupBy: [{ field: 'col:2' }], values: [{ fn: 'count' }, { fn: 'sum', field: 'col:4' }] }, fields, { one: 'Job', many: 'Jobs' }, 'Jobs', 10))
      .toBe('Counting 10 jobs, one line per Stage, showing how many and the total Estimate.')
    expect(explainReport({ source: 'activities', filters: [], groupBy: [{ field: 'act:date', bucket: 'month' }], values: [{ fn: 'count' }], dateRange: { field: 'act:date', preset: 'this_year' } }, fields, { one: 'Note', many: 'Notes' }, 'Customers', 1))
      .toBe('Counting 1 note in Customers, this year, one line per month, showing how many.')
    expect(explainReport({ source: 'records', filters: [{ field: 'col:2', operator: 'equals', value: 'Done' }, { field: 'col:4', operator: 'gt', value: '' }], groupBy: [], values: [], columns: ['col:1', 'col:4'] }, fields, { one: 'Job', many: 'Jobs' }, 'Jobs', null))
      .toBe('Listing jobs where Stage is Done, showing Job and Estimate.')
    // The singular comes from the words, not from cutting off an "s"
    expect(explainReport({ source: 'records', filters: [], groupBy: [], values: [{ fn: 'count' }] }, fields, { one: 'Property', many: 'Properties' }, 'Rentals', 1))
      .toMatch(/^Counting 1 property\b/)
    const grouped = { columns: [{ key: 'g0', label: 'Stage', kind: 'text' as const }, { key: 'v0', label: 'How many', kind: 'number' as const }], rows: [{ g0: 'A', v0: 1 }, { g0: 'B', v0: 2 }], totals: {}, matched: 3, truncated: null }
    expect(chartableReport({ source: 'records', filters: [], groupBy: [{ field: 'col:2' }], values: [] }, grouped)).toBe(true)
    expect(chartableReport({ source: 'records', filters: [], groupBy: [], values: [] }, grouped)).toBe(false)
  })

  it('suggests a name and describes what a report covers', () => {
    const fields = [{ id: 'col:2', label: 'Stage', kind: 'text' as const, group: 'Job' }, { id: 'col:4', label: 'Estimate', kind: 'currency' as const, group: 'Job' }, { id: 'act:date', label: 'Date', kind: 'date' as const, group: 'Note' }]
    expect(suggestReportName({ source: 'records', filters: [], groupBy: [{ field: 'col:2' }], values: [{ fn: 'count' }] }, fields, 'Jobs')).toBe('Jobs by Stage')
    expect(suggestReportName({ source: 'records', filters: [], groupBy: [{ field: 'col:2' }], values: [{ fn: 'sum', field: 'col:4' }] }, fields, 'Jobs')).toBe('Total Estimate by Stage')
    expect(suggestReportName({ source: 'activities', filters: [], groupBy: [{ field: 'act:date', bucket: 'month' }], values: [{ fn: 'count' }], dateRange: { field: 'act:date', preset: 'this_year' } }, fields, 'Notes')).toBe('Notes per month, this year')
    expect(suggestReportName({ source: 'records', filters: [], groupBy: [], values: [{ fn: 'count' }] }, fields, 'Jobs')).toBe('How many jobs')
    expect(describeReport({ source: 'records', filters: [{ field: 'col:2', operator: 'equals', value: 'Done' }, { field: 'col:4', operator: 'gt', value: '' }], groupBy: [], values: [], dateRange: { field: 'act:date', preset: 'this_month' } }, fields, 'Jobs', 'Jobs'))
      .toBe('Jobs · Stage is Done · Date: this month')
    expect(describeReport({ source: 'activities', filters: [], groupBy: [], values: [] }, fields, 'Jobs', 'Notes')).toBe('Notes in Jobs')
  })
})

describe('saved reports', () => {
  it('saves, lists, renames and deletes; the list going away removes them', () => {
    const saved = saveReport({ name: '  Jobs   per month ', gridId, config: { source: 'activities', groupBy: [{ field: 'act:date', bucket: 'month' }] } })
    expect(saved).toMatchObject({ name: 'Jobs per month', grid_id: gridId })
    expect(saved.config.groupBy).toEqual([{ field: 'act:date', bucket: 'month' }])
    expect(() => saveReport({ name: '', gridId, config: { source: 'records' } })).toThrow(/name/)
    expect(() => saveReport({ name: 'Bad', gridId, config: { source: 'records', columns: ['col:99999'] } })).toThrow(ReportError)
    saveReport({ id: saved.id, name: 'Monthly jobs', gridId, config: saved.config })
    expect(listReports(gridId).map(r => r.name)).toEqual(['Monthly jobs'])
    deleteReport(saved.id)
    expect(getReport(saved.id)).toBeUndefined()
    const again = saveReport({ name: 'Again', gridId, config: { source: 'records' } })
    t.db.prepare('DELETE FROM grids WHERE id = ?').run(gridId)
    expect(getReport(again.id)).toBeUndefined()
  })

  it('a list in the Trash takes its reports off the dashboard until it is restored', () => {
    const saved = saveReport({ name: 'Count', gridId, config: { source: 'records' } })
    t.db.prepare('UPDATE grids SET is_active = 0 WHERE id = ?').run(gridId)
    expect(getReport(saved.id)).toBeUndefined()
    expect(() => runReport(gridId, { source: 'records' }, NOW)).toThrow(/no longer available/)
    t.db.prepare('UPDATE grids SET is_active = 1 WHERE id = ?').run(gridId)
    expect(getReport(saved.id)?.name).toBe('Count')
  })
})

describe('migration 043', () => {
  it('creates the table, sets the version and can run twice', () => {
    const e = createEmptyEncryptedDb()
    for (const m of allMigrations.filter(m => m.version < 43)) m.up(e.db)
    migration043(e.db)
    migration043(e.db)
    expect((e.db.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get() as { value: string }).value).toBe('43')
    expect(e.db.prepare("SELECT name FROM sqlite_master WHERE name = 'report_definitions'").get()).toBeTruthy()
    cleanupTestDb(e)
  })
})

describe('export', () => {
  it('writes CSV with numbers kept, formulas guarded and a totals line; PDF is a PDF', async () => {
    const { reportToCsv, buildReportPdf } = await import('../src/main/export-report')
    cell(rows[3]!, makeCol, '=HYPERLINK("x")')
    const r = runReport(gridId, { source: 'records', groupBy: [{ field: `col:${makeCol}` }], values: [{ fn: 'count' }, { fn: 'sum', field: `col:${costCol}` }] }, NOW)
    const csv = reportToCsv(r)
    expect(csv.startsWith('﻿')).toBe(true)
    const lines = csv.slice(1).split('\r\n')
    expect(lines[0]).toBe('Make,How many,Total Cost')
    expect(lines).toContain('Honda,2,2000.5')
    expect(lines.some(l => l.startsWith('"\t=HYPERLINK'))).toBe(true)
    expect(lines[lines.length - 1]).toBe('Total,4,4000.5')
    const pdf = buildReportPdf('Jobs by make', 'Vehicles', r)
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    // A long name wraps onto a second line instead of running past the margin
    const long = 'Total Estimate by Stage and per month, this quarter, for every customer on the list'
    const text = buildReportPdf(long, 'Vehicles', r).toString('latin1')
    expect(text).not.toContain(`(${long}) Tj`)
    expect(text).toContain('(Total Estimate by Stage')
  })

  it('writes report CSV dates in the date format setting (AUDIT-128)', async () => {
    const { reportToCsv } = await import('../src/main/export-report')
    cell(rows[0]!, dueCol, '2026-10-06')
    const r = runReport(gridId, { source: 'records', columns: [`col:${nameCol}`, `col:${dueCol}`] }, NOW)
    const us = reportToCsv(r, 'us').slice(1).split('\r\n')
    expect(us.some(l => l.endsWith(',10/06/2026'))).toBe(true)
    t.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('date_format', 'eu')").run()
    expect(reportToCsv(r).slice(1).split('\r\n').some(l => l.endsWith(',06/10/2026'))).toBe(true)
    // Month groups aren't full dates and stay as they are
    const byMonth = runReport(gridId, { source: 'records', groupBy: [{ field: `col:${dueCol}`, bucket: 'month' }], values: [{ fn: 'count' }] }, NOW)
    expect(reportToCsv(byMonth, 'us')).toContain('2026-10')
  })

  it('deleting a report takes it off the dashboard', () => {
    const a = saveReport({ name: 'A', gridId, config: { source: 'records' } })
    const b = saveReport({ name: 'B', gridId, config: { source: 'records' } })
    t.db.prepare("INSERT INTO settings (key, value) VALUES ('dashboard_reports', ?)").run(JSON.stringify([a.id, b.id]))
    deleteReport(a.id)
    expect(JSON.parse((t.db.prepare("SELECT value FROM settings WHERE key = 'dashboard_reports'").get() as { value: string }).value)).toEqual([b.id])
  })
})
