// @vitest-environment jsdom
/** The dashboard's numbers agree with the briefing (D-19), and "this week" means one thing per screen (D-20). */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('lucide-react', async () => (await import('./lucideMock')).lucideMock)
Object.defineProperty(window, 'api', { value: { invoke: vi.fn(async () => ({ ok: true, data: null })), on: () => () => {} }, writable: true, configurable: true })

import { countDeadlineTiles, dashboardTileCounts } from '../../src/renderer/views/dashboard/tileCounts'
import { WeekViewTab, daysLeftInWeek } from '../../src/renderer/views/dashboard/WeekViewTab'
import { useSettingsStore } from '../../src/renderer/stores/settingsStore'
import type { ExtendedDeadlineInfo } from '../../src/renderer/views/dashboard/types'

const dl = (daysUntil: number, over: Partial<ExtendedDeadlineInfo> = {}): ExtendedDeadlineInfo => ({
  rowId: daysUntil + 100, clientName: `Client ${daysUntil}`, gridId: 1, gridName: 'Clients', columnId: 2, columnName: 'Review',
  dateValue: '2026-01-01', daysUntil, alertRuleId: 1, threshold: null, intervalDays: 0, ...over,
}) as ExtendedDeadlineInfo

describe('dashboard tiles', () => {
  it('count deadlines the way the briefing does: overdue includes a used-up quota; the next 7 and 30 days include today', () => {
    const c = countDeadlineTiles([dl(-3), dl(0, { state: 'overdue' }), dl(0), dl(5), dl(7), dl(8), dl(30), dl(31)])
    expect(c).toEqual({ overdue: 2, dueThisWeek: 3, dueThisMonth: 5 })
  })

  it('use main\'s counts over everything when a list came back at its cap (F-024), and their own list otherwise', () => {
    const server = { deadlineTiles: { overdue: 2500, dueThisWeek: 40, dueThisMonth: 90 }, followUpsPending: 412 }
    const shown = { deadlines: [dl(-3), dl(2)], followUpDays: [-1, 0, 4], otherDueDays: [-2, 3] }
    expect(dashboardTileCounts({ ...shown, deadlinesCut: false, followUpsCut: false, server }))
      .toEqual({ overdue: 1, dueThisWeek: 1, dueThisMonth: 1, otherDue: 3 })
    expect(dashboardTileCounts({ ...shown, deadlinesCut: true, followUpsCut: true, server }))
      .toEqual({ overdue: 2500, dueThisWeek: 40, dueThisMonth: 90, otherDue: 413 })
    // An older main without the counts: fall back to the list
    expect(dashboardTileCounts({ ...shown, deadlinesCut: true, followUpsCut: false, server: null }).overdue).toBe(1)
  })
})

describe('This Week tab', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 9, 7, 12)) // Wednesday, Oct 7, 2026
  })
  afterEach(() => vi.useRealTimers())

  it('knows how many days are left in the calendar week', () => {
    expect(daysLeftInWeek(new Date(2026, 9, 7), 'sunday')).toBe(3)  // through Sat Oct 10
    expect(daysLeftInWeek(new Date(2026, 9, 7), 'monday')).toBe(4)  // through Sun Oct 11
  })

  it('puts everything late at the top, however late, and stops at the end of the week', () => {
    useSettingsStore.setState({ weekStart: 'sunday' })
    render(<MemoryRouter><WeekViewTab deadlines={[dl(-9, { clientName: 'Long late' }), dl(1, { clientName: 'Thursday one', due: '2026-10-08' }), dl(5, { clientName: 'Next week' })]}
      tasksWithDays={[]} checklistWithDays={[]} followUpsWithDays={[]} isLoading={false} /></MemoryRouter>)
    const headings = screen.getAllByText(/Overdue|Thursday/).map(e => e.textContent)
    expect(headings[0]).toBe('Overdue')
    expect(screen.getByText('Long late')).toBeTruthy()
    expect(screen.getByText('Thursday one')).toBeTruthy()
    expect(screen.queryByText('Next week')).toBeNull()
  })
})
