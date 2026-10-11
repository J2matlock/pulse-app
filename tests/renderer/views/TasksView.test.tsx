// @vitest-environment jsdom
/**
 * TasksView interaction tests — sort modes, inline add, toggle, empty state.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
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

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom') as object
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
  }
})

vi.mock('lucide-react', async () => (await import('../lucideMock')).lucideMock)

vi.mock('../../../src/renderer/utils/rendererLogger', () => ({
  rlog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../../src/shared/constants', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('../../../src/shared/constants')),
  DEBOUNCE_SEARCH: 0,
  MS_PER_DAY: 86400000,
  DAYS_THIS_WEEK: 7,
  DAYS_THIS_MONTH: 30,
}))

vi.mock('../../../src/renderer/utils/domHelpers', () => ({
  isEditableElement: () => false,
}))

// ── Store mocks ──────────────────────────────────────────────────────────────

const mockSetSortMode = vi.fn()
const mockCreateTask = vi.fn()

vi.mock('../../../src/renderer/stores/taskStore', () => {
  const sampleTasks = [
    {
      id: 1, title: 'Call insurance company', priority: 'high', category: 'admin',
      due_date: '2026-03-06', is_completed: 0, completed_at: null, snoozed_until: null,
      position: 0, grid_id: null, description: null, recurrence_rule: null,
      created_at: '2026-03-01', updated_at: '2026-03-01',
    },
    {
      id: 2, title: 'Review case notes', priority: 'normal', category: 'review',
      due_date: '2026-03-08', is_completed: 0, completed_at: null, snoozed_until: null,
      position: 1, grid_id: null, description: null, recurrence_rule: null,
      created_at: '2026-03-01', updated_at: '2026-03-01',
    },
    {
      id: 3, title: 'Completed old task', priority: 'low', category: null,
      due_date: null, is_completed: 1, completed_at: '2026-03-04', snoozed_until: null,
      position: 2, grid_id: null, description: null, recurrence_rule: null,
      created_at: '2026-03-01', updated_at: '2026-03-01',
    },
  ]
  const storeData = {
    tasks: sampleTasks, loading: false, sortMode: 'due_date',
    loadTasks: vi.fn(), createTask: vi.fn(), updateTask: vi.fn(),
    deleteTask: vi.fn(), completeTask: vi.fn(), snoozeTask: vi.fn(),
    setSortMode: vi.fn(), reorderTasks: vi.fn(),
  }
  const store = (selector: Function) => selector(storeData)
  store.subscribe = vi.fn().mockReturnValue(vi.fn())
  store.getState = () => storeData
  // Expose for test assertions
  ;(globalThis as Record<string, unknown>).__taskStoreData = storeData
  return { useTaskStore: store }
})

vi.mock('../../../src/renderer/stores/gridStore', () => ({
  useGridStore: (selector: Function) => selector({
    grids: [], loadGrid: vi.fn(),
  }),
}))

vi.mock('../../../src/renderer/stores/undoStore', () => {
  const storeData = {
    undoStack: [], redoStack: [], undo: vi.fn(), redo: vi.fn(),
    canUndo: false, canRedo: false, pushWithToast: vi.fn(),
  }
  const store = (selector: Function) => selector(storeData)
  store.getState = () => storeData
  store.subscribe = vi.fn().mockReturnValue(vi.fn())
  return { useUndoStore: store }
})

// ── Mock sub-components ──────────────────────────────────────────────────────

vi.mock('../../../src/renderer/views/tasks/TaskFormDialog', () => ({
  TaskFormDialog: () => null,
}))
vi.mock('../../../src/renderer/views/tasks/SnoozeDialog', () => ({
  SnoozeDialog: () => null,
}))
vi.mock('../../../src/renderer/views/tasks/TaskGroup', () => ({
  TaskGroup: ({ title, tasks }: { title: string; tasks: unknown[] }) => (
    <div data-testid="task-group" data-title={title}>
      <span>{title}</span>
      <span data-testid="task-count">{tasks.length}</span>
    </div>
  ),
}))
vi.mock('../../../src/renderer/views/tasks/UrgentChecklistSection', () => ({
  UrgentChecklistSection: () => <div data-testid="urgent-section" />,
}))
vi.mock('../../../src/renderer/components/tasks/TaskItem', () => ({
  TaskItem: ({ task }: { task: { title: string } }) => (
    <div data-testid="task-item">{task.title}</div>
  ),
  CompletedTaskItem: ({ task }: { task: { title: string } }) => (
    <div data-testid="completed-task-item">{task.title}</div>
  ),
}))
vi.mock('../../../src/renderer/components/profile/Checklist', () => ({
  TemplateManager: () => null,
  Checklist: () => null,
}))
vi.mock('../../../src/renderer/components/profile/ScratchPad', () => ({
  ScratchPad: () => null,
}))
vi.mock('../../../src/renderer/components/shared/ConfirmDialog', () => ({
  ConfirmDialog: () => null,
}))

vi.mock('../../../src/renderer/views/tasks/taskHelpers', () => ({
  PRIORITY_ORDER: { urgent: 0, high: 1, normal: 2, low: 3 } as Record<string, number>,
  isOverdue: () => false,
  isDueToday: () => false,
  isDueThisWeek: () => false,
  isSnoozed: () => false,
}))

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  closestCenter: vi.fn(),
  PointerSensor: class {},
  useSensor: () => ({}),
  useSensors: () => [],
}))
vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  verticalListSortingStrategy: {},
  arrayMove: vi.fn(),
}))

// ── Import view ─────────────────────────────────────────────────────────────

import TasksView from '../../../src/renderer/views/TasksView'

async function flushEffects() {
  await act(async () => { await new Promise(r => setTimeout(r, 10)) })
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('TasksView — interactions', () => {
  const taskStoreData = () => (globalThis as Record<string, unknown>).__taskStoreData as Record<string, unknown>

  beforeEach(() => {
    vi.clearAllMocks()
    mockInvoke.mockImplementation(() => Promise.resolve({ ok: true, data: [] }))
  })

  it('renders the Tasks heading and active count', async () => {
    render(<MemoryRouter><TasksView /></MemoryRouter>)
    await flushEffects()
    const headings = screen.getAllByText('Tasks')
    const h1 = headings.find(el => el.tagName === 'H1')
    expect(h1).toBeDefined()
    expect(screen.getByText(/2 active/)).toBeDefined()
  })

  it('says the tasks could not be loaded instead of showing an empty list', async () => {
    const data = taskStoreData()
    const usual = data.loadTasks
    data.loadTasks = vi.fn().mockResolvedValue(false)
    try {
      render(<MemoryRouter><TasksView /></MemoryRouter>)
      await flushEffects()
      expect(screen.getByRole('alert').textContent).toMatch(/couldn.t load your tasks/)
    } finally { data.loadTasks = usual }
  })

  it('counts urgent checklist items only while Checklists is on', async () => {
    const { setWords, EXISTING_FEATURES } = await import('../vocabFixture')
    mockInvoke.mockImplementation((channel: string) => Promise.resolve(channel === 'checklist:get-urgent'
      ? { ok: true, data: [{ id: 1, row_id: 2, title: 'Sign consent', client_name: 'Ann', is_completed: 0 }] }
      : { ok: true, data: [] }))
    setWords(undefined, {}, { ...EXISTING_FEATURES, checklists: true })
    const first = render(<MemoryRouter><TasksView /></MemoryRouter>)
    await flushEffects()
    expect(screen.getByText(/2 active · 1 urgent/)).toBeDefined()
    first.unmount()
    setWords(undefined, {}, { ...EXISTING_FEATURES, checklists: false })
    render(<MemoryRouter><TasksView /></MemoryRouter>)
    await flushEffects()
    expect(screen.queryByText(/urgent/)).toBeNull()
    setWords()
  })

  it('renders the inline add-task input', async () => {
    render(<MemoryRouter><TasksView /></MemoryRouter>)
    await flushEffects()
    const addInput = screen.getByPlaceholderText('+ Add task... (press Enter)')
    expect(addInput).toBeDefined()
  })

  it('calls createTask when Enter is pressed in the inline input', async () => {
    render(<MemoryRouter><TasksView /></MemoryRouter>)
    await flushEffects()

    const addInput = screen.getByPlaceholderText('+ Add task... (press Enter)')
    fireEvent.change(addInput, { target: { value: 'New task item' } })
    fireEvent.keyDown(addInput, { key: 'Enter' })

    expect(taskStoreData().createTask).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'New task item' }),
    )
  })

  it('renders Templates button', async () => {
    render(<MemoryRouter><TasksView /></MemoryRouter>)
    await flushEffects()
    expect(screen.getByText('Templates')).toBeDefined()
  })

  it('sorts by due date or priority from the Sort menu (audit S-20)', async () => {
    render(<MemoryRouter><TasksView /></MemoryRouter>)
    await flushEffects()
    expect(screen.getAllByTestId('task-item').map(e => e.textContent)).toEqual(['Call insurance company', 'Review case notes'])
    fireEvent.change(screen.getByLabelText('Sort:'), { target: { value: 'priority' } })
    expect(taskStoreData().setSortMode).toHaveBeenCalledWith('priority')
  })

  it('shows progress bar with completion info', async () => {
    render(<MemoryRouter><TasksView /></MemoryRouter>)
    await flushEffects()

    // 1 completed out of 3 total = "1 of 3 completed"
    expect(screen.getByText(/1 of 3 completed/)).toBeDefined()
  })
})
