// @vitest-environment jsdom
/**
 * A long "What's due" (UX pass Q9b): up to 2,000 items can come back, and drawing them
 * all took most of a second at 5,000 records. The soonest 100 are drawn, then a
 * "Show all N" button; search still looks through all of them.
 * Mocks as in dashboardDoneMotion.test.tsx.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// ── Global mocks ─────────────────────────────────────────────────────────────

const mockInvoke = vi.fn()
const mockOn = vi.fn().mockReturnValue(vi.fn())
Object.defineProperty(window, 'api', {
  value: { invoke: mockInvoke, on: mockOn, copyToClipboard: vi.fn() },
  writable: true,
})

let reduce = false
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (q: string) => ({ matches: reduce && q.includes('reduce'), addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }),
})

if (!globalThis.crypto?.randomUUID) {
  vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2) })
}

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

vi.mock('zustand/react/shallow', () => ({ useShallow: (fn: Function) => fn }))

vi.mock('lucide-react', async () => (await import('../lucideMock')).lucideMock)

vi.mock('../../../src/renderer/utils/safeInvoke', () => ({
  safeInvoke: vi.fn(),
}))

vi.mock('../../../src/renderer/utils/rendererLogger', () => ({
  rlog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../../src/renderer/utils/deadlineCalc', () => ({
  computeDaysUntil: (_date: string, _interval: number) => -3,
  computeEffectiveDeadline: () => null,
  getMatchingThreshold: () => ({ daysBefore: -30, bgClass: 'alert-pulse-dark', label: 'Overdue' }),
}))

vi.mock('../../../src/shared/constants', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('../../../src/shared/constants')),
  DEBOUNCE_SEARCH: 0, DEBOUNCE_TASK_RELOAD: 0, SPINNER_DELAY: 0,
  MS_PER_DAY: 86400000, DAYS_THIS_WEEK: 7, DAYS_THIS_MONTH: 30,
}))

// ── Store mocks ──────────────────────────────────────────────────────────────

vi.mock('../../../src/renderer/stores/alertStore', () => ({
  useAlertStore: (sel: Function) => sel({
    rules: [{ id: 1, name: 'Default', interval_days: 1, thresholds: [{ daysBefore: 7, bgClass: 'alert-red', label: 'Urgent' }] }],
    isLoaded: true, loadRules: vi.fn(),
  }),
}))

vi.mock('../../../src/renderer/stores/taskStore', () => {
  const d = {
    tasks: [], loading: false, isLoaded: true,
    loadTasks: vi.fn(), createTask: vi.fn(), updateTask: vi.fn(),
    deleteTask: vi.fn(), completeTask: vi.fn(), snoozeTask: vi.fn(),
    setSortMode: vi.fn(), reorderTasks: vi.fn(),
    sortMode: 'due_date' as const, filter: 'all', setFilter: vi.fn(),
  }
  const store = (sel: Function) => sel(d)
  store.subscribe = vi.fn().mockReturnValue(vi.fn())
  store.getState = () => d
  return { useTaskStore: store }
})

// ── Mock sub-components ──────────────────────────────────────────────────────

vi.mock('../../../src/renderer/views/dashboard/SummaryCard', () => ({
  SummaryCard: ({ label, value }: { label: string; value: string | number }) => (
    <div data-testid="summary-card" data-label={label} data-value={String(value)}>{label}: {String(value)}</div>
  ),
}))
const mounts: Record<string, number> = {}
vi.mock('../../../src/renderer/views/dashboard/DeadlineRow', async () => {
  const { useEffect } = await import('react')
  return {
    DeadlineRow: ({ deadline, onMarkDone }: { deadline: { clientName: string; rowId: number; columnId: number }; onMarkDone?: (r: number, c: number) => void }) => {
      useEffect(() => { mounts[deadline.clientName] = (mounts[deadline.clientName] ?? 0) + 1 }, [])
      return (
        <div role="listitem" data-testid="deadline-row">
          {deadline.clientName}
          <button type="button" onClick={() => onMarkDone?.(deadline.rowId, deadline.columnId)}>Done {deadline.clientName}</button>
        </div>
      )
    },
  }
})
vi.mock('../../../src/renderer/views/dashboard/TaskRow', () => ({
  TaskRow: ({ task }: { task: { title: string } }) => (
    <div data-testid="task-row">{task.title}</div>
  ),
}))
vi.mock('../../../src/renderer/views/dashboard/FollowUpDashRow', () => ({
  FollowUpDashRow: ({ followUp }: { followUp: { content: string } }) => (
    <div data-testid="followup-row">{followUp.content}</div>
  ),
}))
vi.mock('../../../src/renderer/views/dashboard/WeekViewTab', () => ({
  WeekViewTab: () => <div data-testid="week-view">Week View</div>,
}))
vi.mock('../../../src/renderer/views/dashboard/MonthViewTab', () => ({
  MonthViewTab: () => <div data-testid="month-view">Month View</div>,
}))
vi.mock('../../../src/renderer/views/dashboard/RecentlyArchivedTab', () => ({
  RecentlyArchivedTab: () => <div data-testid="archived-tab">Archived</div>,
}))

// ── Import (after mocks) ─────────────────────────────────────────────────────

import DashboardView from '../../../src/renderer/views/DashboardView'
import { safeInvoke } from '../../../src/renderer/utils/safeInvoke'
import { setWords } from '../vocabFixture'

const mockSafeInvoke = safeInvoke as ReturnType<typeof vi.fn>

const deadlines = Array.from({ length: 250 }, (_, i) => ({
  row_id: i + 1, client_name: `Person ${i + 1}`, grid_id: 1, grid_name: 'Caseload A', column_id: 10,
  column_name: 'Annual Review', date_value: '2026-03-01', column_config: '{"alert_rule_id":1}',
}))

function setupMocks(list = deadlines) {
  mockSafeInvoke.mockImplementation((channel: string) => {
    if (channel === 'dashboard:get-all') {
      return Promise.resolve({ ok: true, data: { stats: { totalActive: list.length, totalGrids: 1 }, deadlines: list, followUps: [], archived: [] } })
    }
    if (channel === 'task:get-due') return Promise.resolve({ ok: true, data: [] })
    return Promise.resolve({ ok: false, error: 'unknown' })
  })
}

async function flushEffects() {
  await act(async () => { await new Promise(r => setTimeout(r, 10)) })
}

const names = () => screen.getAllByTestId('deadline-row').map(r => r.firstChild?.textContent)

describe("DashboardView — a long What's due list", () => {
  beforeEach(() => {
    setWords()
    vi.clearAllMocks()
    sessionStorage.clear()
    setupMocks()
  })

  it("What's due draws the worst 10 (persona study R6), and Show all draws the rest", async () => {
    render(<MemoryRouter><DashboardView /></MemoryRouter>)
    await flushEffects()
    expect(names()).toHaveLength(10)
    expect(screen.getByText('Showing the soonest 10 of 250.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Show all 250' }))
    expect(names()).toHaveLength(250)
    expect(screen.queryByTestId('dashboard-show-all')).toBeNull()
  })

  it("What's due stays open for the rest of the session", async () => {
    const first = render(<MemoryRouter><DashboardView /></MemoryRouter>)
    await flushEffects()
    fireEvent.click(screen.getByRole('button', { name: 'Show all 250' }))
    first.unmount()
    render(<MemoryRouter><DashboardView /></MemoryRouter>)
    await flushEffects()
    expect(names()).toHaveLength(250)
  })

  it('the Overdue tab draws the soonest 100, says how many there are, and Show all draws the rest', async () => {
    render(<MemoryRouter><DashboardView /></MemoryRouter>)
    await flushEffects()
    fireEvent.click(screen.getByRole('tab', { name: /Overdue/ }))
    expect(names()).toHaveLength(100)
    expect(screen.getByText('Showing the soonest 100 of 250.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Show all 250' }))
    expect(names()).toHaveLength(250)
  })

  it('search looks through every item, not only the ones drawn', async () => {
    render(<MemoryRouter><DashboardView /></MemoryRouter>)
    await flushEffects()
    fireEvent.change(screen.getByLabelText("Search what's due"), { target: { value: 'Person 240' } })
    await flushEffects()
    expect(names()).toEqual(['Person 240'])
    expect(screen.queryByTestId('dashboard-show-all')).toBeNull()
  })

  it('a short list has no Show all', async () => {
    setupMocks(deadlines.slice(0, 5))
    render(<MemoryRouter><DashboardView /></MemoryRouter>)
    await flushEffects()
    expect(names()).toHaveLength(5)
    expect(screen.queryByTestId('dashboard-show-all')).toBeNull()
  })
})

