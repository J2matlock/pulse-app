// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'

import {
  ROW_HEIGHTS,
  HANDLE_WIDTH,
  PROFILE_BTN_WIDTH,
  HANDLE_STYLE,
  alertShapeForThreshold,
} from '../../../../src/renderer/components/grid/gridConstants'
import { setWords } from '../../vocabFixture'

beforeEach(() => { setWords() })

describe('gridConstants', () => {
  it('exports ROW_HEIGHTS with expected keys', () => {
    expect(ROW_HEIGHTS).toHaveProperty('compact')
    expect(ROW_HEIGHTS).toHaveProperty('comfortable')
    expect(ROW_HEIGHTS).toHaveProperty('spacious')
    expect(ROW_HEIGHTS.compact).toBe(44)
    expect(ROW_HEIGHTS.spacious).toBe(52)
  })

  it('exports HANDLE_WIDTH and PROFILE_BTN_WIDTH as numbers', () => {
    expect(typeof HANDLE_WIDTH).toBe('number')
    expect(typeof PROFILE_BTN_WIDTH).toBe('number')
    expect(HANDLE_WIDTH).toBe(32)
    expect(PROFILE_BTN_WIDTH).toBe(32)
  })

  it('HANDLE_STYLE has width matching HANDLE_WIDTH', () => {
    expect(HANDLE_STYLE.width).toBe(HANDLE_WIDTH)
  })

  it('alertShapeForThreshold returns null for green/safe', () => {
    expect(alertShapeForThreshold('alert-green', 30)).toBeNull()
  })

  it('alertShapeForThreshold returns JSX for alert-red', () => {
    const result = alertShapeForThreshold('alert-red', 2)
    expect(result).not.toBeNull()
  })

  it('alertShapeForThreshold returns JSX for alert-pulse', () => {
    const result = alertShapeForThreshold('alert-pulse', -5)
    expect(result).not.toBeNull()
  })

  it('alertShapeForThreshold returns JSX for alert-orange', () => {
    const result = alertShapeForThreshold('alert-orange', 7)
    expect(result).not.toBeNull()
  })
})
