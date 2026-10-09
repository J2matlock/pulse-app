/**
 * Alert Color Resolution Tests — pure function, no DB or Electron needed.
 */
import { describe, it, expect } from 'vitest'
import { resolveAlertColor } from '../src/renderer/utils/alertColors'

describe('resolveAlertColor', () => {
  it('hex color returns inline style with 30% opacity', () => {
    const result = resolveAlertColor('#f87171')
    expect(result.className).toBe('')
    expect(result.style.backgroundColor).toBe('rgba(248, 113, 113, 0.3)')
  })

  it('different hex color computes correct rgba', () => {
    const result = resolveAlertColor('#3b82f6')
    expect(result.style.backgroundColor).toBe('rgba(59, 130, 246, 0.3)')
  })

  it('CSS class returns className with empty style', () => {
    const result = resolveAlertColor('alert-pulse')
    expect(result.className).toBe('alert-pulse')
    expect(result.style).toEqual({})
  })

  it('alert-pulse-dark class returned correctly', () => {
    const result = resolveAlertColor('alert-pulse-dark')
    expect(result.className).toBe('alert-pulse-dark')
    expect(result.style).toEqual({})
  })

  it('legacy alert-green class returned correctly', () => {
    const result = resolveAlertColor('alert-green')
    expect(result.className).toBe('alert-green')
    expect(result.style).toEqual({})
  })

  it('black (#000000) computes rgba(0, 0, 0, 0.3)', () => {
    const result = resolveAlertColor('#000000')
    expect(result.style.backgroundColor).toBe('rgba(0, 0, 0, 0.3)')
  })

  it('white (#ffffff) computes rgba(255, 255, 255, 0.3)', () => {
    const result = resolveAlertColor('#ffffff')
    expect(result.style.backgroundColor).toBe('rgba(255, 255, 255, 0.3)')
  })
})
