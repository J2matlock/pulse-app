// @vitest-environment jsdom
/** The dashboard's numbers agree with the briefing (D-19), and "Next 7 days" rolls from today (persona study R6). */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('lucide-react', async () => (await import('./lucideMock')).lucideMock)
Object.defineProperty(window, 'api', { value: { invoke: vi.fn(async () => ({ ok: true, data: null })), on: () => () => {} }, writable: true, configurable: true })

import { countDeadlineTiles, countDue, dashboardTileCounts } from '../../src/renderer/views/dashboard/tileCounts'
import { WeekViewTab } from '../../src/renderer/views/dashboard/WeekViewTab'
import { MonthViewTab } from '../../src/renderer/views/dashboard/MonthViewTab'
import type { ExtendedDeadlineInfo, PriorityItem } from '../../src/renderer/views/dashboard/types'
import { setWords } from './vocabFixture'

const dl = (daysUntil: number, over: Partial<ExtendedDeadlineInfo> = {}): ExtendedDeadlineInfo => ({
  rowId: daysUntil + 100, clientName: `Client ${daysUntil}`, gridId: 1, gridName: 'Clients', columnId: 2, columnName: 'Review',
  dateValue: '2026-01-01', daysUntil, alertRuleId: 1, threshold: null, intervalDays: 0, ...over,
}) as ExtendedDeadlineInfo
const item = (d: ExtendedDeadlineInfo): PriorityItem => ({ kind: 'deadline', data: d, sortKey: d.daysUntil })

describe('dashboard tiles', () => {
  it('count the way the briefing does: overdue includes a used-up quota; the next 7 and 30 days start today', () => {
    const list = [dl(-3), dl(0, { state: 'overdue' }), dl(0), dl(5), dl(7), dl(8), dl(30), dl(31)]
    expect(countDue(list)).toEqual({ overdue: 2, next7: 3, next30: 5 })
    // Main's deadline counts (for a cut list) are the same numbers under their older names
    expect(countDeadlineTiles(list)).toEqual({ overdue: 2, dueThisWeek: 3, dueThisMonth: 5 })
  })

  it('count tasks, checklist items and follow-ups in the same three tiles', () => {
    const shown = { deadlines: [dl(-3), dl(2)], followUpDays: [-1, 0, 4], otherDueDays: [-2, 3, 20] }
    expect(dashboardTileCounts({ ...shown, deadlinesCut: false, followUpsCut: false }))
      .toEqual({ overdue: 3, next7: 4, next30: 5 })
  })

  it('use main\'s counts over everything when a list came back at its cap (F-024), and their own list otherwise', () => {
    const server = { deadlineTiles: { overdue: 2500, dueThisWeek: 40, dueThisMonth: 90 }, followUpsPending: 412 }
    const shown = { deadlines: [dl(-3), dl(2)], followUpDays: [-1, 0, 4], otherDueDays: [-2, 3] }
    expect(dashboardTileCounts({ ...shown, deadlinesCut: true, followUpsCut: true, server }))
      // 2500 + 1 task late + 411 follow-ups late (412 due or late, less the 1 due today)
      .toEqual({ overdue: 2500 + 1 + 411, next7: 40 + 1 + 2, next30: 90 + 1 + 2 })
    // An older main without the counts: fall back to the list
    expect(dashboardTileCounts({ ...shown, deadlinesCut: true, followUpsCut: false, server: null }).overdue).toBe(3)
  })
})

describe('Next 7 days and Next 30 days tabs', () => {
  beforeEach(() => {
    setWords()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 9, 7, 12)) // Wednesday, Oct 7, 2026
  })
  afterEach(() => vi.useRealTimers())

  it('Next 7 days has a heading per day, today first', () => {
    render(<MemoryRouter><WeekViewTab today="2026-10-07" isLoading={false}
      items={[item(dl(0, { clientName: 'Today one' })), item(dl(1, { clientName: 'Thursday one' })), item(dl(7, { clientName: 'Next Wednesday' }))]} /></MemoryRouter>)
    const headings = screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent)
    expect(headings).toEqual(['Today · Wednesday, Oct 7', 'Thursday, Oct 8', 'Wednesday, Oct 14'])
    expect(screen.getByText('Next Wednesday')).toBeTruthy()
  })

  it('Next 30 days has a heading per seven days from today', () => {
    render(<MemoryRouter><MonthViewTab today="2026-10-07" isLoading={false}
      items={[item(dl(2, { clientName: 'Soon' })), item(dl(9, { clientName: 'Later' })), item(dl(30, { clientName: 'Last day' }))]} /></MemoryRouter>)
    const headings = screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent)
    expect(headings).toEqual(['Oct 7 – Oct 13', 'Oct 14 – Oct 20', 'Nov 4 – Nov 10'])
  })

  it('says so when the window is empty', () => {
    render(<MemoryRouter><WeekViewTab today="2026-10-07" isLoading={false} items={[]} /></MemoryRouter>)
    expect(screen.getByText('Nothing due in the next 7 days.')).toBeTruthy()
  })
})
