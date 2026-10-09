/**
 * alertColors.test.ts — Extended tests for resolveAlertColor.
 * Covers edge cases: invalid hex, empty string, unusual CSS classes, short hex.
 * (Complements the existing tests/alert-colors.test.ts)
 */
import { describe, it, expect } from 'vitest'
import { resolveAlertColor } from '../../../src/renderer/utils/alertColors'

describe('resolveAlertColor — edge cases', () => {
  it('returns fallback rgba for invalid hex (wrong length)', () => {
    const result = resolveAlertColor('#fff')
    // 3-char hex is not 6 digits, so hexToRgba falls back to slate gray
    expect(result.className).toBe('')
    expect(result.style.backgroundColor).toBe('rgba(148, 163, 184, 0.3)')
  })

  it('returns fallback rgba for malformed hex (non-hex chars)', () => {
    const result = resolveAlertColor('#zzzzzz')
    expect(result.style.backgroundColor).toBe('rgba(148, 163, 184, 0.3)')
  })

  it('handles hash with no digits', () => {
    const result = resolveAlertColor('#')
    expect(result.className).toBe('')
    expect(result.style.backgroundColor).toBe('rgba(148, 163, 184, 0.3)')
  })

  it('empty string treated as CSS class (not hex)', () => {
    const result = resolveAlertColor('')
    expect(result.className).toBe('')
    expect(result.style).toEqual({})
  })

  it('handles each standard alert class', () => {
    const classes = ['alert-green', 'alert-yellow', 'alert-orange', 'alert-red', 'alert-pulse', 'alert-pulse-dark']
    for (const cls of classes) {
      const result = resolveAlertColor(cls)
      expect(result.className).toBe(cls)
      expect(result.style).toEqual({})
    }
  })

  it('uppercase hex letters work correctly', () => {
    const result = resolveAlertColor('#FF0000')
    expect(result.style.backgroundColor).toBe('rgba(255, 0, 0, 0.3)')
  })

  it('mixed case hex works', () => {
    const result = resolveAlertColor('#aAbBcC')
    expect(result.style.backgroundColor).toBe('rgba(170, 187, 204, 0.3)')
  })

  it('arbitrary CSS class passed through', () => {
    const result = resolveAlertColor('custom-highlight-class')
    expect(result.className).toBe('custom-highlight-class')
    expect(result.style).toEqual({})
  })
})
