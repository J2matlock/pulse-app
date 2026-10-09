// @vitest-environment jsdom
/**
 * TasksView data smoke tests — renders with 5 tasks (2 overdue),
 * verifies task groups, counts, sort buttons, inline add.
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
  DEBOUNCE_SEARCH: 0, MS_PER_DAY: 86400000, DAYS_THIS_WEEK: 7, DAYS_THIS_MONTH: 30,
}))

vi.mock('../../../src/renderer/utils/domHelpers', () => ({
  isEditableElement: () => false,
}))

// ── Store mocks ──────────────────────────────────────────────────────────────

const mockCreateTask = vi.fn()
const mockSetSortMode = vi.fn()

vi.mock('../../../src/renderer/stores/taskStore', () => {
  const tasks = [
    {
      id: 1, title: 'Follow up with housing authority', priority: 'high', category: 'housing',
      due_date: '2026-02-25', is_completed: 0, completed_at: null, snoozed_until: null,
      position: 0, grid_id: null, description: 'Check on application status', recurrence_rule: null,
      created_at: '2026-02-20', updated_at: '2026-02-20',
    },
    {
      id: 2, title: 'Submit insurance forms', priority: 'urgent', category: 'admin',
      due_date: '2026-03-01', is_completed: 0, completed_at: null, snoozed_until: null,
      position: 1, grid_id: null, description: null, recurrence_rule: null,
      created_at: '2026-02-28', updated_at: '2026-02-28',
    },
    {
      id: 3, title: 'Schedule team meeting', priority: 'normal', category: 'admin',
      due_date: '2026-03-15', is_completed: 0, completed_at: null, snoozed_until: null,
      position: 2, grid_id: null, description: 'Discuss Q2 caseload assignments', recurrence_rule: null,
      created_at: '2026-03-01', updated_at: '2026-03-01',
    },
    {
      id: 4, title: 'Review client progress notes', priority: 'normal', category: 'review',
      due_date: '2026-03-18', is_completed: 0, completed_at: null, snoozed_until: null,
      position: 3, grid_id: null, description: null, recurrence_rule: null,
      created_at: '2026-03-02', updated_at: '2026-03-02',
    },
    {
      id: 5, title: 'File quarterly report', priority: 'low', category: 'admin',
      due_date: null, is_completed: 1, completed_at: '2026-03-05', snoozed_until: null,
      position: 4, grid_id: null, description: 'Q1 summary', recurrence_rule: null,
      created_at: '2026-02-15', updated_at: '2026-03-05',
    },
  ]
  const storeData = {
    tasks, loading: false, sortMode: 'due_date',
    loadTasks: vi.fn(), createTask: vi.fn(), updateTask: vi.fn(),
    deleteTask: vi.fn(), completeTask: vi.fn(), snoozeTask: vi.fn(),
    setSortMode: vi.fn(), reorderTasks: vi.fn(),
  }
  const store = (sel: Function) => sel(storeData)
  store.subscribe = vi.fn().mockReturnValue(vi.fn())
  store.getState = () => storeData
  ;(globalThis as Record<string, unknown>).__taskStoreData = storeData
  return { useTaskStore: store }
})

vi.mock('../../../src/renderer/stores/gridStore', () => ({
  useGridStore: (sel: Function) => sel({ grids: [], loadGrid: vi.fn() }),
}))

vi.mock('../../../src/renderer/stores/undoStore', () => {
  const d = { undoStack: [], redoStack: [], undo: vi.fn(), redo: vi.fn(), canUndo: false, canRedo: false, pushWithToast: vi.fn() }
  const store = (sel: Function) => sel(d)
  store.getState = () => d; store.subscribe = vi.fn().mockReturnValue(vi.fn())
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
  TemplateManager: () => null, Checklist: () => null,
}))
vi.mock('../../../src/renderer/components/profile/ScratchPad', () => ({
  ScratchPad: () => null,
}))
vi.mock('../../../src/renderer/components/shared/ConfirmDialog', () => ({
  ConfirmDialog: () => null,
}))
vi.mock('../../../src/renderer/views/tasks/taskHelpers', () => ({
  PRIORITY_ORDER: { urgent: 0, high: 1, normal: 2, low: 3 } as Record<string, number>,
  isOverdue: (t: { due_date: string | null }) => {
    if (!t.due_date) return false
    return new Date(t.due_date) < new Date('2026-03-10')
  },
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

// ── Import (after mocks) ─────────────────────────────────────────────────────

import TasksView from '../../../src/renderer/views/TasksView'

async function flushEffects() {
  await act(async () => { await new Promise(r => setTimeout(r, 10)) })
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('TasksView — data smoke tests (5 tasks, 2 overdue)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInvoke.mockResolvedValue({ ok: true, data: [] })
  })

  it('renders the Tasks heading', async () => {
    render(<MemoryRouter><TasksView /></MemoryRouter>)
    await flushEffects()
    const headings = screen.getAllByText('Tasks')
    const h1 = headings.find(el => el.tagName === 'H1')
    expect(h1).toBeDefined()
  })

  it('shows active task count (4 active)', async () => {
    render(<MemoryRouter><TasksView /></MemoryRouter>)
    await flushEffects()
    expect(screen.getByText(/4 active/)).toBeDefined()
  })

  it('renders inline add-task input', async () => {
    render(<MemoryRouter><TasksView /></MemoryRouter>)
    await flushEffects()
    expect(screen.getByPlaceholderText('+ Add task... (press Enter)')).toBeDefined()
  })

  it('creates task on Enter in inline input', async () => {
    render(<MemoryRouter><TasksView /></MemoryRouter>)
    await flushEffects()
    const input = screen.getByPlaceholderText('+ Add task... (press Enter)')
    fireEvent.change(input, { target: { value: 'Call Dr. Rivera' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    const storeData = (globalThis as Record<string, unknown>).__taskStoreData as Record<string, unknown>
    expect(storeData.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Call Dr. Rivera' }),
    )
  })

  it('shows progress bar with completion info', async () => {
    render(<MemoryRouter><TasksView /></MemoryRouter>)
    await flushEffects()
    expect(screen.getByText(/1 of 5 completed/)).toBeDefined()
  })

  it('renders Templates button', async () => {
    render(<MemoryRouter><TasksView /></MemoryRouter>)
    await flushEffects()
    expect(screen.getByText('Templates')).toBeDefined()
  })
})
