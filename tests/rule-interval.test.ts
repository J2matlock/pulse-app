/**
 * Calendar-based deadline rules: JS date math and the SQL expression must agree.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestDb, cleanupTestDb, type TestDb } from './helpers'
import { addInterval, toRuleInterval, describeInterval, hasInterval, type RuleInterval } from '../src/shared/ruleInterval'
import { localDateString } from '../src/shared/dates'
import { effectiveDateSql } from './legacyDeadlineSql'

const d = (s: string) => { const [y, m, day] = s.split('-').map(Number); return new Date(y!, m! - 1, day!) }
const add = (s: string, iv: Partial<RuleInterval>) => localDateString(addInterval(d(s), { days: 0, months: 0, endOfMonth: false, ...iv }))

describe('addInterval', () => {
  it('clamps month-end dates instead of spilling into the next month', () => {
    expect(add('2027-01-31', { months: 1 })).toBe('2027-02-28')
    expect(add('2028-01-31', { months: 1 })).toBe('2028-02-29')
    expect(add('2027-08-31', { months: 6 })).toBe('2028-02-29')
  })
  it('keeps anniversaries on the same date', () => {
    expect(add('2027-03-15', { months: 12 })).toBe('2028-03-15')
    expect(add('2028-02-29', { months: 12 })).toBe('2029-02-28')
    expect(add('2027-11-10', { months: 36 })).toBe('2030-11-10')
  })
  it('adds plain days as before', () => {
    expect(add('2027-01-01', { days: 30 })).toBe('2027-01-31')
    expect(add('2027-12-20', { days: 90 })).toBe('2028-03-19')
  })
  it('moves to the end of the month when asked', () => {
    expect(add('2027-01-10', { endOfMonth: true })).toBe('2027-01-31')
    expect(add('2027-01-10', { months: 1, endOfMonth: true })).toBe('2027-02-28')
    expect(add('2027-01-25', { days: 10, endOfMonth: true })).toBe('2027-02-28')
  })
})

describe('toRuleInterval / describeInterval', () => {
  it('normalizes rules and bare day counts', () => {
    expect(toRuleInterval(30)).toEqual({ days: 30, months: 0, endOfMonth: false })
    expect(toRuleInterval(null)).toEqual({ days: 0, months: 0, endOfMonth: false })
    expect(toRuleInterval({ interval_days: 30, interval_months: 6, end_of_month: 1 })).toEqual({ days: 0, months: 6, endOfMonth: true })
    expect(hasInterval(toRuleInterval({ interval_days: 0 }))).toBe(false)
  })
  it('describes intervals in plain English', () => {
    expect(describeInterval({ days: 0, months: 12, endOfMonth: false })).toBe('Every year')
    expect(describeInterval({ days: 0, months: 24, endOfMonth: false })).toBe('Every 2 years')
    expect(describeInterval({ days: 0, months: 6, endOfMonth: true })).toBe('Every 6 months, due by the end of that month')
    expect(describeInterval({ days: 45, months: 0, endOfMonth: false })).toBe('45 days after the date entered')
  })
})

describe('effectiveDateSql matches addInterval', () => {
  let t: TestDb
  beforeAll(() => { t = createTestDb() })
  afterAll(() => cleanupTestDb(t))

  const intervals: RuleInterval[] = [
    { days: 0, months: 0, endOfMonth: false },
    { days: 30, months: 0, endOfMonth: false },
    { days: 182, months: 0, endOfMonth: false },
    { days: 0, months: 1, endOfMonth: false },
    { days: 0, months: 6, endOfMonth: false },
    { days: 0, months: 12, endOfMonth: false },
    { days: 0, months: 13, endOfMonth: false },
    { days: 0, months: 0, endOfMonth: true },
    { days: 0, months: 3, endOfMonth: true },
    { days: 10, months: 0, endOfMonth: true },
  ]
  const dates = ['2027-01-31', '2027-02-28', '2028-02-29', '2027-03-31', '2027-05-31', '2027-08-30', '2027-12-31', '2027-07-15', '2027-01-01']

  it.each(intervals)('agrees for %o', (iv) => {
    const id = Number(t.db.prepare(
      "INSERT INTO alert_rules (name, is_system, thresholds, interval_days, interval_months, end_of_month, created_at) VALUES (?, 0, '[]', ?, ?, ?, datetime('now'))"
    ).run(`r${JSON.stringify(iv)}`, iv.days || null, iv.months || null, iv.endOfMonth ? 1 : 0).lastInsertRowid)
    const stmt = t.db.prepare(`WITH c(value) AS (SELECT ?) SELECT ${effectiveDateSql('c.value', 'ar')} AS due FROM c, alert_rules ar WHERE ar.id = ?`)
    for (const date of dates) {
      const sql = (stmt.get(date, id) as { due: string }).due
      expect(sql, `${date} + ${JSON.stringify(iv)}`).toBe(add(date, iv))
    }
  })
})
