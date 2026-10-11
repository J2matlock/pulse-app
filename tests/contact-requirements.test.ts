/**
 * Monthly contact requirements (A2): validation, storage, and monthly counts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, cleanupTestDb, seedGrid, type TestDb } from './helpers'

let testDb: TestDb
vi.mock('../src/main/database', () => ({
  getDb: () => testDb.db,
  cachedStmt: (_key: string, sql: string) => testDb.db.prepare(sql),
  upsertCell: () => {},
}))

import { validateRequirements, saveRequirements, getRequirements, getRequirementStatus } from '../src/main/contact-requirements'
import { contactsComplete, contactsMissing } from '../src/shared/contactRequirements'

let gridId: number
let rowIds: number[]
const note = (rowId: number, type: string, localDateTime: string, voided = false) => testDb.db.prepare(`
  INSERT INTO case_log (row_id, content, log_type, created_at, updated_at, voided_at)
  VALUES (?, 'x', ?, datetime(?, 'utc'), datetime('now'), ?)
`).run(rowId, type, localDateTime, voided ? "2027-01-01 00:00:00" : null)

beforeEach(() => {
  testDb = createTestDb()
  const g = seedGrid(testDb.db, { rowCount: 3 })
  gridId = g.gridId
  rowIds = g.rowIds
})
afterEach(() => cleanupTestDb(testDb))

describe('validateRequirements', () => {
  it('cleans valid input and drops unknown note types', () => {
    expect(validateRequirements([{ label: ' Visit ', note_types: ['visit', 'system', 'visit'], per_month: 2 }]))
      .toEqual([{ label: 'Visit', note_types: ['visit'], per_month: 2, period: 'month' }])
  })
  it('accepts people\'s own note types, archived ones included', () => {
    testDb.db.prepare("INSERT INTO activity_types (key, label, position) VALUES ('session', 'Session', 9)").run()
    testDb.db.prepare("INSERT INTO activity_types (key, label, position, is_archived) VALUES ('old_kind', 'Old kind', 10, 1)").run()
    expect(validateRequirements([{ label: 'Sessions', note_types: ['session', 'old_kind', 'made_up'], per_month: 4 }]))
      .toEqual([{ label: 'Sessions', note_types: ['session', 'old_kind'], per_month: 4, period: 'month' }])
  })

  it('rejects bad input with a readable message', () => {
    expect(validateRequirements([{ label: '', note_types: ['visit'], per_month: 1 }])).toMatch(/name/)
    expect(validateRequirements([{ label: 'X', note_types: ['system'], per_month: 1 }])).toMatch(/kind of note/)
    expect(validateRequirements([{ label: 'X', note_types: ['visit'], per_month: 0 }])).toMatch(/between 1 and 31/)
    expect(validateRequirements('nope')).toBe('Invalid requirements')
    expect(validateRequirements([{ label: 'X', note_types: ['visit'], per_month: 15, period: 'week' }])).toMatch(/per week must be between 1 and 14/)
    expect(validateRequirements([{ label: 'X', note_types: ['visit'], per_month: 1, period: 'fortnight' as never }])).toMatch(/how often/)
  })
})

describe('contact status', () => {
  beforeEach(() => {
    saveRequirements(gridId, [
      { label: 'Face-to-face', note_types: ['visit'], per_month: 1 },
      { label: 'Any contact', note_types: ['visit', 'phone'], per_month: 2 },
    ])
  })

  it('replaces requirements on save', () => {
    saveRequirements(gridId, [{ label: 'Phone', note_types: ['phone'], per_month: 1 }])
    expect(getRequirements(gridId).map(r => r.label)).toEqual(['Phone'])
  })

  it('counts this month\'s notes per requirement, in local time, ignoring voided notes', () => {
    note(rowIds[0]!, 'visit', '2027-03-01 00:30:00')
    note(rowIds[0]!, 'phone', '2027-03-31 23:30:00')
    note(rowIds[0]!, 'phone', '2027-02-28 23:59:00')   // last month
    note(rowIds[1]!, 'phone', '2027-03-10 12:00:00')
    note(rowIds[1]!, 'visit', '2027-03-11 12:00:00', true)  // voided
    const [g] = getRequirementStatus('2027-03-15')
    const byRow = new Map(g!.clients.map(c => [c.rowId, c.counts]))
    expect(byRow.get(rowIds[0]!)).toEqual([1, 2])
    expect(byRow.get(rowIds[1]!)).toEqual([0, 1])
    expect(byRow.get(rowIds[2]!)).toEqual([0, 0])
    expect(contactsComplete([1, 2], g!.requirements)).toBe(true)
    expect(contactsMissing([0, 1], g!.requirements)).toEqual(['Face-to-face (0 of 1)', 'Any contact (1 of 2)'])
  })

  it('counts a late write-up in the month it happened, not the month it was written (audit 1.22)', () => {
    // A visit on Feb 27, written up on Mar 2
    testDb.db.prepare(`INSERT INTO case_log (row_id, content, log_type, occurred_at, created_at, updated_at)
      VALUES (?, 'x', 'visit', datetime('2027-02-27 12:00:00', 'utc'), datetime('2027-03-02 09:00:00', 'utc'), datetime('now'))`).run(rowIds[0])
    expect(getRequirementStatus('2027-03-15')[0]!.clients.find(c => c.rowId === rowIds[0])!.counts).toEqual([0, 0])
    expect(getRequirementStatus('2027-02-15')[0]!.clients.find(c => c.rowId === rowIds[0])!.counts).toEqual([1, 1])
  })

  it('leaves out archived and deleted clients and caseloads without requirements', () => {
    testDb.db.prepare('UPDATE rows SET is_active = 0 WHERE id = ?').run(rowIds[2])
    const other = seedGrid(testDb.db, { name: 'Other', rowCount: 2 })
    const status = getRequirementStatus('2027-03-15')
    expect(status.map(s => s.gridId)).toEqual([gridId])
    expect(status[0]!.clients).toHaveLength(2)
    expect(getRequirementStatus('2027-03-15', other.gridId)).toEqual([])
  })
})

describe('requirement periods', () => {
  it('counts each requirement over its own period containing the day', () => {
    saveRequirements(gridId, [
      { label: 'Check-ins', note_types: ['phone'], per_month: 2, period: 'week' },
      { label: 'Visits', note_types: ['visit'], per_month: 1, period: 'month' },
      { label: 'Reviews', note_types: ['meeting'], per_month: 1, period: 'quarter' },
    ])
    // Wednesday 2027-03-17; Sunday-start week is Mar 14–20
    note(rowIds[0]!, 'phone', '2027-03-14 09:00:00')
    note(rowIds[0]!, 'phone', '2027-03-13 09:00:00')  // previous week
    note(rowIds[0]!, 'visit', '2027-03-02 09:00:00')
    note(rowIds[0]!, 'meeting', '2027-01-20 09:00:00') // same quarter
    const [g] = getRequirementStatus('2027-03-17')
    expect(g!.ranges.map(r => r.label)).toEqual(['Week of Mar 14', 'March 2027', 'Q1 2027'])
    expect(g!.clients.find(c => c.rowId === rowIds[0])!.counts).toEqual([1, 1, 1])
    expect(contactsMissing([1, 1, 1], g!.requirements)).toEqual(['Check-ins (1 of 2 per week)'])
  })

  it('follows the week-start setting', () => {
    saveRequirements(gridId, [{ label: 'Check-ins', note_types: ['phone'], per_month: 1, period: 'week' }])
    note(rowIds[0]!, 'phone', '2027-03-14 09:00:00') // a Sunday
    testDb.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('week_start', 'monday')").run()
    const [g] = getRequirementStatus('2027-03-17')
    expect(g!.ranges[0]!.start).toBe('2027-03-15')
    expect(g!.clients.find(c => c.rowId === rowIds[0])!.counts).toEqual([0])
  })

  it('keeps existing requirements monthly', () => {
    testDb.db.prepare("INSERT INTO contact_requirements (grid_id, label, note_types, per_month) VALUES (?, 'Old', '[\"visit\"]', 1)").run(gridId)
    expect(getRequirements(gridId)[0]!.period).toBe('month')
  })
})
