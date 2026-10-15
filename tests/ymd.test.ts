import { describe, it, expect } from 'vitest'
import { normalizeTwoDigitYear, isCompleteDate, toYmd, TWO_DIGIT_CENTURY_SPLIT } from '../src/shared/ymd'

describe('normalizeTwoDigitYear (persona study D1: 7/15/26 showed as 07/15/0026)', () => {
  it('reads a two-digit year as 20yy', () => {
    expect(normalizeTwoDigitYear('0026-07-15')).toBe('2026-07-15')
    expect(normalizeTwoDigitYear('0000-01-01')).toBe('2000-01-01')
    expect(normalizeTwoDigitYear('0005-12-31')).toBe('2005-12-31')
    expect(normalizeTwoDigitYear(`00${TWO_DIGIT_CENTURY_SPLIT - 1}-03-02`)).toBe(`20${TWO_DIGIT_CENTURY_SPLIT - 1}-03-02`)
  })

  it('reads a birth year like 54 as 1954', () => {
    expect(normalizeTwoDigitYear('0054-03-02')).toBe('1954-03-02')
    expect(normalizeTwoDigitYear(`00${TWO_DIGIT_CENTURY_SPLIT}-03-02`)).toBe(`19${TWO_DIGIT_CENTURY_SPLIT}-03-02`)
    expect(normalizeTwoDigitYear('0099-06-30')).toBe('1999-06-30')
  })

  it('never changes a year typed in full, or anything that is not a date', () => {
    for (const v of ['2026-07-15', '1954-03-02', '0202-07-15', '1850-01-01', '', 'TBD', '2026-07-15T10:00']) {
      expect(normalizeTwoDigitYear(v)).toBe(v)
    }
  })

  it('keeps the month and day exactly, leap days included', () => {
    expect(normalizeTwoDigitYear('0024-02-29')).toBe('2024-02-29')
    expect(toYmd(normalizeTwoDigitYear('0024-02-29'))).toBe('2024-02-29')
    expect(normalizeTwoDigitYear('0084-02-29')).toBe('1984-02-29')
  })
})

describe('isCompleteDate', () => {
  it('is true only for a whole, real date the browser accepts', () => {
    expect(isCompleteDate('2026-03-11', false)).toBe(true)
    expect(isCompleteDate('2026-03-11', true)).toBe(false)
    expect(isCompleteDate('', true)).toBe(false)
    expect(isCompleteDate('', false)).toBe(false)
    expect(isCompleteDate(null, false)).toBe(false)
    expect(isCompleteDate('2026-02-30', false)).toBe(false)
    expect(isCompleteDate('0026-07-15', false)).toBe(false)
    expect(isCompleteDate('2026-07-15T10:00', false)).toBe(false)
  })
})
