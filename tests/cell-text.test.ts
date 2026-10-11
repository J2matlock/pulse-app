/** One text for a cell in copies and exports (audit G-08). */
import { describe, it, expect } from 'vitest'
import { cellText, deadlineText, formatDateAs } from '../src/shared/cellText'

describe('cellText', () => {
  it('shows what the cell shows, not what is stored', () => {
    expect(cellText('tag', '["vip","new"]')).toBe('vip, new')
    expect(cellText('checkbox', 'true')).toBe('Yes')
    expect(cellText('checkbox', 'false')).toBe('No')
    expect(cellText('currency', '1234.5')).toBe('$1,234.50')
    expect(cellText('text', null)).toBe('')
  })

  it('copies linked names without the hidden separators', () => {
    const stored = '12\u001eJane Doe\u001f13\u001eSam Lee'
    expect(cellText('link', stored)).toBe('Jane Doe, Sam Lee')
    expect(cellText('link', stored)).not.toMatch(/[\u001e\u001f]/)
  })

  it('writes dates in the chosen format', () => {
    expect(formatDateAs('2026-10-06', 'us')).toBe('10/06/2026')
    expect(formatDateAs('2026-10-06', 'eu')).toBe('06/10/2026')
    expect(cellText('date', '2026-10-06')).toBe('2026-10-06')
  })
})

describe('deadlineText', () => {
  it('says the due date and how far off, like the table', () => {
    expect(deadlineText({ due: '2026-10-06', state: 'ok', daysUntil: 361, estimated: false, detail: '' }, '2025-10-06')).toBe('Oct 6, 2026 · in 361 days')
    expect(deadlineText({ due: '2026-10-01', state: 'overdue', daysUntil: -2, estimated: false, detail: '' }, null)).toBe('Oct 1, 2026 · 2 days late')
    expect(deadlineText({ due: null, state: 'done', daysUntil: null, estimated: false, detail: '' }, '2026-10-02')).toBe('Done Oct 2, 2026')
    expect(deadlineText({ due: null, state: 'paused', daysUntil: null, estimated: false, detail: '' }, null)).toBe('Paused')
    expect(deadlineText(undefined, '2026-10-02')).toBe('')
  })
})
