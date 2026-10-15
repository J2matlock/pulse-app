// @vitest-environment jsdom
/**
 * DashboardView interaction tests — tabs, search, summary cards, empty states.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

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
  SummaryCard: ({ label, value, onClick }: { label: string; value: string | number; onClick?: () => void }) => (
    <div data-testid="summary-card" data-label={label} data-value={String(value)} onClick={onClick}>{label}: {String(value)}</div>
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
    expect(cards.length).toBe(4)
    // Active Clients should show 15
    const activeCard = cards.find(c => c.getAttribute('data-label') === 'Active clients')
    expect(activeCard?.getAttribute('data-value')).toBe('15')
  })

  it('renders the What\'s due tab as active by default, with a count (D-20)', async () => {
    render(<MemoryRouter><DashboardView /></MemoryRouter>)
    await flushEffects()

    const priorityTab = screen.getByRole('tab', { name: /What's due/i })
    expect(priorityTab.getAttribute('aria-selected')).toBe('true')
    // 2 deadlines with a rule + 1 task + 1 follow-up
    expect(priorityTab.textContent).toContain('(4)')
  })

  it('switches to the Next 7 days tab and shows WeekViewTab content', async () => {
    render(<MemoryRouter><DashboardView /></MemoryRouter>)
    await flushEffects()

    // Top tablist is the first one; filter tablist is nested inside priority tab content
    const tablists = screen.getAllByRole('tablist')
    const topTablist = tablists[0]
    const weekTab = Array.from(topTablist.querySelectorAll('[role="tab"]'))
      .find(t => t.textContent?.includes('Next 7 days'))! as HTMLElement
    fireEvent.click(weekTab)
    expect(weekTab.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByTestId('week-view')).toBeDefined()
  })

  it('switches to the Next 30 days tab and shows MonthViewTab content', async () => {
    render(<MemoryRouter><DashboardView /></MemoryRouter>)
    await flushEffects()

    const tablists = screen.getAllByRole('tablist')
    const topTablist = tablists[0]
    const monthTab = Array.from(topTablist.querySelectorAll('[role="tab"]'))
      .find(t => t.textContent?.includes('Next 30 days'))! as HTMLElement
    fireEvent.click(monthTab)
    expect(monthTab.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByTestId('month-view')).toBeDefined()
  })

  it('Recently archived is a card at the end, not a tab (D-20)', async () => {
    render(<MemoryRouter><DashboardView /></MemoryRouter>)
    await flushEffects()

    expect(screen.queryByRole('button', { name: /Recently archived/i })).toBeNull()
    expect(screen.getByRole('heading', { name: /Recently archived/ })).toBeDefined()
    expect(screen.getByTestId('archived-tab')).toBeDefined()
  })

  it('the count tiles open their tab (D-06)', async () => {
    render(<MemoryRouter><DashboardView /></MemoryRouter>)
    await flushEffects()
    const tile = screen.getAllByTestId('summary-card').find(c => c.getAttribute('data-label') === 'Due in the next 7 days')!
    fireEvent.click(tile)
    expect(screen.getByTestId('week-view')).toBeDefined()
    fireEvent.click(screen.getAllByTestId('summary-card').find(c => c.getAttribute('data-label') === 'Overdue')!)
    expect(screen.getByRole('tab', { name: /Overdue/ }).getAttribute('aria-selected')).toBe('true')
  })

  it('Done explains itself in a line, and the checkboxes wait behind "Select several…" (D-04, D-25)', async () => {
    render(<MemoryRouter><DashboardView /></MemoryRouter>)
    await flushEffects()
    expect(screen.getByText(/Done puts today's date in and starts the next cycle/)).toBeDefined()
    expect(screen.queryByLabelText('Select all shown')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Select several…' }))
    expect(screen.getByLabelText('Select all shown')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Done selecting' })).toBeDefined()
  })

  it('the search shares the Done row instead of a row of its own (Q2)', async () => {
    render(<MemoryRouter><DashboardView /></MemoryRouter>)
    await flushEffects()
    const search = screen.getByPlaceholderText('Search…')
    const row = screen.getByRole('button', { name: 'Select several…' }).parentElement!
    expect(row.contains(search)).toBe(true)
    expect(row.textContent).toContain('Done puts today')
    // The Overdue tab keeps the Done line but has nothing to search
    fireEvent.click(screen.getByRole('tab', { name: /Overdue/ }))
    expect(screen.queryByPlaceholderText('Search…')).toBeNull()
  })

  it('the occasional actions sit under one Print & export menu (D-19)', async () => {
    render(<MemoryRouter><DashboardView /></MemoryRouter>)
    await flushEffects()
    expect(screen.queryByRole('button', { name: /Print what's due/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Print & export/ }))
    const items = screen.getAllByRole('menuitem').map(m => m.textContent)
    expect(items.some(x => x?.startsWith("Print what's due"))).toBe(true)
    expect(items.some(x => x?.startsWith('Print this week'))).toBe(false)
    expect(items.some(x => x?.startsWith('Monthly summary'))).toBe(true)
    expect(items.some(x => x?.startsWith('Add to my calendar…'))).toBe(true)
    expect(screen.getByRole('button', { name: /Customize/ })).toBeDefined()
  })

  it("Print what's due asks how far ahead, 30 days first, and remembers the choice (persona study R7)", async () => {
    render(<MemoryRouter><DashboardView /></MemoryRouter>)
    await flushEffects()
    fireEvent.click(screen.getByRole('button', { name: /Print & export/ }))
    fireEvent.click(screen.getAllByRole('menuitem').find(m => m.textContent?.startsWith("Print what's due"))!)
    const dialog = screen.getByRole('dialog', { name: "Print what's due" })
    expect((screen.getByRole('radio', { name: 'Next 30 days' }) as HTMLInputElement).checked).toBe(true)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Next 30 days' })))
    expect(dialog.textContent).toContain('Next 7 days')
    fireEvent.click(screen.getByRole('radio', { name: 'Next 90 days' }))
    mockSafeInvoke.mockClear()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: "Print what's due…" })) })
    expect(mockSafeInvoke).toHaveBeenCalledWith('settings:update', 'print_due_days', '90')
    expect(mockSafeInvoke).toHaveBeenCalledWith('export:whats-due', 90, expect.objectContaining({ includeAppointments: expect.any(Boolean) }))
  })

  it('the color key is a pop-up from a link and no longer opens on its own (D-21, Q5)', async () => {
    render(<MemoryRouter><DashboardView /></MemoryRouter>)
    await flushEffects()
    const link = screen.getByRole('button', { name: 'What do the colors mean?' })
    expect(link.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('dialog', { name: 'What the colors mean' })).toBeNull()
    expect(mockSafeInvoke).not.toHaveBeenCalledWith('settings:get', 'dashboard_color_guide_seen')
    fireEvent.click(link)
    const key = screen.getByRole('dialog', { name: 'What the colors mean' })
    expect(key.textContent).toContain('The stripe on the left of each row')
    expect(screen.queryByRole('button', { name: 'Got it' })).toBeNull()
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

    // A search with no matches says so, not "All clear!" (S1)
    expect(screen.getByText(/Nothing matches .ZZZNONEXISTENT./)).toBeDefined()
    expect(screen.queryByText('All clear!')).toBeNull()
  })

  it('an empty workspace says how the dashboard fills up, not "All clear!" (audit 2.1)', async () => {
    mockSafeInvoke.mockImplementation((channel: string) => channel === 'dashboard:get-all'
      ? Promise.resolve({ ok: true, data: { stats: { totalActive: 0, totalGrids: 1 }, deadlines: [], followUps: [], archived: [] } })
      : Promise.resolve({ ok: false, error: 'unknown' }))
    render(<MemoryRouter><DashboardView /></MemoryRouter>)
    await flushEffects()
    expect(screen.getByText(/Your dashboard fills up as you add clients with dates/)).toBeDefined()
    expect(screen.queryByText('All clear!')).toBeNull()
  })

  it('says the dashboard could not load instead of "all caught up" when loading fails', async () => {
    mockSafeInvoke.mockImplementation(() => Promise.resolve({ ok: false, error: 'Database is locked' }))
    render(<MemoryRouter><DashboardView /></MemoryRouter>)
    await flushEffects()
    expect(screen.getByRole('alert').textContent).toMatch(/couldn't load the dashboard/)
    expect(screen.queryByText('Nothing overdue')).toBeNull()
    setupDefaultMocks()
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }))
    await flushEffects()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('reloads when sample data is added or removed while it is open', async () => {
    const { pulseEvents } = await import('../../../src/renderer/events')
    render(<MemoryRouter><DashboardView /></MemoryRouter>)
    await flushEffects()
    const loads = () => mockSafeInvoke.mock.calls.filter(c => c[0] === 'dashboard:get-all').length
    expect(loads()).toBe(1)
    await act(async () => { pulseEvents.emit('sample-data:changed') })
    await flushEffects()
    expect(loads()).toBe(2)
  })

  it('reloads at midnight, so yesterday\'s "due today" turns overdue without a restart', async () => {
    const { pulseEvents } = await import('../../../src/renderer/events')
    render(<MemoryRouter><DashboardView /></MemoryRouter>)
    await flushEffects()
    const loads = () => mockSafeInvoke.mock.calls.filter(c => c[0] === 'dashboard:get-all').length
    expect(loads()).toBe(1)
    await act(async () => { pulseEvents.emit('day:changed', { date: '2030-01-02' }) })
    await flushEffects()
    expect(loads()).toBe(2)
  })

  it('reloads its priority list when a record is reactivated (here or by Undo)', async () => {
    const { pulseEvents } = await import('../../../src/renderer/events')
    render(<MemoryRouter><DashboardView /></MemoryRouter>)
    await flushEffects()
    const loads = () => mockSafeInvoke.mock.calls.filter(c => c[0] === 'dashboard:get-all').length
    expect(loads()).toBe(1)
    await act(async () => { pulseEvents.emit('records:archive-changed') })
    await flushEffects()
    expect(loads()).toBe(2)
  })

  it('the Overdue tab lists a used-up allowance, like the Overdue tile', async () => {
    mockSafeInvoke.mockImplementation((channel: string) => channel === 'dashboard:get-all'
      ? Promise.resolve({ ok: true, data: { stats: sampleStats, archived: [], followUps: [], deadlines: [
        { row_id: 7, client_name: 'Used Up', grid_id: 1, grid_name: 'Grid A', column_id: 12, column_name: 'Sessions left', date_value: '', column_config: '{}', daysUntil: 0, state: 'overdue', label: 'All 12 used' },
      ] } })
      : Promise.resolve({ ok: true, data: [] }))
    render(<MemoryRouter><DashboardView /></MemoryRouter>)
    await flushEffects()
    const tile = screen.getAllByTestId('summary-card').find(c => c.getAttribute('data-label') === 'Overdue')
    expect(tile?.getAttribute('data-value')).toBe('1')
    const overdueTab = Array.from(screen.getAllByRole('tablist')[0]!.querySelectorAll('[role="tab"]'))
      .find(t => t.textContent?.includes('Overdue'))! as HTMLElement
    fireEvent.click(overdueTab)
    expect(screen.getAllByTestId('deadline-row').map(r => r.textContent)).toEqual(['Used Up'])
  })

  it("names the Active tile in each list's own words, lower case like the other tiles", async () => {
    const w = (one: string, many: string) => ({ one, many, article: 'a' as const })
    setWords(undefined, { 1: { record: w('customer', 'customers') }, 2: { record: w('job', 'jobs') } })
    mockSafeInvoke.mockImplementation((channel: string) => channel === 'dashboard:get-all'
      ? Promise.resolve({ ok: true, data: { stats: { totalActive: 49, activeByList: [{ grid_id: 1, n: 12 }, { grid_id: 2, n: 37 }] }, deadlines: [], followUps: [], archived: [] } })
      : Promise.resolve({ ok: true, data: [] }))
    render(<MemoryRouter><DashboardView /></MemoryRouter>)
    await flushEffects()
    const labels = screen.getAllByTestId('summary-card').map(c => c.getAttribute('data-label'))
    expect(labels).toContain('Active customers and jobs')
  })
})

describe('DashboardView — next step (Q2)', () => {
  beforeEach(() => { setWords(); vi.clearAllMocks(); setupDefaultMocks() })

  function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname + l.search}</div> }
  function renderAt() {
    return render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/dashboard" element={<DashboardView />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    )
  }
  const onlyDeadlines = (deadlines: unknown[], tasks: unknown[] = []) => mockSafeInvoke.mockImplementation((channel: string) => {
    if (channel === 'dashboard:get-all') return Promise.resolve({ ok: true, data: { stats: sampleStats, deadlines, followUps: [], archived: [] } })
    if (channel === 'task:get-due') return Promise.resolve({ ok: true, data: tasks })
    return Promise.resolve({ ok: true, data: [] })
  })

  it('says what is overdue and opens the most overdue record', async () => {
    onlyDeadlines(sampleDeadlines.slice(0, 2))
    renderAt()
    await flushEffects()
    const banner = screen.getByTestId('next-step')
    expect(banner.textContent).toContain('Review Date is overdue for 2 clients.')
    expect(banner.textContent).toContain('Review Date, 3 days overdue')
    const start = screen.getByRole('button', { name: 'Start with Alice Smith →' })
    expect(start.hasAttribute('data-primary-action')).toBe(true)
    fireEvent.click(start)
    expect(screen.getByTestId('where').textContent).toBe('/profile/1?gridId=1')
  })

  it('counts every kind, and the search does not change it', async () => {
    renderAt()
    await flushEffects()
    // 3 deadlines (-3 days), the task (March) and the follow-up (March) are all late; the follow-up is the oldest
    expect(screen.getByTestId('next-step').textContent).toContain('5 things are overdue: 3 deadlines, 1 task and 1 follow-up.')
    fireEvent.change(screen.getByPlaceholderText('Search…'), { target: { value: 'Bob' } })
    await flushEffects()
    expect(screen.getByTestId('next-step').textContent).toContain('5 things are overdue')

  })

  it('a late task alone opens Tasks', async () => {
    onlyDeadlines([], sampleTasks)
    renderAt()
    await flushEffects()
    expect(screen.getByTestId('next-step').textContent).toContain('1 task is overdue.')
    fireEvent.click(screen.getByRole('button', { name: 'Start with Call insurance →' }))
    expect(screen.getByTestId('where').textContent).toBe('/tasks')
  })

  it('says what the dashboard is for when nothing is due', async () => {
    onlyDeadlines([])
    renderAt()
    await flushEffects()
    const line = screen.getByTestId('next-step')
    expect(line.hasAttribute('data-purpose')).toBe(true)
    expect(line.textContent).toBe('Everything due across your caseloads, most urgent first.')
    expect(screen.queryByRole('button', { name: /Start with/ })).toBeNull()
  })

  it('in other words too', async () => {
    const w = (one: string, many: string) => ({ one, many, article: 'a' as const })
    setWords({ record: w('customer', 'customers'), list: w('shop', 'shops') })
    onlyDeadlines(sampleDeadlines.slice(0, 2))
    renderAt()
    await flushEffects()
    expect(screen.getByTestId('next-step').textContent).toContain('Review Date is overdue for 2 customers.')
  })

  it('no banner while there are no records, or when loading failed', async () => {
    mockSafeInvoke.mockImplementation((channel: string) => channel === 'dashboard:get-all'
      ? Promise.resolve({ ok: true, data: { stats: { totalActive: 0, totalGrids: 1 }, deadlines: [], followUps: [], archived: [] } })
      : Promise.resolve({ ok: true, data: [] }))
    const { unmount } = renderAt()
    await flushEffects()
    expect(screen.queryByTestId('next-step')).toBeNull()
    unmount()
    mockSafeInvoke.mockImplementation(() => Promise.resolve({ ok: false, error: 'Database is locked' }))
    renderAt()
    await flushEffects()
    expect(screen.queryByTestId('next-step')).toBeNull()
  })
})
