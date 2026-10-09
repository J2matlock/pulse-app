// @vitest-environment jsdom
/**
 * DashboardView interaction tests — tabs, search, summary cards, empty states.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// ── Global mocks ─────────────────────────────────────────────────────────────

const mockInvoke = vi.fn()
const mockOn = vi.fn().mockReturnValue(vi.fn())
Object.defineProperty(window, 'api', {
  value: { invoke: mockInvoke, on: mockOn, copyToClipboard: vi.fn() },
  writable: true,
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
  DEBOUNCE_SEARCH: 0,
  DEBOUNCE_TASK_RELOAD: 0,
  SPINNER_DELAY: 0,
  MS_PER_DAY: 86400000,
  DAYS_THIS_WEEK: 7,
  DAYS_THIS_MONTH: 30,
}))

// ── Store mocks ──────────────────────────────────────────────────────────────

vi.mock('../../../src/renderer/stores/alertStore', () => ({
  useAlertStore: (selector: Function) => selector({
    rules: [{
      id: 1,
      name: 'Default',
      interval_days: 1,
      thresholds: [{ daysBefore: 7, bgClass: 'alert-red', label: 'Urgent' }],
    }],
    isLoaded: true,
    loadRules: vi.fn(),
  }),
}))

vi.mock('../../../src/renderer/stores/taskStore', () => {
  const storeData = {
    tasks: [], loading: false, isLoaded: true,
    loadTasks: vi.fn(), createTask: vi.fn(), updateTask: vi.fn(),
    deleteTask: vi.fn(), completeTask: vi.fn(), snoozeTask: vi.fn(),
    setSortMode: vi.fn(), reorderTasks: vi.fn(),
    sortMode: 'due_date' as const, filter: 'all', setFilter: vi.fn(),
  }
  const store = (selector: Function) => selector(storeData)
  // Support both 1-arg and 2-arg subscribe (zustand selector-subscribe)
  store.subscribe = vi.fn().mockReturnValue(vi.fn())
  store.getState = () => storeData
  return { useTaskStore: store }
})

// ── Mock sub-components ──────────────────────────────────────────────────────

vi.mock('../../../src/renderer/views/dashboard/SummaryCard', () => ({
  SummaryCard: ({ label, value }: { label: string; value: string | number }) => (
    <div data-testid="summary-card" data-label={label} data-value={String(value)}>{label}: {String(value)}</div>
  ),
}))
vi.mock('../../../src/renderer/views/dashboard/DeadlineRow', () => ({
  DeadlineRow: ({ deadline }: { deadline: { clientName: string } }) => (
    <div data-testid="deadline-row">{deadline.clientName}</div>
  ),
}))
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
  WeekViewTab: () => <div data-testid="week-view">Week View Content</div>,
}))
vi.mock('../../../src/renderer/views/dashboard/MonthViewTab', () => ({
  MonthViewTab: () => <div data-testid="month-view">Month View Content</div>,
}))
vi.mock('../../../src/renderer/views/dashboard/RecentlyArchivedTab', () => ({
  RecentlyArchivedTab: () => <div data-testid="archived-tab">Archived Content</div>,
}))

// ── Import view (after mocks) ───────────────────────────────────────────────

import DashboardView from '../../../src/renderer/views/DashboardView'
import { safeInvoke } from '../../../src/renderer/utils/safeInvoke'
import { setWords } from '../vocabFixture'

const mockSafeInvoke = safeInvoke as ReturnType<typeof vi.fn>

// ── Sample data ──────────────────────────────────────────────────────────────

const sampleStats = { totalActive: 15, totalGrids: 2 }
const sampleDeadlines = [
  { row_id: 1, client_name: 'Alice Smith', grid_id: 1, grid_name: 'Grid A', column_id: 10, column_name: 'Review Date', date_value: '2026-03-01', column_config: '{"alert_rule_id":1}' },
  { row_id: 2, client_name: 'Bob Jones', grid_id: 1, grid_name: 'Grid A', column_id: 10, column_name: 'Review Date', date_value: '2026-03-10', column_config: '{"alert_rule_id":1}' },
  { row_id: 3, client_name: 'Charlie Brown', grid_id: 2, grid_name: 'Grid B', column_id: 11, column_name: 'Due Date', date_value: '2026-02-20', column_config: '{}' },
]
const sampleFollowUps = [
  { id: 100, row_id: 1, client_name: 'Alice Smith', grid_id: 1, grid_name: 'Grid A', content: 'Follow up on housing', follow_up_date: '2026-03-05', entry_date: '2026-02-28' },
]
const sampleArchived = [
  { id: 50, client_name: 'David Archived', grid_name: 'Grid A', archived_reason: 'closed' },
]
const sampleTasks = [
  { id: 200, title: 'Call insurance', due_date: '2026-03-06', priority: 'high', is_completed: 0, category: 'admin', grid_id: null, description: null, recurrence_rule: null, completed_at: null, snoozed_until: null, position: 0, created_at: '', updated_at: '' },
]

// ── Helpers ──────────────────────────────────────────────────────────────────

function setupDefaultMocks() {
  mockSafeInvoke.mockImplementation((channel: string) => {
    if (channel === 'dashboard:get-all') {
      return Promise.resolve({
        ok: true,
        data: { stats: sampleStats, deadlines: sampleDeadlines, followUps: sampleFollowUps, archived: sampleArchived },
      })
    }
    if (channel === 'task:get-due') {
      return Promise.resolve({ ok: true, data: sampleTasks })
    }
    return Promise.resolve({ ok: false, error: 'unknown' })
  })
}

async function flushEffects() {
  await act(async () => {
    await new Promise(r => setTimeout(r, 10))
  })
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('DashboardView — interactions', () => {
  beforeEach(() => {    setWords()
    vi.clearAllMocks()
    setupDefaultMocks()
  })

  it('renders summary cards with counts from IPC data', async () => {
    render(<MemoryRouter><DashboardView /></MemoryRouter>)
    await flushEffects()

    const cards = screen.getAllByTestId('summary-card')
    expect(cards.length).toBe(5)
    // Active Clients should show 15
    const activeCard = cards.find(c => c.getAttribute('data-label') === 'Active Clients')
    expect(activeCard?.getAttribute('data-value')).toBe('15')
  })

  it('renders Priority List tab as active by default', async () => {
    render(<MemoryRouter><DashboardView /></MemoryRouter>)
    await flushEffects()

    const priorityTab = screen.getByRole('tab', { name: /Priority List/i })
    expect(priorityTab.getAttribute('aria-selected')).toBe('true')
  })

  it('switches to This Week tab and shows WeekViewTab content', async () => {
    render(<MemoryRouter><DashboardView /></MemoryRouter>)
    await flushEffects()

    // Top tablist is the first one; filter tablist is nested inside priority tab content
    const tablists = screen.getAllByRole('tablist')
    const topTablist = tablists[0]
    const weekTab = Array.from(topTablist.querySelectorAll('[role="tab"]'))
      .find(t => t.textContent?.includes('This Week'))! as HTMLElement
    fireEvent.click(weekTab)
    expect(weekTab.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByTestId('week-view')).toBeDefined()
  })

  it('switches to This Month tab and shows MonthViewTab content', async () => {
    render(<MemoryRouter><DashboardView /></MemoryRouter>)
    await flushEffects()

    const tablists = screen.getAllByRole('tablist')
    const topTablist = tablists[0]
    const monthTab = Array.from(topTablist.querySelectorAll('[role="tab"]'))
      .find(t => t.textContent?.includes('This Month'))! as HTMLElement
    fireEvent.click(monthTab)
    expect(monthTab.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByTestId('month-view')).toBeDefined()
  })

  it('switches to Recently Archived tab and shows archived content', async () => {
    render(<MemoryRouter><DashboardView /></MemoryRouter>)
    await flushEffects()

    const archivedTab = screen.getByRole('tab', { name: /Recently Archived/i })
    fireEvent.click(archivedTab)
    expect(archivedTab.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByTestId('archived-tab')).toBeDefined()
  })

  it('renders deadline rows from IPC data on priority tab', async () => {
    render(<MemoryRouter><DashboardView /></MemoryRouter>)
    await flushEffects()

    const deadlineRows = screen.getAllByTestId('deadline-row')
    expect(deadlineRows.length).toBeGreaterThanOrEqual(1)
  })

  it('search input filters priority list items', async () => {
    render(<MemoryRouter><DashboardView /></MemoryRouter>)
    await flushEffects()

    // All items should be visible initially
    const initialRows = screen.getAllByTestId('deadline-row')
    expect(initialRows.length).toBeGreaterThan(0)

    // Type a search query that matches only one client
    const searchInput = screen.getByPlaceholderText('Search…')
    fireEvent.change(searchInput, { target: { value: 'Alice' } })

    // Wait for debounce (set to 0ms in mock)
    await flushEffects()

    const filteredRows = screen.getAllByTestId('deadline-row')
    expect(filteredRows.length).toBe(1)
    expect(filteredRows[0].textContent).toContain('Alice Smith')
  })

  it('shows empty state message when no items match filter', async () => {
    render(<MemoryRouter><DashboardView /></MemoryRouter>)
    await flushEffects()

    const searchInput = screen.getByPlaceholderText('Search…')
    fireEvent.change(searchInput, { target: { value: 'ZZZNONEXISTENT' } })
    await flushEffects()

    expect(screen.getByText('All clear!')).toBeDefined()
  })
})
