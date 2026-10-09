/**
 * Deadline engine v2, interval kind (W05 commit 1): unit cases, a property
 * test against addInterval, and parity with today's SQL (effectiveDateSql)
 * over a fixture of dates × rules — the engine must agree with what the
 * dashboard, planner, calendar export and reports compute now.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestDb, cleanupTestDb, type TestDb } from './helpers'
import { evaluate, toYmd, daysBetween, dateToYmd, ymdToDate, type EngineRule } from '../src/shared/deadlineEngine'
import { addInterval, toRuleInterval, type RuleInterval } from '../src/shared/ruleInterval'
import { effectiveDateSql } from './legacyDeadlineSql'

const rule = (interval: Partial<RuleInterval> = {}): EngineRule => ({
  id: 1, kind: 'interval', interval: { days: 0, months: 0, endOfMonth: false, ...interval }, config: null, condition: null, businessDays: false,
})
const due = (date: string | null, iv: Partial<RuleInterval>, today = '2026-10-02') => evaluate(rule(iv), { today, columnDate: date })

describe('interval rules', () => {
  it('adds days, months and years calendar-correctly', () => {
    expect(due('2026-03-01', { days: 30 }).due).toBe('2026-03-31')
    expect(due('2026-01-31', { months: 1 }).due).toBe('2026-02-28')
    expect(due('2024-01-31', { months: 1 }).due).toBe('2024-02-29')
    expect(due('2024-02-29', { months: 12 }).due).toBe('2025-02-28')
    expect(due('2026-03-10', { months: 1, endOfMonth: true }).due).toBe('2026-04-30')
    expect(due('2026-03-10', {}).due).toBe('2026-03-10')
  })

  it('reports days until and a state', () => {
    expect(due('2026-10-02', {})).toMatchObject({ state: 'due', daysUntil: 0 })
    expect(due('2026-10-01', {})).toMatchObject({ state: 'overdue', daysUntil: -1 })
    expect(due('2026-10-09', {})).toMatchObject({ state: 'soon', daysUntil: 7 })
    expect(due('2026-10-10', {})).toMatchObject({ state: 'ok', daysUntil: 8 })
  })

  it('has nothing due without a usable date', () => {
    expect(due(null, { days: 30 })).toMatchObject({ due: null, state: 'none' })
    expect(due('', { days: 30 }).due).toBeNull()
    expect(due('03/01/2026', { days: 30 }).due).toBeNull()
    expect(due('2026-02-31', { days: 30 }).due).toBeNull()
    expect(due('2026-03-01T14:30:00', { days: 1 }).due).toBe('2026-03-02')
  })

  it('explains itself', () => {
    expect(due('2026-03-03', { months: 6 }).detail).toBe('Due Sep 3, 2026 (every 6 months, from Mar 3, 2026)')
    expect(due('2026-03-03', {}).detail).toBe('Due Mar 3, 2026')
  })

  it('counts days across daylight-saving changes', () => {
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2)
    expect(daysBetween('2026-11-02', '2026-10-31')).toBe(-2)
  })
})

describe('property: interval kind equals addInterval', () => {
  it('for a few thousand random dates and intervals', () => {
    let seed = 42
    const rand = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n }
    for (let i = 0; i < 3000; i++) {
      const d = new Date(2015 + rand(20), rand(12), 1 + rand(31))
      const ymd = dateToYmd(d)
      const iv: RuleInterval = rand(2) ? { days: 0, months: 1 + rand(36), endOfMonth: rand(4) === 0 } : { days: rand(400), months: 0, endOfMonth: rand(4) === 0 }
      expect(due(ymd, iv).due).toBe(dateToYmd(addInterval(ymdToDate(ymd), iv)))
    }
  })
})

describe('parity with today\'s SQL (effectiveDateSql)', () => {
  let t: TestDb
  beforeAll(() => { t = createTestDb() })
  afterAll(() => cleanupTestDb(t))

  it('agrees on every date × rule in the fixture', () => {
    const dates: string[] = []
    for (let y = 2023; y <= 2028; y++) for (let m = 1; m <= 12; m++) for (const d of [1, 15, 28, 29, 30, 31]) {
      const ymd = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      if (toYmd(ymd)) dates.push(ymd)
    }
    const rules = [
      { interval_days: 0, interval_months: 0, end_of_month: 0 },
      { interval_days: 7, interval_months: 0, end_of_month: 0 },
      { interval_days: 30, interval_months: 0, end_of_month: 0 },
      { interval_days: 90, interval_months: 0, end_of_month: 1 },
      { interval_days: 365, interval_months: 0, end_of_month: 0 },
      { interval_days: 0, interval_months: 1, end_of_month: 0 },
      { interval_days: 0, interval_months: 3, end_of_month: 1 },
      { interval_days: 0, interval_months: 6, end_of_month: 0 },
      { interval_days: 0, interval_months: 12, end_of_month: 0 },
      { interval_days: 0, interval_months: 24, end_of_month: 1 },
      { interval_days: null, interval_months: null, end_of_month: null },
    ]
    const stmt = t.db.prepare(`SELECT ${effectiveDateSql('v.value', 'ar')} AS due FROM (SELECT ? AS value) v, (SELECT ? AS interval_days, ? AS interval_months, ? AS end_of_month) ar`)
    let compared = 0
    for (const r of rules) {
      const iv = toRuleInterval(r)
      for (const d of dates) {
        const sql = (stmt.get(d, r.interval_days, r.interval_months, r.end_of_month) as { due: string | null }).due
        expect({ d, r, due: due(d, iv).due }).toEqual({ d, r, due: sql })
        compared++
      }
    }
    expect(compared).toBeGreaterThan(3000)
  })
})
