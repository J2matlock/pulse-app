/**
 * snippetExpander.test.ts — Snippet trigger detection, matching, and variable expansion.
 */
import { describe, it, expect } from 'vitest'
import { expandVariables, detectTrigger, matchSnippets } from '../../../src/renderer/utils/snippetExpander'

describe('expandVariables', () => {
  it('{today} expands to MM/DD/YYYY', () => {
    const result = expandVariables('{today}')
    expect(result).toMatch(/^\d{2}\/\d{2}\/\d{4}$/)
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

  it('{now} expands to H:MM AM/PM', () => {
    const result = expandVariables('{now}')
    expect(result).toMatch(/^\d{1,2}:\d{2} [AP]M$/)
  })

  it('{client_name} replaced when provided', () => {
    expect(expandVariables('{client_name}', 'Jane Smith')).toBe('Jane Smith')
  })

  it('{client_name} left as-is when not provided', () => {
    expect(expandVariables('{client_name}')).toBe('{client_name}')
  })

  it('multiple variables in one string', () => {
    const result = expandVariables('Note for {client_name} on {today}', 'Bob')
    expect(result).toMatch(/^Note for Bob on \d{2}\/\d{2}\/\d{4}$/)
  })

  it('no variables returns string unchanged', () => {
    expect(expandVariables('plain text')).toBe('plain text')
  })

  it('handles {today+0} as today', () => {
    const justToday = expandVariables('{today}')
    const todayPlus0 = expandVariables('{today+0}')
    expect(todayPlus0).toBe(justToday)
  })
})

describe('detectTrigger', () => {
  it('detects / at end of text', () => {
    const result = detectTrigger('Hello /')
    expect(result).toEqual({ trigger: '/', query: '' })
  })

  it('detects /query with text after slash', () => {
    const result = detectTrigger('Hello /sig')
    expect(result).toEqual({ trigger: '/sig', query: 'sig' })
  })

  it('returns null when no slash', () => {
    expect(detectTrigger('Hello world')).toBeNull()
  })

  it('returns null when slash followed by space', () => {
    // Slash with space after means it's not a trigger
    expect(detectTrigger('Hello / world')).toBeNull()
  })

  it('detects trigger at beginning of text', () => {
    const result = detectTrigger('/note')
    expect(result).toEqual({ trigger: '/note', query: 'note' })
  })

  it('uses last slash when multiple present', () => {
    const result = detectTrigger('some/path /cmd')
    expect(result).toEqual({ trigger: '/cmd', query: 'cmd' })
  })
})

describe('matchSnippets', () => {
  const snippets = [
    { trigger_text: 'sig', expansion: 'Signature block' },
    { trigger_text: 'signature', expansion: 'Full signature' },
    { trigger_text: 'note', expansion: 'Case note template' },
    { trigger_text: 'followup', expansion: 'Follow-up template' },
    { trigger_text: 'fu', expansion: 'Follow-up short' },
    { trigger_text: 'phone', expansion: 'Phone call note' },
    { trigger_text: 'email', expansion: 'Email template' },
    { trigger_text: 'referral', expansion: 'Referral form' },
    { trigger_text: 'assessment', expansion: 'Assessment note' },
    { trigger_text: 'plan', expansion: 'Service plan' },
  ]

  it('matches prefix case-insensitively', () => {
    const results = matchSnippets(snippets, 'sig')
    expect(results).toHaveLength(2)
    expect(results[0]!.trigger_text).toBe('sig')
    expect(results[1]!.trigger_text).toBe('signature')
  })

  it('empty query matches all (up to 8)', () => {
    const results = matchSnippets(snippets, '')
    expect(results).toHaveLength(8) // max 8
  })

  it('limits results to 8', () => {
    const results = matchSnippets(snippets, '')
    expect(results.length).toBeLessThanOrEqual(8)
  })

  it('returns empty array when no matches', () => {
    const results = matchSnippets(snippets, 'zzz')
    expect(results).toHaveLength(0)
  })

  it('case insensitive matching', () => {
    const results = matchSnippets(snippets, 'SIG')
    expect(results).toHaveLength(2)
  })

  it('single character query narrows results', () => {
    const results = matchSnippets(snippets, 'f')
    expect(results).toHaveLength(2) // followup, fu
    expect(results.every(s => s.trigger_text.startsWith('f'))).toBe(true)
  })
})
