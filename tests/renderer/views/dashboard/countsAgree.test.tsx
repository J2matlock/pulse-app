// @vitest-environment jsdom
/**
 * One count (persona study R6): each tile's number equals its tab's count equals
 * the rows that tab shows, over deadlines, checklist items, tasks and follow-ups.
 * Bobby saw "Due in the next 30 days: 3" over a list with 4 inside 30 days, and
 * "Due in the next 7 days: 1" beside "This week (0)".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, act, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

Object.defineProperty(window, 'api', { value: { invoke: vi.fn(), on: vi.fn().mockReturnValue(vi.fn()), copyToClipboard: vi.fn() }, writable: true })
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }),
})

vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
vi.mock('zustand/react/shallow', () => ({ useShallow: (fn: Function) => fn }))
vi.mock('lucide-react', async () => (await import('../../lucideMock')).lucideMock)
vi.mock('../../../../src/renderer/utils/safeInvoke', () => ({ safeInvoke: vi.fn() }))
vi.mock('../../../../src/renderer/utils/rendererLogger', () => ({ rlog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('../../../../src/renderer/stores/alertStore', () => ({
  useAlertStore: (sel: Function) => sel({
    rules: [{ id: 1, name: 'Review', interval_days: 0, thresholds: [{ daysBefore: 60, bgClass: 'alert-yellow', label: 'Soon' }] }],
    isLoaded: true, loadRules: vi.fn(),
  }),
}))
vi.mock('../../../../src/renderer/stores/taskStore', () => {
  const d = { tasks: [], isLoaded: true }
  const store = (sel: Function) => sel(d)
  store.subscribe = vi.fn().mockReturnValue(vi.fn())
  store.getState = () => d
  return { useTaskStore: store }
})
vi.mock('../../../../src/renderer/views/dashboard/SummaryCard', () => ({
  SummaryCard: ({ label, value, sub, onClick }: { label: string; value: string | number; sub?: string; onClick?: () => void }) => (
    <button type="button" data-testid="summary-card" data-label={label} data-value={String(value)} data-sub={sub} onClick={onClick}>{label}</button>
  ),
}))
vi.mock('../../../../src/renderer/views/dashboard/DeadlineRow', () => ({
  DeadlineRow: ({ deadline }: { deadline: { clientName: string } }) => <div role="listitem" data-testid="row">{deadline.clientName}</div>,
}))
vi.mock('../../../../src/renderer/views/dashboard/TaskRow', () => ({
  TaskRow: ({ task }: { task: { title: string } }) => <div role="listitem" data-testid="row">{task.title}</div>,
}))
vi.mock('../../../../src/renderer/views/dashboard/ChecklistDueRow', () => ({
  ChecklistDueRow: ({ item }: { item: { title: string } }) => <div role="listitem" data-testid="row">{item.title}</div>,
}))
vi.mock('../../../../src/renderer/views/dashboard/FollowUpDashRow', () => ({
  FollowUpDashRow: ({ followUp }: { followUp: { client_name: string } }) => <div role="listitem" data-testid="row">{followUp.client_name}</div>,
}))
vi.mock('../../../../src/renderer/views/dashboard/RecentlyArchivedTab', () => ({ RecentlyArchivedTab: () => null }))

import DashboardView from '../../../../src/renderer/views/DashboardView'
import { safeInvoke } from '../../../../src/renderer/utils/safeInvoke'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspaceStore'
import { localDateFromToday } from '../../../../src/shared/dates'
import { setWords } from '../../vocabFixture'

const dl = (id: number, name: string, daysUntil: number, state?: string) => ({
  row_id: id, client_name: name, grid_id: 1, grid_name: 'Claims', column_id: 10, column_name: 'Review',
  date_value: localDateFromToday(daysUntil), column_config: '{"alert_rule_id":1}', daysUntil, due: localDateFromToday(daysUntil), state,
})
const deadlines = [
  dl(1, 'Late Larry', -4),
  dl(2, 'Quota Quinn', 10, 'overdue'),   // a used-up quota is late whatever its end date
  dl(3, 'Tyrone', 3),
  dl(4, 'Gene', 15),
  dl(5, 'Walt', 19),
  dl(6, 'Far Fran', 45),
]
const checklist = [{ id: 30, row_id: 7, grid_id: 1, client_name: 'Dolores', grid_name: 'Claims', title: 'Evidence', due_date: localDateFromToday(12) }]
const tasks = [
  { id: 40, title: 'Call the VA', due_date: localDateFromToday(5), is_completed: 0, grid_id: null },
  { id: 41, title: 'Someday', due_date: null, is_completed: 0, grid_id: null },
]
const followUps = [
  { id: 50, row_id: 8, client_name: 'Today Tina', grid_id: 1, grid_name: 'Claims', content: 'Call', follow_up_date: localDateFromToday(0) },
  { id: 51, row_id: 9, client_name: 'Past Pat', grid_id: 1, grid_name: 'Claims', content: 'Call', follow_up_date: localDateFromToday(-2) },
]

beforeEach(() => {
  setWords()
  useWorkspaceStore.setState({ features: { tasks: true, checklists: true } })
  vi.mocked(safeInvoke).mockImplementation(((channel: string) => {
    if (channel === 'dashboard:get-all') return Promise.resolve({ ok: true, data: { stats: { totalActive: 9, followUpsPending: 2, activeByList: [] }, deadlines, followUps, archived: [] } })
    if (channel === 'task:get-due') return Promise.resolve({ ok: true, data: tasks })
    if (channel === 'checklist:get-due') return Promise.resolve({ ok: true, data: checklist })
    return Promise.resolve({ ok: false, error: 'unknown' })
  }) as never)
})

const tile = (label: string) => screen.getAllByTestId('summary-card').find(c => c.getAttribute('data-label') === label)!
const tab = (name: RegExp) => screen.getByRole('tab', { name })
const tabCount = (name: RegExp) => Number(/\((\d+)\)/.exec(tab(name).textContent ?? '')![1])

describe('the dashboard counts one way', () => {
  it.each([
    ['Overdue', /^Overdue/, 3, ['Late Larry', 'Past Pat', 'Quota Quinn']],
    ['Due in the next 7 days', /Next 7 days/, 3, ['Today Tina', 'Tyrone', 'Call the VA']],
    ['Due in the next 30 days', /Next 30 days/, 6, ['Today Tina', 'Tyrone', 'Call the VA', 'Evidence', 'Gene', 'Walt']],
  ])('%s: tile = tab = rows', async (label, tabName, n, some) => {
    render(<MemoryRouter><DashboardView /></MemoryRouter>)
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    expect(tile(label).getAttribute('data-value')).toBe(String(n))
    expect(tabCount(tabName)).toBe(n)
    fireEvent.click(tile(label))
    expect(tab(tabName).getAttribute('aria-selected')).toBe('true')
    const panel = screen.queryByTestId('week-view') ?? screen.queryByTestId('month-view')
    const rows = panel
      ? panel.querySelectorAll('[data-due-item]')
      : document.querySelectorAll('.motion-list-item')
    expect(rows.length).toBe(n)
    const text = (panel ?? document.body).textContent ?? ''
    for (const s of some) expect(text).toContain(s)
    if (panel) expect(within(panel).queryByText('Far Fran')).toBeNull()
  })

  it('the Overdue tile says how many records its items are about', async () => {
    render(<MemoryRouter><DashboardView /></MemoryRouter>)
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    expect(tile('Overdue').getAttribute('data-sub')).toBe('for 3 clients')
  })

  it("What's due still lists the task with no date, and no window counts it", async () => {
    render(<MemoryRouter><DashboardView /></MemoryRouter>)
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    expect(screen.getByText('Someday')).toBeTruthy()
    fireEvent.click(tab(/Next 30 days/))
    expect(screen.queryByText('Someday')).toBeNull()
  })
})
