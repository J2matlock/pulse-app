/**
 * deadlineCalc.test.ts — Pure deadline computation tests.
 */
import { describe, it, expect } from 'vitest'
import {
  computeEffectiveDeadline,
  computeDaysUntil,
  formatCalculatedDays,
  formatDeadlineTooltip,
  formatResultTooltip,
  getMatchingThreshold,
  classifyDeadline,
  computeAge,
} from '../../../src/renderer/utils/deadlineCalc'
import type { AlertThreshold, Column, ParsedAlertRule } from '../../../src/shared/types'

function dateString(offsetDays: number): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + offsetDays)
  // Use local date components to avoid UTC timezone shift
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

describe('computeEffectiveDeadline', () => {
  it('returns same date when no interval', () => {
    const result = computeEffectiveDeadline('2026-06-15')
    expect(result.getFullYear()).toBe(2026)
    expect(result.getMonth()).toBe(5) // June = 5
    expect(result.getDate()).toBe(15)
  })

  it('adds interval days to base date', () => {
    const result = computeEffectiveDeadline('2026-01-01', 30)
    expect(result.getMonth()).toBe(0)
    expect(result.getDate()).toBe(31)
  })

  it('handles null interval as 0', () => {
    const result = computeEffectiveDeadline('2026-06-15', null)
    expect(result.getDate()).toBe(15)
  })

  it('handles ISO datetime strings', () => {
    const result = computeEffectiveDeadline('2026-06-15T14:30:00')
    expect(result.getDate()).toBe(15)
    expect(result.getHours()).toBe(0) // normalized to midnight
  })
})

describe('computeDaysUntil', () => {
  it('returns 0 for today', () => {
    expect(computeDaysUntil(dateString(0))).toBe(0)
  })

  it('returns positive for future dates', () => {
    expect(computeDaysUntil(dateString(10))).toBe(10)
  })

  it('returns negative for past dates', () => {
    expect(computeDaysUntil(dateString(-5))).toBe(-5)
  })

  it('adds interval days before computing', () => {
    // Today + 10 day interval = 10 days from now
    expect(computeDaysUntil(dateString(0), 10)).toBe(10)
  })
})

describe('formatCalculatedDays', () => {
  it('returns dash for null', () => {
    const result = formatCalculatedDays(null)
    expect(result.text).toBe('—')
    expect(result.icon).toBeNull()
  })

  it('far future (>30 days) has no icon', () => {
    const result = formatCalculatedDays(45)
    expect(result.text).toBe('45 days')
    expect(result.icon).toBeNull()
    expect(result.colorClass).toBe('')
  })

  it('approaching (8-30 days) shows calendar icon', () => {
    const result = formatCalculatedDays(15)
    expect(result.text).toBe('15 days')
    expect(result.icon).toBeTruthy()
  })

  it('imminent (1-7 days) is orange', () => {
    const result = formatCalculatedDays(3)
    expect(result.text).toBe('3 days')
    expect(result.colorClass).toContain('orange')
  })

  it('due today is red with warning', () => {
    const result = formatCalculatedDays(0)
    expect(result.text).toBe('Due today')
    expect(result.colorClass).toContain('red')
    expect(result.colorClass).toContain('font-semibold')
  })

  it('recently overdue (-1 to -7) shows "X days overdue"', () => {
    const result = formatCalculatedDays(-3)
    expect(result.text).toBe('3 days overdue')
    expect(result.colorClass).toContain('red')
  })

  it('1 day overdue is singular', () => {
    const result = formatCalculatedDays(-1)
    expect(result.text).toBe('1 day overdue')
  })

  it('very overdue (<-30) is bold red with red circle', () => {
    const result = formatCalculatedDays(-45)
    expect(result.text).toBe('45 days overdue')
    expect(result.colorClass).toContain('font-bold')
  })
})

describe('formatDeadlineTooltip', () => {
  it('shows "Due today" for daysUntil=0', () => {
    const tooltip = formatDeadlineTooltip(dateString(0), null, 0)
    expect(tooltip).toContain('Due today')
  })

  it('shows "X days overdue" for negative', () => {
    const tooltip = formatDeadlineTooltip(dateString(-5), null, -5)
    expect(tooltip).toContain('5 days overdue')
  })

  it('shows "in X days" for positive', () => {
    const tooltip = formatDeadlineTooltip(dateString(10), null, 10)
    expect(tooltip).toContain('in 10 days')
  })

  it('singular for 1 day', () => {
    const tooltip = formatDeadlineTooltip(dateString(1), null, 1)
    expect(tooltip).toContain('in 1 day')
    expect(tooltip).not.toContain('days')
  })
})

describe('formatResultTooltip', () => {
  it('says a used-up allowance is used up, not "Due today"', () => {
    const tip = formatResultTooltip({ due: '2026-12-31', state: 'overdue', daysUntil: 0, estimated: false, label: 'All 12 used', detail: '' })
    expect(tip).toBe('All 12 used · ends Dec 31, 2026')
  })
})

describe('getMatchingThreshold', () => {
  const thresholds: AlertThreshold[] = [
    { daysBefore: -30, bgClass: 'alert-pulse-dark', label: 'Severely overdue' },
    { daysBefore: 0, bgClass: 'alert-pulse', label: 'Overdue' },
    { daysBefore: 14, bgClass: 'alert-red', label: 'Due soon' },
    { daysBefore: 30, bgClass: 'alert-orange', label: 'Approaching' },
    { daysBefore: 60, bgClass: 'alert-yellow', label: 'Coming up' },
    { daysBefore: 90, bgClass: 'alert-green', label: 'On track' },
  ]

  it('returns undefined for empty thresholds', () => {
    expect(getMatchingThreshold(10, [])).toBeUndefined()
  })

  it('returns undefined when beyond all thresholds', () => {
    expect(getMatchingThreshold(100, thresholds)).toBeUndefined()
  })

  it('matches green for 80 days out', () => {
    const result = getMatchingThreshold(80, thresholds)
    expect(result?.bgClass).toBe('alert-green')
  })

  it('matches yellow for 45 days out', () => {
    const result = getMatchingThreshold(45, thresholds)
    expect(result?.bgClass).toBe('alert-yellow')
  })

  it('matches red for 10 days out', () => {
    const result = getMatchingThreshold(10, thresholds)
    expect(result?.bgClass).toBe('alert-red')
  })

  it('matches pulse for 0 (due today)', () => {
    const result = getMatchingThreshold(0, thresholds)
    expect(result?.bgClass).toBe('alert-pulse')
  })

  it('matches pulse for -5 (5 days overdue)', () => {
    const result = getMatchingThreshold(-5, thresholds)
    expect(result?.bgClass).toBe('alert-pulse')
  })

  it('matches pulse-dark for -40 (severely overdue)', () => {
    const result = getMatchingThreshold(-40, thresholds)
    expect(result?.bgClass).toBe('alert-pulse-dark')
  })
})

describe('classifyDeadline', () => {
  it('negative = overdue', () => expect(classifyDeadline(-1)).toBe('overdue'))
  it('0 = today', () => expect(classifyDeadline(0)).toBe('today'))
  it('1-7 = this-week', () => {
    expect(classifyDeadline(1)).toBe('this-week')
    expect(classifyDeadline(7)).toBe('this-week')
  })
  it('8-30 = this-month', () => {
    expect(classifyDeadline(8)).toBe('this-month')
    expect(classifyDeadline(30)).toBe('this-month')
  })
  it('31+ = future', () => expect(classifyDeadline(31)).toBe('future'))
})

describe('computeAge', () => {
  it('returns age in years', () => {
    const tenYearsAgo = new Date()
    tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10)
    tenYearsAgo.setMonth(0)
    tenYearsAgo.setDate(1)
    const dob = tenYearsAgo.toISOString().split('T')[0]!
    const result = computeAge(dob)
    expect(result).toMatch(/^\d+ yrs$/)
    // Should be 10 (or close depending on current month)
    const age = parseInt(result)
    expect(age).toBeGreaterThanOrEqual(9)
    expect(age).toBeLessThanOrEqual(10)
  })

  it('returns dash for invalid date', () => {
    expect(computeAge('not-a-date')).toBe('—')
  })
})

describe('evaluateRuleForRow with a blank condition column (persona study R4)', () => {
  it('counts it, names the column, and agrees with the shared engine', async () => {
    const { evaluateRuleForRow } = await import('../../../src/renderer/utils/deadlineCalc')
    const { useGridStore } = await import('../../../src/renderer/stores/gridStore')
    const { evaluate, engineRuleFrom } = await import('../../../src/shared/deadlineEngine')
    const rule = {
      id: 7, name: 'Background check', thresholds: [], interval_days: 0, interval_months: 24, end_of_month: 0,
      kind: 'interval', rule_config: null, business_days: 0,
      rule_condition: JSON.stringify({ columnId: 12, op: 'is', values: ['Yes'], whenFalse: 'hide' }),
    } as unknown as ParsedAlertRule
    useGridStore.setState({ columns: [], hiddenColumns: [{ id: 12, name: 'Needs background check' } as unknown as Column] })
    const stored = dateString(-720)
    const res = evaluateRuleForRow(rule, stored, { row_id: 1, col_12: '' }, 3)
    const engine = evaluate(engineRuleFrom(rule), { today: dateString(0), columnDate: stored, values: { 12: '' } })
    expect(res.due).toBe(engine.due)
    expect(res.state).toBe(engine.state)
    expect(res.due).not.toBeNull()
    expect(res.detail).toMatch(/Counted because Needs background check is blank$/)
    expect(evaluateRuleForRow(rule, stored, { row_id: 1, col_12: 'No' }, 3).due).toBeNull()
  })
})
