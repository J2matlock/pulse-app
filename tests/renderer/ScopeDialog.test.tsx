// @vitest-environment jsdom
/** Repeating appointments (audit 1.25): moving one to another day doesn't offer "All", which can't move dates. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('../../src/renderer/hooks/useFocusTrap', () => ({ useFocusTrap: vi.fn() }))

import { ScopeDialog } from '../../src/renderer/components/calendar/ScopeDialog'
import { seriesRuleText } from '../../src/shared/appointments'
import { setWords } from './vocabFixture'

beforeEach(() => { setWords() })

describe('ScopeDialog', () => {
  it('offers all three choices for a change on the same day', () => {
    const onChoose = vi.fn()
    render(<ScopeDialog verb="Change" onChoose={onChoose} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByText('All'))
    expect(onChoose).toHaveBeenCalledWith('all')
  })

  it('leaves out "All" when the day changes', () => {
    render(<ScopeDialog verb="Change" onChoose={vi.fn()} onCancel={vi.fn()} dateChanged />)
    expect(screen.queryByText('All')).toBeNull()
    expect(screen.getByText('This and following')).toBeTruthy()
    expect(screen.getByText('Only this one')).toBeTruthy()
  })
})

describe('seriesRuleText', () => {
  it('describes a repeating appointment and nothing else', () => {
    expect(seriesRuleText({ series_id: 3, series_rule: JSON.stringify({ freq: 'weekly', interval: 1, byDay: [2], until: '2027-03-03' }) })).toBe('Every week on Tue · until Mar 3, 2027')
    expect(seriesRuleText({ series_id: null, series_rule: null })).toBeNull()
    expect(seriesRuleText({ series_id: 3, series_rule: 'not json' })).toBeNull()
  })
})
