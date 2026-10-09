import { describe, it, expect, afterEach } from 'vitest'
import { localDateString, localDateFromToday, parseDbTimestamp } from '../src/shared/dates'

const originalTz = process.env.TZ
afterEach(() => { process.env.TZ = originalTz })

describe('localDateString', () => {
  it('uses the local calendar day, not UTC', () => {
    process.env.TZ = 'America/New_York'
    // 9:30 PM Eastern on Sep 30 is already Oct 1 in UTC
    expect(localDateString(new Date('2026-10-01T01:30:00Z'))).toBe('2026-09-30')
    process.env.TZ = 'Australia/Sydney'
    // Local midnight Sydney is the previous day in UTC
    expect(localDateString(new Date(2026, 2, 15))).toBe('2026-03-15')
  })

  it('localDateFromToday offsets by calendar days', () => {
    const today = new Date()
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
    expect(localDateFromToday(1)).toBe(localDateString(tomorrow))
    expect(localDateFromToday(0)).toBe(localDateString(today))
  })
})

describe('parseDbTimestamp', () => {
  it('reads SQLite datetime() values as UTC', () => {
    process.env.TZ = 'America/New_York'
    expect(parseDbTimestamp('2026-09-30 19:00:00').toISOString()).toBe('2026-09-30T19:00:00.000Z')
    expect(parseDbTimestamp('2026-09-30 19:00:00').getHours()).toBe(15)
  })

  it('passes through values that already carry a zone', () => {
    expect(parseDbTimestamp('2026-09-30T19:00:00.000Z').toISOString()).toBe('2026-09-30T19:00:00.000Z')
    expect(parseDbTimestamp('2026-09-30T19:00:00-04:00').toISOString()).toBe('2026-09-30T23:00:00.000Z')
  })
})
