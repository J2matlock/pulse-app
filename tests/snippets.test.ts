/**
 * Snippet Expander Tests — pure string logic, no DB or Electron needed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { expandVariables, detectTrigger, matchSnippets } from '../src/renderer/utils/snippetExpander'

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-06-15T12:00:00Z') })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('expandVariables', () => {
  it('{today} expands to MM/DD/YYYY format', () => {
    const result = expandVariables('{today}')
    expect(result).toMatch(/^\d{2}\/\d{2}\/\d{4}$/)
    // Verify it matches frozen date
    const now = new Date()
    const expected = `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}/${now.getFullYear()}`
    expect(result).toBe(expected)
  })

  it('{today+7} adds 7 days', () => {
    const result = expandVariables('{today+7}')
    const future = new Date()
    future.setDate(future.getDate() + 7)
    const expected = `${String(future.getMonth() + 1).padStart(2, '0')}/${String(future.getDate()).padStart(2, '0')}/${future.getFullYear()}`
    expect(result).toBe(expected)
  })

  it('{today-3} subtracts 3 days', () => {
    const result = expandVariables('{today-3}')
    const past = new Date()
    past.setDate(past.getDate() - 3)
    const expected = `${String(past.getMonth() + 1).padStart(2, '0')}/${String(past.getDate()).padStart(2, '0')}/${past.getFullYear()}`
    expect(result).toBe(expected)
  })

  it('{now} expands to H:MM AM/PM format', () => {
    const result = expandVariables('{now}')
    expect(result).toMatch(/^\d{1,2}:\d{2} [AP]M$/)
  })

  it('{client_name} with clientName param', () => {
    expect(expandVariables('{client_name}', 'Jane Smith')).toBe('Jane Smith')
  })

  it('{client_name} without param leaves placeholder', () => {
    expect(expandVariables('{client_name}')).toBe('{client_name}')
  })

  it('multiple variables in one string', () => {
    const result = expandVariables('Called {client_name} on {today}, follow up {today+14}', 'Bob')
    expect(result).toContain('Bob')
    expect(result).not.toContain('{client_name}')
    expect(result).not.toContain('{today}')
    expect(result).not.toContain('{today+14}')
  })

  it('no variables returns unchanged text', () => {
    expect(expandVariables('Hello world')).toBe('Hello world')
  })
})

describe('detectTrigger', () => {
  it('detects "/" at end of text', () => {
    const result = detectTrigger('Hello /')
    expect(result).toEqual({ trigger: '/', query: '' })
  })

  it('detects "/fw" partial trigger', () => {
    const result = detectTrigger('Hello /fw')
    expect(result).toEqual({ trigger: '/fw', query: 'fw' })
  })

  it('returns null when no trigger', () => {
    expect(detectTrigger('Hello world')).toBeNull()
  })

  it('returns null when slash has space after it', () => {
    // "/fw " has a space — query includes space, but since \S* stops at space
    // this actually returns null for "/ foo"
    expect(detectTrigger('Hello / foo')).toBeNull()
  })

  it('ignores a slash inside a word (f/u, w/, 10/12)', () => {
    expect(detectTrigger('Will f/u')).toBeNull()
    expect(detectTrigger('Met w/')).toBeNull()
    expect(detectTrigger('Seen 10/12')).toBeNull()
    expect(detectTrigger('/fw')).toEqual({ trigger: '/fw', query: 'fw' })
  })

  it('matches last slash in text', () => {
    const result = detectTrigger('path/to/thing /sn')
    expect(result).toEqual({ trigger: '/sn', query: 'sn' })
  })
})

describe('matchSnippets', () => {
  const snippets = [
    { trigger_text: 'fw', expansion: 'Follow-up with {client_name}', category: 'Notes' },
    { trigger_text: 'fwc', expansion: 'Follow-up call with {client_name}', category: 'Notes' },
    { trigger_text: 'sig', expansion: 'Best regards,\nJohn Doe', category: 'Signatures' },
    { trigger_text: 'appt', expansion: 'Appointment scheduled for {today+7}', category: null },
  ]

  it('matches prefix (case-insensitive)', () => {
    const matches = matchSnippets(snippets, 'fw')
    expect(matches).toHaveLength(2)
    expect(matches.map(m => m.trigger_text)).toEqual(['fw', 'fwc'])
  })

  it('a trigger typed in full comes first, even if a longer one sorts earlier', () => {
    // Server order is by category: "Admin" (/ref) before "Visit" (/re)
    const ordered = [
      { trigger_text: 'ref', expansion: 'Referral submitted to ', category: 'Admin' },
      { trigger_text: 'reff', expansion: 'Longer', category: 'Admin' },
      { trigger_text: 're', expansion: 'Reviewed with', category: 'Visit' },
    ]
    expect(matchSnippets(ordered, 're').map(m => m.trigger_text)).toEqual(['re', 'ref', 'reff'])
    // With nothing typed yet, the list keeps its order
    expect(matchSnippets(ordered, '').map(m => m.trigger_text)).toEqual(['ref', 'reff', 're'])
  })

  it('empty query matches all (up to 8)', () => {
    const matches = matchSnippets(snippets, '')
    expect(matches).toHaveLength(4)
  })

  it('no match returns empty array', () => {
    expect(matchSnippets(snippets, 'xyz')).toHaveLength(0)
  })

  it('caps at 8 results', () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      trigger_text: `t${i}`, expansion: `expansion ${i}`, category: null,
    }))
    const matches = matchSnippets(many, 't')
    expect(matches).toHaveLength(8)
  })

  it('case-insensitive: "FW" matches "fw"', () => {
    const matches = matchSnippets(snippets, 'FW')
    expect(matches).toHaveLength(2)
  })
})
