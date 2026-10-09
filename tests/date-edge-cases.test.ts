/**
 * Date Edge Cases — extends deadlines.test.ts with boundary conditions.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  computeEffectiveDeadline,
  computeDaysUntil,
  computeAge,
  classifyDeadline,
  formatCalculatedDays,
} from '../src/renderer/utils/deadlineCalc'
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

describe('Date Edge Cases', () => {
  it('leap year date (Feb 29) for deadline calc', () => {
    // 2024 is a leap year
    const deadline = computeEffectiveDeadline('2024-02-29', 0)
    expect(deadline.getMonth()).toBe(1) // February (0-indexed)
    expect(deadline.getDate()).toBe(29)
  })

  it('leap year + interval crossing year boundary', () => {
    const deadline = computeEffectiveDeadline('2024-02-29', 365)
    // 2025-02-28 or 2025-03-01 depending on Date arithmetic
    expect(deadline.getFullYear()).toBe(2025)
  })

  it('year boundary (Dec 31 → Jan 1)', () => {
    const deadline = computeEffectiveDeadline('2024-12-31', 1)
    expect(deadline.getFullYear()).toBe(2025)
    expect(deadline.getMonth()).toBe(0)
    expect(deadline.getDate()).toBe(1)
  })

  it('far future dates (2099)', () => {
    const deadline = computeEffectiveDeadline('2099-12-31', 0)
    expect(deadline.getFullYear()).toBe(2099)
    expect(deadline.getMonth()).toBe(11)
    expect(deadline.getDate()).toBe(31)
  })

  it('far future date with large interval', () => {
    const deadline = computeEffectiveDeadline('2099-01-01', 365)
    // 2099-01-01 + 365 days = 2100-01-01
    expect(deadline.getFullYear()).toBe(2100)
    expect(deadline.getMonth()).toBe(0)
    expect(deadline.getDate()).toBe(1)
  })

  it('timezone-free comparison: all dates are YYYY-MM-DD strings', () => {
    // computeEffectiveDeadline adds T00:00:00 to avoid timezone shifts
    const d1 = computeEffectiveDeadline('2024-06-15', 0)
    const d2 = computeEffectiveDeadline('2024-06-15', 0)
    expect(d1.getTime()).toBe(d2.getTime())
    expect(d1.getHours()).toBe(0)
  })

  it('computeAge for exact birthday (0 years)', () => {
    const today = new Date()
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    expect(computeAge(todayStr)).toBe('0 yrs')
  })

  it('computeAge for yesterday (0 years)', () => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const str = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`
    expect(computeAge(str)).toBe('0 yrs')
  })

  it('computeAge for future date returns dash', () => {
    const future = new Date()
    future.setFullYear(future.getFullYear() + 1)
    const str = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`
    expect(computeAge(str)).toBe('—')
  })

  it('computeAge for invalid date returns dash', () => {
    expect(computeAge('not-a-date')).toBe('—')
    expect(computeAge('')).toBe('—')
  })

  it('classifyDeadline boundaries: exactly 0', () => {
    expect(classifyDeadline(0)).toBe('today')
  })

  it('classifyDeadline boundaries: exactly 7', () => {
    expect(classifyDeadline(7)).toBe('this-week')
  })

  it('classifyDeadline boundaries: exactly 30', () => {
    expect(classifyDeadline(30)).toBe('this-month')
  })

  it('classifyDeadline boundaries: exactly -1', () => {
    expect(classifyDeadline(-1)).toBe('overdue')
  })

  it('classifyDeadline boundaries: exactly 31', () => {
    expect(classifyDeadline(31)).toBe('future')
  })

  it('classifyDeadline boundaries: exactly 8', () => {
    expect(classifyDeadline(8)).toBe('this-month')
  })

  it('formatCalculatedDays for null returns dash', () => {
    const result = formatCalculatedDays(null)
    expect(result.text).toBe('—')
  })

  it('formatCalculatedDays for 0 returns "Due today"', () => {
    const result = formatCalculatedDays(0)
    expect(result.text).toBe('Due today')
  })

  it('formatCalculatedDays for -1 returns "1 day overdue"', () => {
    const result = formatCalculatedDays(-1)
    expect(result.text).toBe('1 day overdue')
  })

  it('formatCalculatedDays for -5 returns "5 days overdue"', () => {
    const result = formatCalculatedDays(-5)
    expect(result.text).toBe('5 days overdue')
  })

  it('computeDaysUntil for today returns 0', () => {
    expect(computeDaysUntil(daysFromNow(0))).toBe(0)
  })

  it('computeDaysUntil for yesterday returns -1', () => {
    expect(computeDaysUntil(daysFromNow(-1))).toBe(-1)
  })

  it('computeDaysUntil with interval adds days', () => {
    const today = daysFromNow(0)
    expect(computeDaysUntil(today, 7)).toBe(7)
  })

  it('computeDaysUntil with null interval treated as 0', () => {
    const today = daysFromNow(0)
    expect(computeDaysUntil(today, null)).toBe(0)
  })
})
