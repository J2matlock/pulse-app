/**
 * Fuzzy Match Scoring Tests — pure function, no deps.
 * The command palette's fuzzyMatch (it used to test a copy of it).
 */
import { describe, it, expect } from 'vitest'

import { fuzzyMatch } from '../src/renderer/hooks/useCommandSearch'

describe('fuzzyMatch', () => {
  it('empty query returns 1 (matches everything)', () => {
    expect(fuzzyMatch('', 'anything')).toBe(1)
    expect(fuzzyMatch('', '')).toBe(1)
  })

  it('exact prefix match gets prefix bonus (+5)', () => {
    const score = fuzzyMatch('abc', 'abcdef')
    // First char: 1 + 0*2 + 5 (prefix) = 6
    // Second char: 1 + 1*2 = 3
    // Third char: 1 + 2*2 = 5
    expect(score).toBe(14)
  })

  it('consecutive chars get bonus (+2 per consecutive)', () => {
    const consecutive = fuzzyMatch('abc', 'xabcx')
    const scattered = fuzzyMatch('abc', 'xaxbxc')
    expect(consecutive).toBeGreaterThan(scattered)
  })

  it('non-matching returns 0', () => {
    expect(fuzzyMatch('xyz', 'abcdef')).toBe(0)
    expect(fuzzyMatch('zyx', 'abc')).toBe(0)
  })

  it('case-insensitive matching', () => {
    expect(fuzzyMatch('ABC', 'abcdef')).toBeGreaterThan(0)
    expect(fuzzyMatch('abc', 'ABCDEF')).toBeGreaterThan(0)
    expect(fuzzyMatch('AbC', 'aBcDeF')).toBeGreaterThan(0)
  })

  it('partial match scores less than full match', () => {
    const full = fuzzyMatch('abcdef', 'abcdef')
    const partial = fuzzyMatch('abc', 'abcdef')
    expect(full).toBeGreaterThan(partial)
  })

  it('scoring order: "abc" scores higher for "abcdef" than "aXbXc"', () => {
    const consecutive = fuzzyMatch('abc', 'abcdef')
    const scattered = fuzzyMatch('abc', 'aXbXc')
    expect(consecutive).toBeGreaterThan(scattered)
  })

  it('query longer than text returns 0', () => {
    expect(fuzzyMatch('abcdef', 'abc')).toBe(0)
  })

  it('single char match works', () => {
    expect(fuzzyMatch('a', 'apple')).toBeGreaterThan(0)
    expect(fuzzyMatch('z', 'apple')).toBe(0)
  })

  it('prefix match scores higher than mid-string match', () => {
    const prefix = fuzzyMatch('set', 'settings')
    const midString = fuzzyMatch('set', 'preset')
    expect(prefix).toBeGreaterThan(midString)
  })
})
