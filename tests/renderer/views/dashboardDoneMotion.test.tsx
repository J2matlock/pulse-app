// @vitest-environment jsdom
/**
 * Done on the dashboard (Q6): keys stay stable, so the rows after a removed one
 * aren't remounted; the row is marked leaving (slides out, closes up) for
 * 180 ms before it's taken out; under reduced motion it goes at once.
 * Mocks as in dashboardView-data.test.tsx.
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

// ── Sample data ──────────────────────────────────────────────────────────────

const sampleStats = { totalActive: 42, totalGrids: 3 }

const sampleDeadlines = [
  { row_id: 1, client_name: 'Alice Johnson', grid_id: 1, grid_name: 'Caseload A', column_id: 10, column_name: 'Annual Review', date_value: '2026-03-01', column_config: '{"alert_rule_id":1}' },
  { row_id: 2, client_name: 'Bob Williams', grid_id: 1, grid_name: 'Caseload A', column_id: 10, column_name: 'Annual Review', date_value: '2026-03-05', column_config: '{"alert_rule_id":1}' },
  { row_id: 3, client_name: 'Carmen Diaz', grid_id: 2, grid_name: 'Caseload B', column_id: 11, column_name: 'ISP Due', date_value: '2026-02-20', column_config: '{}' },
  { row_id: 4, client_name: 'Derek Lee', grid_id: 2, grid_name: 'Caseload B', column_id: 11, column_name: 'ISP Due', date_value: '2026-03-15', column_config: '{"alert_rule_id":1}' },
  { row_id: 5, client_name: 'Elena Ruiz', grid_id: 3, grid_name: 'Caseload C', column_id: 12, column_name: 'Cert Exp', date_value: '2026-03-10', column_config: '{"alert_rule_id":1}' },
]

const sampleFollowUps = [
  { id: 101, row_id: 1, client_name: 'Alice Johnson', grid_id: 1, grid_name: 'Caseload A', content: 'Confirm housing placement', follow_up_date: '2026-03-12', entry_date: '2026-03-01' },
  { id: 102, row_id: 2, client_name: 'Bob Williams', grid_id: 1, grid_name: 'Caseload A', content: 'Schedule psych evaluation', follow_up_date: '2026-03-14', entry_date: '2026-03-02' },
  { id: 103, row_id: 4, client_name: 'Derek Lee', grid_id: 2, grid_name: 'Caseload B', content: 'Review medication compliance', follow_up_date: '2026-03-11', entry_date: '2026-03-03' },
]

// ── Helpers ──────────────────────────────────────────────────────────────────

function setupMocks() {
  mockSafeInvoke.mockImplementation((channel: string) => {
    if (channel === 'dashboard:get-all') {
      return Promise.resolve({
        ok: true,
        data: { stats: sampleStats, deadlines: sampleDeadlines, followUps: sampleFollowUps, archived: [] },
      })
    }
    if (channel === 'task:get-due') {
      return Promise.resolve({ ok: true, data: [] })
    }
    return Promise.resolve({ ok: false, error: 'unknown' })
  })
}

async function flushEffects() {
  await act(async () => { await new Promise(r => setTimeout(r, 10)) })
}

// ── Tests ────────────────────────────────────────────────────────────────────

const names = () => screen.getAllByTestId('deadline-row').map(r => r.firstChild?.textContent)

describe('DashboardView — Done slides the row out (Q6)', () => {
  beforeEach(() => {
    setWords()
    vi.clearAllMocks()
    setupMocks()
    reduce = false
    document.documentElement.classList.remove('reduce-motion')
    for (const k of Object.keys(mounts)) delete mounts[k]
  })

  it('marks the row leaving, takes it out after 180 ms, and leaves the other rows mounted', async () => {
    render(<MemoryRouter><DashboardView /></MemoryRouter>)
    await flushEffects()
    const before = names()
    expect(before.length).toBeGreaterThanOrEqual(3)
    const first = before[0]!
    const mountedBefore = { ...mounts }

    fireEvent.click(screen.getByText(`Done ${first}`))
    const slot = screen.getByText(`Done ${first}`).closest('.motion-list-item')!
    expect(slot.classList.contains('motion-item-leave')).toBe(true)
    expect(names()).toContain(first)

    await act(async () => { await new Promise(r => setTimeout(r, 250)) })
    expect(names()).not.toContain(first)
    // Stable keys: no row after it was mounted again
    for (const name of before.slice(1)) expect(mounts[name], name).toBe(mountedBefore[name])
  })

  it('under reduced motion the row goes at once', async () => {
    document.documentElement.classList.add('reduce-motion')
    render(<MemoryRouter><DashboardView /></MemoryRouter>)
    await flushEffects()
    const first = names()[0]!
    fireEvent.click(screen.getByText(`Done ${first}`))
    expect(names()).not.toContain(first)
    expect(document.querySelector('.motion-item-leave')).toBeNull()
  })

  it('each item sits in one wrapper inside the list, and the wrapper gives back the dividing line', async () => {
    render(<MemoryRouter><DashboardView /></MemoryRouter>)
    await flushEffects()
    const row = screen.getAllByTestId('deadline-row')[0]!
    expect(row.parentElement!.classList.contains('motion-list-item')).toBe(true)
    expect(row.parentElement!.parentElement!.getAttribute('role')).toBe('list')
  })
})
