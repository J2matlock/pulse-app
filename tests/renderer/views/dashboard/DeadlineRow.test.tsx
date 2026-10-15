// @vitest-environment jsdom
/** A dashboard deadline row says what's due (persona study R6): "Appeal window", with "Appeal filed" where Done goes. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

Object.defineProperty(window, 'api', { value: { invoke: vi.fn(async () => ({ ok: true, data: null })), on: () => () => {} }, writable: true, configurable: true })
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)

import { DeadlineRow } from '../../../../src/renderer/views/dashboard/DeadlineRow'
import { deadlineLabel } from '../../../../src/shared/deadlineLabel'
import type { ExtendedDeadlineInfo } from '../../../../src/renderer/views/dashboard/types'
import { setWords } from '../../vocabFixture'

const walt = (over: Partial<ExtendedDeadlineInfo> = {}): ExtendedDeadlineInfo => ({
  rowId: 4, clientName: 'Walt Brennan', gridId: 1, gridName: 'Claims', columnId: 7, columnName: 'Appeal filed',
  dateValue: '', daysUntil: 19, alertRuleId: 2, threshold: null, intervalDays: 0, ruleKind: 'relative',
  due: '2026-11-03', detail: 'Due Nov 3, 2026 (12 months after Nov 3, 2025)', ...over,
})

beforeEach(() => setWords())

describe('DeadlineRow', () => {
  it('a VSO-style anchored rule reads "Appeal window", with "Appeal filed" in the tooltip and on Done', () => {
    const rule = { name: 'Appeal window', kind: 'relative', rule_config: JSON.stringify({ kind: 'relative', anchorColumnId: 3, offset: { months: 12, direction: 'after' } }) }
    const d = walt({ title: deadlineLabel(rule, { name: 'Appeal filed' }).title })
    render(<MemoryRouter><DeadlineRow deadline={d} onMarkDone={() => {}} /></MemoryRouter>)
    expect(screen.getByText('Appeal window')).toBeTruthy()
    expect(screen.queryByText('Appeal filed')).toBeNull()
    const row = screen.getByRole('listitem')
    expect(row.getAttribute('title')).toBe("Due Nov 3, 2026 (12 months after Nov 3, 2025)\nWhen it's done, the date goes in Appeal filed.")
    expect(screen.getByRole('button', { name: 'Mark Appeal filed done for Walt Brennan' })).toBeTruthy()
  })

  it('an interval rule reads its column, and the tooltip is the engine\'s words alone', () => {
    const rule = { name: 'Yearly', kind: 'interval', rule_config: null }
    const d = walt({ columnName: 'Annual review', ruleKind: 'interval', detail: 'Due Nov 3, 2026', title: deadlineLabel(rule, { name: 'Annual review' }).title })
    render(<MemoryRouter><DeadlineRow deadline={d} /></MemoryRouter>)
    expect(screen.getByText('Annual review')).toBeTruthy()
    expect(screen.getByRole('listitem').getAttribute('title')).toBe('Due Nov 3, 2026')
  })
})
