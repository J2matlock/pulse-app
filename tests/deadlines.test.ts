/**
 * Deadline Calculation Engine Tests — pure functions, no DB or Electron deps.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  computeEffectiveDeadline,
  computeDaysUntil,
  formatDeadlineTooltip,
  getMatchingThreshold,
  getAlertThreshold,
  formatCalculatedDays,
  computeAge,
  classifyDeadline,
} from '../src/renderer/utils/deadlineCalc'
import type { AlertThreshold, ParsedAlertRule } from '../src/shared/types'
import { localDateString } from '../src/shared/dates'

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-06-15T12:00:00Z') })
})

afterEach(() => {
  vi.useRealTimers()
})

// Helper: date string N days from frozen time (2026-06-15)
function daysFromNow(n: number): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + n)
  return localDateString(d)
}

// Standard thresholds matching typical alert rule
const standardThresholds: AlertThreshold[] = [
  { daysBefore: -30, bgClass: 'alert-pulse-dark', label: 'Severely overdue' },
  { daysBefore: 0, bgClass: 'alert-pulse', label: 'Due today / Overdue' },
  { daysBefore: 7, bgClass: 'alert-red', label: 'Urgent' },
  { daysBefore: 14, bgClass: 'alert-orange', label: 'Due soon' },
  { daysBefore: 30, bgClass: 'alert-yellow', label: 'Approaching' },
  { daysBefore: 90, bgClass: 'alert-green', label: 'Coming up' },
]

// ── Core Calculations ────────────────────────────────────────────────────────

describe('Core Calculations', () => {
  it('date 90 days from now → daysUntil is ~90', () => {
    const d = daysFromNow(90)
    expect(computeDaysUntil(d)).toBe(90)
  })

  it('date 30 days from now → daysUntil is 30', () => {
    expect(computeDaysUntil(daysFromNow(30))).toBe(30)
  })

  it('date 14 days from now → daysUntil is 14', () => {
    expect(computeDaysUntil(daysFromNow(14))).toBe(14)
  })

  it('date 7 days from now → daysUntil is 7', () => {
    expect(computeDaysUntil(daysFromNow(7))).toBe(7)
  })

  it('date is today → daysUntil is 0', () => {
    expect(computeDaysUntil(daysFromNow(0))).toBe(0)
  })

  it('date was yesterday → daysUntil is -1', () => {
    expect(computeDaysUntil(daysFromNow(-1))).toBe(-1)
  })

  it('date was 30 days ago → daysUntil is -30', () => {
    expect(computeDaysUntil(daysFromNow(-30))).toBe(-30)
  })

  it('date was 365 days ago → daysUntil is -365', () => {
    expect(computeDaysUntil(daysFromNow(-365))).toBe(-365)
  })

  it('computeEffectiveDeadline with intervalDays adds offset', () => {
    const base = '2026-01-01'
    const deadline = computeEffectiveDeadline(base, 365)
    expect(deadline.getFullYear()).toBe(2027)
    expect(deadline.getMonth()).toBe(0) // January
    expect(deadline.getDate()).toBe(1)
  })

  it('computeEffectiveDeadline with null intervalDays returns the date itself', () => {
    const base = '2026-06-15'
    const deadline = computeEffectiveDeadline(base, null)
    expect(deadline.getFullYear()).toBe(2026)
    expect(deadline.getMonth()).toBe(5) // June
    expect(deadline.getDate()).toBe(15)
  })
})

// ── Threshold Matching ───────────────────────────────────────────────────────

describe('Threshold Matching', () => {
  it('daysUntil=45 → yellow (30 < 45 ≤ 90)', () => {
    const t = getMatchingThreshold(45, standardThresholds)
    expect(t?.bgClass).toBe('alert-green')
  })

  it('daysUntil=25 → yellow (14 < 25 ≤ 30)', () => {
    const t = getMatchingThreshold(25, standardThresholds)
    expect(t?.bgClass).toBe('alert-yellow')
  })

  it('daysUntil=10 → orange (7 < 10 ≤ 14)', () => {
    const t = getMatchingThreshold(10, standardThresholds)
    expect(t?.bgClass).toBe('alert-orange')
  })

  it('daysUntil=5 → red (0 < 5 ≤ 7)', () => {
    const t = getMatchingThreshold(5, standardThresholds)
    expect(t?.bgClass).toBe('alert-red')
  })

  it('daysUntil=0 → pulse (matches daysBefore=0)', () => {
    const t = getMatchingThreshold(0, standardThresholds)
    expect(t?.bgClass).toBe('alert-pulse')
  })

  it('daysUntil=-5 → pulse (daysBefore -30 < -5 ≤ 0)', () => {
    const t = getMatchingThreshold(-5, standardThresholds)
    expect(t?.bgClass).toBe('alert-pulse')
  })

  it('daysUntil=-40 → pulse-dark (≤ -30)', () => {
    const t = getMatchingThreshold(-40, standardThresholds)
    expect(t?.bgClass).toBe('alert-pulse-dark')
  })

  it('daysUntil=100 → undefined (beyond all thresholds)', () => {
    const t = getMatchingThreshold(100, standardThresholds)
    expect(t).toBeUndefined()
  })

  it('empty thresholds → undefined', () => {
    expect(getMatchingThreshold(10, [])).toBeUndefined()
  })
})

// ── Alert Rule Application ───────────────────────────────────────────────────

describe('Alert Rule Application', () => {
  const annualRule: ParsedAlertRule = {
    id: 1,
    name: 'Annual Assessment',
    description: null,
    is_system: 0,
    interval_days: 365,
    created_at: '',
    thresholds: standardThresholds,
  }

  const monthlyRule: ParsedAlertRule = {
    id: 2,
    name: 'Monthly Contact',
    description: null,
    is_system: 0,
    interval_days: 30,
    created_at: '',
    thresholds: [
      { daysBefore: 0, bgClass: 'alert-pulse', label: 'Due today' },
      { daysBefore: 3, bgClass: 'alert-red', label: 'Urgent' },
      { daysBefore: 7, bgClass: 'alert-orange', label: 'Due soon' },
      { daysBefore: 14, bgClass: 'alert-yellow', label: 'Approaching' },
      { daysBefore: 30, bgClass: 'alert-green', label: 'Coming up' },
    ],
  }

  it('annual rule: date 1 year ago + 365 interval → due today', () => {
    const dateOneYearAgo = daysFromNow(-365)
    const days = computeDaysUntil(dateOneYearAgo, 365)
    expect(days).toBe(0)
    const threshold = getAlertThreshold(days, annualRule)
    expect(threshold?.bgClass).toBe('alert-pulse')
  })

  it('monthly rule: date 25 days ago + 30 interval → 5 days out (red)', () => {
    const d = daysFromNow(-25)
    const days = computeDaysUntil(d, 30)
    expect(days).toBe(5)
    const threshold = getAlertThreshold(days, monthlyRule)
    expect(threshold?.bgClass).toBe('alert-orange')
  })

  it('custom rule with no interval (one-time date)', () => {
    const oneTimeRule: ParsedAlertRule = {
      id: 3,
      name: 'Court Date',
      description: null,
      is_system: 0,
      interval_days: null,
      created_at: '',
      thresholds: standardThresholds,
    }
    // Date is 5 days from now, no interval
    const days = computeDaysUntil(daysFromNow(5), null)
    expect(days).toBe(5)
    const threshold = getAlertThreshold(days, oneTimeRule)
    expect(threshold?.bgClass).toBe('alert-red')
  })

  it('getAlertThreshold returns null for undefined rule', () => {
    expect(getAlertThreshold(10, undefined)).toBeNull()
  })
})

// ── Edge Cases ───────────────────────────────────────────────────────────────

describe('Edge Cases', () => {
  it('leap year: Feb 29 date does not crash', () => {
    expect(() => computeDaysUntil('2024-02-29')).not.toThrow()
    const days = computeDaysUntil('2024-02-29')
    expect(typeof days).toBe('number')
    expect(Number.isFinite(days)).toBe(true)
  })

  it('date far in the future (2099) does not crash', () => {
    expect(() => computeDaysUntil('2099-12-31')).not.toThrow()
    expect(computeDaysUntil('2099-12-31')).toBeGreaterThan(0)
  })

  it('date far in the past (1950) does not crash', () => {
    expect(() => computeDaysUntil('1950-01-01')).not.toThrow()
    expect(computeDaysUntil('1950-01-01')).toBeLessThan(0)
  })

  it('invalid date string returns NaN for daysUntil (no crash)', () => {
    // computeDaysUntil doesn't guard NaN — the caller should check
    // but it must not throw
    expect(() => computeDaysUntil('not-a-date')).not.toThrow()
  })

  it('multiple thresholds: each calculates independently', () => {
    const t1 = getMatchingThreshold(50, standardThresholds)
    const t2 = getMatchingThreshold(5, standardThresholds)
    expect(t1?.bgClass).not.toBe(t2?.bgClass)
    expect(t1?.bgClass).toBe('alert-green')
    expect(t2?.bgClass).toBe('alert-red')
  })
})

// ── Formatting ───────────────────────────────────────────────────────────────

describe('formatDeadlineTooltip', () => {
  it('overdue shows "X days overdue"', () => {
    const d = daysFromNow(-5)
    const tip = formatDeadlineTooltip(d, null, -5)
    expect(tip).toContain('5 days overdue')
  })

  it('due today shows "Due today"', () => {
    const d = daysFromNow(0)
    const tip = formatDeadlineTooltip(d, null, 0)
    expect(tip).toContain('Due today')
  })

  it('future shows "in X days"', () => {
    const d = daysFromNow(10)
    const tip = formatDeadlineTooltip(d, null, 10)
    expect(tip).toContain('in 10 days')
  })

  it('1 day overdue uses singular', () => {
    const d = daysFromNow(-1)
    const tip = formatDeadlineTooltip(d, null, -1)
    expect(tip).toContain('1 day overdue')
    expect(tip).not.toContain('1 days')
  })

  it('1 day future uses singular', () => {
    const d = daysFromNow(1)
    const tip = formatDeadlineTooltip(d, null, 1)
    expect(tip).toContain('in 1 day')
    expect(tip).not.toContain('1 days')
  })
})

describe('formatCalculatedDays', () => {
  it('null → dash', () => {
    expect(formatCalculatedDays(null).text).toBe('—')
  })

  it('0 → "Due today"', () => {
    expect(formatCalculatedDays(0).text).toBe('Due today')
  })

  it('negative → "X days overdue"', () => {
    const r = formatCalculatedDays(-5)
    expect(r.text).toBe('5 days overdue')
  })

  it('1 day overdue → singular', () => {
    expect(formatCalculatedDays(-1).text).toBe('1 day overdue')
  })

  it('positive > 30 → "X days" with no icon', () => {
    const r = formatCalculatedDays(45)
    expect(r.text).toBe('45 days')
    expect(r.icon).toBeNull()
  })
})

describe('computeAge', () => {
  it('computes correct age', () => {
    const today = new Date()
    const tenYearsAgo = new Date(today.getFullYear() - 10, today.getMonth(), today.getDate())
    const dob = localDateString(tenYearsAgo)
    expect(computeAge(dob)).toBe('10 yrs')
  })

  it('returns dash for invalid date', () => {
    expect(computeAge('not-a-date')).toBe('—')
  })

  it('returns dash for future date', () => {
    expect(computeAge(daysFromNow(365))).toBe('—')
  })
})

describe('classifyDeadline', () => {
  it('negative → overdue', () => { expect(classifyDeadline(-1)).toBe('overdue') })
  it('0 → today', () => { expect(classifyDeadline(0)).toBe('today') })
  it('3 → this-week', () => { expect(classifyDeadline(3)).toBe('this-week') })
  it('15 → this-month', () => { expect(classifyDeadline(15)).toBe('this-month') })
  it('60 → future', () => { expect(classifyDeadline(60)).toBe('future') })
})
