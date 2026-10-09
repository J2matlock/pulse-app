import { describe, it, expect } from 'vitest'
import { normalizeAutoLockMinutes, AUTO_LOCK_DEFAULT_MINUTES, AUTO_LOCK_MAX_MINUTES } from '../src/shared/constants'

describe('normalizeAutoLockMinutes', () => {
  it('keeps valid choices', () => {
    for (const m of [5, 15, 30, 60, 120]) expect(normalizeAutoLockMinutes(String(m))).toBe(m)
  })
  it('turns the old "Never" (0) into the longest option instead of no lock', () => {
    expect(normalizeAutoLockMinutes('0')).toBe(AUTO_LOCK_MAX_MINUTES)
    expect(normalizeAutoLockMinutes(0)).toBe(AUTO_LOCK_MAX_MINUTES)
  })
  it('caps very long values and defaults garbage', () => {
    expect(normalizeAutoLockMinutes('9999')).toBe(AUTO_LOCK_MAX_MINUTES)
    expect(normalizeAutoLockMinutes('abc')).toBe(AUTO_LOCK_DEFAULT_MINUTES)
    expect(normalizeAutoLockMinutes(undefined)).toBe(AUTO_LOCK_DEFAULT_MINUTES)
  })
})
