// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'

import {
  ROW_HEIGHTS,
  HANDLE_WIDTH,
  PROFILE_BTN_WIDTH,
  OPEN_COL_WIDTH,
  STAR_COL_WIDTH,
  HANDLE_STYLE,
  frozenCountThatFits,
  headerFitWidth,
  MAX_AUTO_FIT_WIDTH,
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
    // The open and star buttons each have their own 44px column (Q-103, D-034)
    expect(OPEN_COL_WIDTH).toBe(44)
    expect(STAR_COL_WIDTH).toBe(44)
    expect(PROFILE_BTN_WIDTH).toBe(132)
  })

  it('HANDLE_STYLE has width matching HANDLE_WIDTH', () => {
    expect(HANDLE_STYLE.width).toBe(HANDLE_WIDTH)
  })
})

describe('kept-in-view columns and new column widths (UX-B-13, UX-B-29)', () => {
  const cols = [{ width: 200 }, { width: 200 }, { width: 200 }, { width: 200 }]
  it('keeps only as many columns in view as fit in the room', () => {
    // 100 lead + 200 + 200 = 500 fits in 600; a third would make 700
    expect(frozenCountThatFits(cols, 4, 100, 600)).toBe(2)
    expect(frozenCountThatFits(cols, 1, 100, 600)).toBe(1)
    expect(frozenCountThatFits(cols, 0, 100, 600)).toBe(0)
    expect(frozenCountThatFits(cols, 3, 100, 250)).toBe(0)
  })
  it('a header fits its name, up to the auto-fit limit', () => {
    expect(headerFitWidth('Housing status')).toBeGreaterThan(headerFitWidth('Age'))
    expect(headerFitWidth('x'.repeat(200))).toBe(MAX_AUTO_FIT_WIDTH)
  })
})
