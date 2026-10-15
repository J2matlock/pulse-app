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
    canUndo: false, canRedo: false, pushWithToast: vi.fn(), push: vi.fn(),
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
  UrgentChecklistSection: ({ items, onToggle }: { items: Array<{ id: number; title: string }>; onToggle: (i: unknown) => void }) => (
    <div data-testid="urgent-section">
      {items.map(i => <button key={i.id} onClick={() => onToggle(i)}>{`Tick ${i.title}`}</button>)}
    </div>
  ),
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
  isSnoozed: () => false,
}))

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  closestCenter: vi.fn(),
  PointerSensor: class {}, KeyboardSensor: class {},
  useSensor: () => ({}),
  useSensors: () => [],
}))
vi.mock('@dnd-kit/sortable', () => ({
  sortableKeyboardCoordinates: vi.fn(),
  SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  verticalListSortingStrategy: {},
  arrayMove: vi.fn(),
  useSortable: () => ({ attributes: {}, listeners: {}, setNodeRef: vi.fn(), transform: null, transition: null, isDragging: false }),
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

  it('a repeating urgent checklist item ticked off comes back at its next date (bug sweep S2)', async () => {
    const { setWords, EXISTING_FEATURES } = await import('../vocabFixture')
    const item = { id: 1, row_id: 2, title: 'Sign consent', client_name: 'Ann', is_completed: 0, due_date: '2026-10-01', recurrence_rule: '{"type":"monthly","interval":1}' }
    let urgentLoads = 0
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'checklist:get-urgent') { urgentLoads++; return Promise.resolve({ ok: true, data: [urgentLoads === 1 ? item : { ...item, due_date: '2026-11-01' }] }) }
      if (channel === 'checklist:update-item') return Promise.resolve({ ok: true, data: { sysLogId: null, repeat: { previousDue: '2026-10-01', nextDue: '2026-11-01' } } })
      return Promise.resolve({ ok: true, data: [] })
    })
    setWords(undefined, {}, { ...EXISTING_FEATURES, checklists: true })
    try {
      render(<MemoryRouter><TasksView /></MemoryRouter>)
      await flushEffects()
      await act(async () => { fireEvent.click(screen.getByText('Tick Sign consent')) })
      await flushEffects()
      expect(screen.getByText('Tick Sign consent')).toBeDefined()
      expect(screen.getByText(/1 urgent/)).toBeDefined()
    } finally { setWords() }
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

  it('shows a group straight away when there are no tasks yet', async () => {
    const data = taskStoreData()
    const usual = { tasks: data.tasks, sortMode: data.sortMode }
    data.tasks = []
    data.sortMode = 'manual'
    const group = { id: 4, name: 'New Group', position: 0, is_collapsed: 0, created_at: '2026-10-11' }
    mockInvoke.mockImplementation((channel: string) => Promise.resolve(channel === 'task:group-get-all'
      ? { ok: true, data: [group] } : { ok: true, data: [] }))
    try {
      render(<MemoryRouter><TasksView /></MemoryRouter>)
      await flushEffects()
      expect(screen.getByLabelText('Collapse New Group')).toBeDefined()
      expect(screen.queryByText('No tasks yet')).toBeNull()
    } finally { Object.assign(data, usual) }
  })

  it('a group still called "New Group" opens for typing only when just added, not on every visit (bug sweep S2)', async () => {
    const data = taskStoreData()
    const usual = { sortMode: data.sortMode }
    data.sortMode = 'manual'
    const old = { id: 4, name: 'New Group', position: 0, is_collapsed: 0, created_at: '2026-10-11' }
    mockInvoke.mockImplementation((channel: string) => Promise.resolve(
      channel === 'task:group-get-all' ? { ok: true, data: [old] }
      : channel === 'task:group-create' ? { ok: true, data: { ...old, id: 5, position: 1 } }
      : { ok: true, data: [] }))
    try {
      render(<MemoryRouter><TasksView /></MemoryRouter>)
      await flushEffects()
      expect(screen.queryByDisplayValue('New Group')).toBeNull()
      await act(async () => { fireEvent.click(screen.getByTitle('Add a group to organize tasks')) })
      // Only the one just made opens
      expect(screen.getAllByDisplayValue('New Group')).toHaveLength(1)
      expect(screen.getAllByTitle('Click to rename')).toHaveLength(1)
    } finally { Object.assign(data, usual) }
  })

  it('a group rename that fails says so, keeps the old name and adds no undo step (bug sweep S2)', async () => {
    const toast = (await import('react-hot-toast')).default
    const undo = (await import('../../../src/renderer/stores/undoStore')).useUndoStore.getState()
    const data = taskStoreData()
    const usual = { sortMode: data.sortMode }
    data.sortMode = 'manual'
    const group = { id: 4, name: 'Calls', position: 0, is_collapsed: 0, created_at: '2026-10-11' }
    mockInvoke.mockImplementation((channel: string) => Promise.resolve(
      channel === 'task:group-get-all' ? { ok: true, data: [group] }
      : channel === 'task:group-update' || channel === 'task:group-delete' ? { ok: false, error: 'disk full' }
      : { ok: true, data: [] }))
    vi.mocked(undo.push).mockClear()
    vi.mocked(toast.error).mockClear()
    try {
      render(<MemoryRouter><TasksView /></MemoryRouter>)
      await flushEffects()
      fireEvent.click(screen.getByTitle('Click to rename'))
      const input = screen.getByDisplayValue('Calls')
      fireEvent.change(input, { target: { value: 'Phone calls' } })
      await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
      expect(toast.error).toHaveBeenCalledWith("We couldn't rename the group — try again")
      expect(screen.getByText('Calls')).toBeDefined()
      expect(undo.push).not.toHaveBeenCalled()
    } finally { Object.assign(data, usual) }
  })

  it('adding a group while sorted by date switches to My order, where groups show', async () => {
    const data = taskStoreData()
    mockInvoke.mockImplementation((channel: string) => Promise.resolve(channel === 'task:group-create'
      ? { ok: true, data: { id: 5, name: 'New Group', position: 0, is_collapsed: 0, created_at: '2026-10-11' } } : { ok: true, data: [] }))
    render(<MemoryRouter><TasksView /></MemoryRouter>)
    await flushEffects()
    await act(async () => { fireEvent.click(screen.getByTitle('Add a group to organize tasks')) })
    expect(data.setSortMode).toHaveBeenCalledWith('manual')
  })

  it('renders the inline add-task input', async () => {
    render(<MemoryRouter><TasksView /></MemoryRouter>)
    await flushEffects()
    const addInput = screen.getByPlaceholderText('+ Add task… (press Enter)')
    expect(addInput).toBeDefined()
  })

  it('calls createTask when Enter is pressed in the inline input', async () => {
    render(<MemoryRouter><TasksView /></MemoryRouter>)
    await flushEffects()

    const addInput = screen.getByPlaceholderText('+ Add task… (press Enter)')
    fireEvent.change(addInput, { target: { value: 'New task item' } })
    fireEvent.keyDown(addInput, { key: 'Enter' })

    expect(taskStoreData().createTask).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'New task item' }),
    )
  })

  it('renders the Add a set of tasks button (UX D-33)', async () => {
    render(<MemoryRouter><TasksView /></MemoryRouter>)
    await flushEffects()
    expect(screen.getByText('Add a set of tasks…')).toBeDefined()
  })

  it('sorts by due date or priority from the Order menu (audit S-20, UX D-43)', async () => {
    render(<MemoryRouter><TasksView /></MemoryRouter>)
    await flushEffects()
    expect(screen.getAllByTestId('task-item').map(e => e.textContent)).toEqual(['Call insurance company', 'Review case notes'])
    fireEvent.change(screen.getByLabelText('Order:'), { target: { value: 'priority' } })
    expect(taskStoreData().setSortMode).toHaveBeenCalledWith('priority')
  })

  it('leaves the progress bar out until there are 5 tasks (UX D-43)', async () => {
    render(<MemoryRouter><TasksView /></MemoryRouter>)
    await flushEffects()

    // 1 completed out of 3 total: too few to be worth a bar
    expect(screen.queryByText(/1 of 3 completed/)).toBeNull()
  })
})
