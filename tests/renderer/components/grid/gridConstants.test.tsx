// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'

import {
  ROW_HEIGHTS,
  HANDLE_WIDTH,
  PROFILE_BTN_WIDTH,
  HANDLE_STYLE,
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
    // Two 28px buttons 16px apart: each gets a 44px click area that doesn't overlap the other (Q-103, D-034)
    expect(PROFILE_BTN_WIDTH).toBe(88)
  })

  it('HANDLE_STYLE has width matching HANDLE_WIDTH', () => {
    expect(HANDLE_STYLE.width).toBe(HANDLE_WIDTH)
  })
})
