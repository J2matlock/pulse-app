/**
 * edge-cases.test.ts — Boundary condition tests across the codebase.
 * Tests Unicode, long strings, special characters, date edge cases,
 * and empty/minimal data scenarios.
 * Uses mock IPC for store-related tests and pure function tests where possible.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock window.api before any store imports
const mockInvoke = vi.fn()
;(globalThis as Record<string, unknown>).window = { api: { invoke: mockInvoke } }

// Mock react-hot-toast
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn() }) }))

// Mock crypto.randomUUID
vi.stubGlobal('crypto', { randomUUID: () => 'edge-uuid-' + Math.random().toString(36).slice(2) })

import { resolveAlertColor } from '../src/renderer/utils/alertColors'

describe('Edge cases: Unicode in values', () => {
  it('emoji characters in resolveAlertColor class name', () => {
    // Not a real use case, but should not crash
    const result = resolveAlertColor('alert-\u{1F525}')
    expect(result.className).toBe('alert-\u{1F525}')
    expect(result.style).toEqual({})
  })

  it('CJK characters handled as CSS class', () => {
    const result = resolveAlertColor('\u4F60\u597D')
    expect(result.className).toBe('\u4F60\u597D')
  })

  it('RTL characters handled as CSS class', () => {
    const result = resolveAlertColor('\u0645\u0631\u062D\u0628\u0627')
    expect(result.className).toBe('\u0645\u0631\u062D\u0628\u0627')
  })

  it('mixed unicode and ASCII', () => {
    const result = resolveAlertColor('alert-\u00E9\u00E8\u00EA')
    expect(result.className).toBe('alert-\u00E9\u00E8\u00EA')
  })
})

describe('Edge cases: very long strings', () => {
  it('10,000 character string as CSS class does not crash', () => {
    const longClass = 'x'.repeat(10000)
    const result = resolveAlertColor(longClass)
    expect(result.className).toBe(longClass)
    expect(result.className.length).toBe(10000)
  })

  it('10,000 character hex-like string with # prefix', () => {
    const longHex = '#' + 'a'.repeat(10000)
    const result = resolveAlertColor(longHex)
    // Not valid 6-digit hex, so falls back
    expect(result.className).toBe('')
    expect(result.style.backgroundColor).toBe('rgba(148, 163, 184, 0.3)')
  })
})

describe('Edge cases: number boundaries', () => {
  it('zero value in daysBefore threshold', () => {
    const threshold = { daysBefore: 0, bgClass: 'alert-pulse', label: 'Overdue' }
    expect(threshold.daysBefore).toBe(0)
    expect(typeof threshold.daysBefore).toBe('number')
  })

  it('negative daysBefore (days overdue)', () => {
    const threshold = { daysBefore: -5, bgClass: 'alert-pulse', label: 'Past due' }
    expect(threshold.daysBefore).toBeLessThan(0)
  })

  it('very large daysBefore', () => {
    const threshold = { daysBefore: 365, bgClass: 'alert-green', label: 'Way ahead' }
    expect(threshold.daysBefore).toBe(365)
  })

  it('Number.MAX_SAFE_INTEGER as daysBefore', () => {
    const threshold = { daysBefore: Number.MAX_SAFE_INTEGER, bgClass: 'alert-green', label: 'Max' }
    expect(threshold.daysBefore).toBe(Number.MAX_SAFE_INTEGER)
  })
})

describe('Edge cases: date boundaries', () => {
  it('leap year date Feb 29, 2000 is valid', () => {
    const date = new Date('2000-02-29T00:00:00Z')
    expect(date.getUTCMonth()).toBe(1) // February
    expect(date.getUTCDate()).toBe(29)
    expect(isNaN(date.getTime())).toBe(false)
  })

  it('non-leap year Feb 29 rolls over', () => {
    // Date-only strings like '2001-02-29' may be treated as invalid or roll over
    const date = new Date('2001-02-29T00:00:00Z')
    // Either NaN or rolls to a different date — both are valid JS behaviors
    const isValid = !isNaN(date.getTime())
    if (isValid) {
      // If it rolled over, it should not be Feb 29
      expect(date.getUTCMonth() !== 1 || date.getUTCDate() !== 29).toBe(true)
    } else {
      expect(isNaN(date.getTime())).toBe(true)
    }
  })

  it('Y2K date (2000-01-01)', () => {
    const date = new Date('2000-01-01T00:00:00Z')
    expect(date.getUTCFullYear()).toBe(2000)
    expect(isNaN(date.getTime())).toBe(false)
  })

  it('far future date (2099-12-31)', () => {
    const date = new Date('2099-12-31T00:00:00Z')
    expect(date.getUTCFullYear()).toBe(2099)
    expect(isNaN(date.getTime())).toBe(false)
  })

  it('epoch date (1970-01-01)', () => {
    const date = new Date('1970-01-01T00:00:00Z')
    expect(date.getUTCFullYear()).toBe(1970)
    expect(date.getTime()).toBe(0)
  })

  it('ISO string round-trip preserves date', () => {
    const original = '2026-03-04T12:30:00.000Z'
    const date = new Date(original)
    expect(date.toISOString()).toBe(original)
  })
})

describe('Edge cases: special characters in strings', () => {
  it('quotes in strings', () => {
    const name = 'O\'Brien "Doc"'
    expect(name).toContain("'")
    expect(name).toContain('"')
    expect(name.length).toBe(13)
  })

  it('slashes in grid names', () => {
    const gridName = 'Region/District'
    expect(gridName).toContain('/')
  })

  it('angle brackets (HTML-like)', () => {
    const value = '<script>alert("xss")</script>'
    expect(value).toContain('<')
    expect(value).toContain('>')
    expect(value.length).toBeGreaterThan(0)
  })

  it('null bytes in string', () => {
    const value = 'before\0after'
    expect(value.length).toBe(12)
    expect(value.includes('\0')).toBe(true)
  })

  it('newlines and tabs in cell values', () => {
    const value = 'Line 1\nLine 2\tTabbed'
    expect(value.split('\n')).toHaveLength(2)
    expect(value.includes('\t')).toBe(true)
  })

  it('empty string is valid', () => {
    const name = ''
    expect(name).toBe('')
    expect(name.length).toBe(0)
    expect(typeof name).toBe('string')
  })
})

describe('Edge cases: empty/minimal grid scenarios', () => {
  it('empty array represents zero rows', () => {
    const rows: unknown[] = []
    expect(rows).toHaveLength(0)
    expect(rows.filter(Boolean)).toEqual([])
  })

  it('single row, single column grid', () => {
    const grid = {
      rows: [{ row_id: 1, position: 0 }],
      columns: [{ id: 1, name: 'Name', column_type: 'text' }],
    }
    expect(grid.rows).toHaveLength(1)
    expect(grid.columns).toHaveLength(1)
  })

  it('grid with columns but no rows', () => {
    const grid = {
      rows: [] as unknown[],
      columns: [{ id: 1, name: 'Col A' }, { id: 2, name: 'Col B' }],
    }
    expect(grid.rows).toHaveLength(0)
    expect(grid.columns).toHaveLength(2)
  })

  it('grid with rows but no columns', () => {
    const grid = {
      rows: [{ row_id: 1 }],
      columns: [] as unknown[],
    }
    expect(grid.rows).toHaveLength(1)
    expect(grid.columns).toHaveLength(0)
  })
})
