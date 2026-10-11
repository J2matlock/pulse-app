import { describe, it, expect } from 'vitest'
import { periodRange, daysLeft } from '../src/shared/periods'
import { ymdToDate } from '../src/shared/ymd'

const d = (ymd: string) => ymdToDate(ymd)

describe('periodRange', () => {
  it('finds the week for Sunday and Monday starts', () => {
    expect(periodRange('week', d('2026-10-07'), 'sunday')).toMatchObject({ start: '2026-10-04', end: '2026-10-10', label: 'Week of Oct 4' })
    expect(periodRange('week', d('2026-10-04'), 'monday')).toMatchObject({ start: '2026-09-28', end: '2026-10-04' })
    expect(periodRange('week', d('2026-10-05'), 'monday').start).toBe('2026-10-05')
  })

  it('handles weeks across a year boundary', () => {
    const w = periodRange('week', d('2027-01-01'), 'monday')
    expect(w).toMatchObject({ start: '2026-12-28', end: '2027-01-03', key: '2026-W53' })
    expect(periodRange('week', d('2026-01-01'), 'monday')).toMatchObject({ start: '2025-12-29', key: '2026-W01' })
  })

  it('gives months, quarters and years', () => {
    expect(periodRange('month', d('2024-02-10'))).toMatchObject({ start: '2024-02-01', end: '2024-02-29', key: '2024-02', label: 'February 2024' })
    expect(periodRange('quarter', d('2026-11-30'))).toMatchObject({ start: '2026-10-01', end: '2026-12-31', key: '2026-Q4', label: 'Q4 2026' })
    expect(periodRange('quarter', d('2026-01-01')).key).toBe('2026-Q1')
    expect(periodRange('year', d('2026-06-15'))).toMatchObject({ start: '2026-01-01', end: '2026-12-31', key: '2026' })
  })

  it('counts days left, 0 on the last day', () => {
    expect(daysLeft(periodRange('month', d('2026-10-02')), d('2026-10-02'))).toBe(29)
    expect(daysLeft(periodRange('month', d('2026-10-31')), d('2026-10-31'))).toBe(0)
  })
})
