// @vitest-environment jsdom
/**
 * Focus Mode's Done goes through the deadline engine (D-01, R-05, D-02):
 * a repeating date isn't erased, kinds keep their own Done, and dates come
 * from the engine's results.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const mockInvoke = vi.fn()
Object.defineProperty(window, 'api', { value: { invoke: mockInvoke, on: vi.fn().mockReturnValue(vi.fn()) }, writable: true })

vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
vi.mock('lucide-react', async () => (await import('../lucideMock')).lucideMock)
vi.mock('../../../src/renderer/hooks/useFocusTrap', () => ({ useFocusTrap: () => ({ current: null }) }))

const safeInvoke = vi.fn()
vi.mock('../../../src/renderer/utils/safeInvoke', () => ({ safeInvoke: (...a: unknown[]) => safeInvoke(...a), storeInvoke: vi.fn() }))
const completeDeadlines = vi.fn()
vi.mock('../../../src/renderer/views/dashboard/completeDeadline', () => ({ completeDeadlines: (...a: unknown[]) => completeDeadlines(...a) }))
vi.mock('../../../src/renderer/stores/gridStore', () => ({ useGridStore: (sel: (s: unknown) => unknown) => sel({ activeGridId: null, loadGrid: vi.fn() }) }))

import FocusModeView from '../../../src/renderer/views/FocusModeView'
import { focusDeadlineItems } from '../../../src/renderer/views/focus-mode/focusItems'
import type { RawDeadlineRow } from '../../../src/renderer/views/focus-mode/types'

const row = (over: Partial<RawDeadlineRow>): RawDeadlineRow => ({
  row_id: 1, grid_id: 2, grid_name: 'Clients', column_id: 3, column_name: 'Annual review', column_config: '{}',
  date_value: '2025-09-01', client_name: 'Ada', interval_days: null, interval_months: 12, end_of_month: 0,
  alert_thresholds: null, due: '2026-09-01', daysUntil: -3, rule_kind: 'interval', ...over,
})

describe('focusDeadlineItems', () => {
  it('uses the engine due date and days, not its own math', () => {
    // A calendar rule: the stored date is the last time it was done, not the deadline
    const [item] = focusDeadlineItems([row({ rule_kind: 'calendar', date_value: '2025-03-31', due: '2026-10-10', daysUntil: 0, interval_months: null })])
    expect(item!.daysUntil).toBe(0)
    expect(item!.urgency).toBe('today')
    expect(item!.dueDateStr).toMatch(/2026/)
    expect(item!.ruleKind).toBe('calendar')
  })

  it('keeps the step and the done checklist', () => {
    const [item] = focusDeadlineItems([row({ rule_kind: 'sequence', step: 1, label: 'IFSP (step 2 of 4)', column_config: '{"done_checklist_id":7}' })])
    expect(item!.step).toBe(1)
    expect(item!.checklistTemplateId).toBe(7)
    expect(item!.label).toContain('IFSP (step 2 of 4)')
  })

  it('leaves out what is not due yet and has no color reached', () => {
    expect(focusDeadlineItems([row({ daysUntil: 40 })])).toEqual([])
  })
})

describe('Focus Mode Done', () => {
  beforeEach(() => {
    safeInvoke.mockReset()
    completeDeadlines.mockReset()
    completeDeadlines.mockResolvedValue([{}])
  })

  async function open(rows: RawDeadlineRow[]) {
    safeInvoke.mockImplementation(async (ch: string) => ch === 'dashboard:get-deadlines' ? { ok: true, data: rows } : { ok: true, data: [] })
    render(<MemoryRouter><FocusModeView onClose={vi.fn()} /></MemoryRouter>)
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  }

  it('marks a repeating deadline done through the engine instead of erasing the date', async () => {
    await open([row({})])
    await act(async () => { fireEvent.click(screen.getByText(/Done/)) })
    expect(completeDeadlines).toHaveBeenCalledTimes(1)
    const [items] = completeDeadlines.mock.calls[0] as [Array<Record<string, unknown>>]
    expect(items[0]).toMatchObject({ rowId: 1, columnId: 3, ruleKind: 'interval', interval: { days: 0, months: 12, endOfMonth: false } })
    expect(safeInvoke).not.toHaveBeenCalledWith('cell:update', 1, 3, null)
  })

  it('asks for the reading on a meter rule', async () => {
    await open([row({ rule_kind: 'meter' })])
    await act(async () => { fireEvent.click(screen.getByText(/Done/)) })
    expect(completeDeadlines).not.toHaveBeenCalled()
    expect(screen.getByText('Current reading')).toBeTruthy()
  })
})
