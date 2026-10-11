// @vitest-environment jsdom
/**
 * viewSmoke.test.tsx — Meaningful render tests for main views.
 * Verifies each view renders key UI elements, empty states, and interactive controls.
 */
import { describe, it, expect, vi, beforeEach, afterEach, onTestFinished } from 'vitest'
import React from 'react'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

// ── Global mocks ─────────────────────────────────────────────────────────────

const mockInvoke = vi.fn()

const mockOn = vi.fn().mockReturnValue(vi.fn()) // returns unsubscribe fn
Object.defineProperty(window, 'api', {
  value: { invoke: mockInvoke, on: mockOn, copyToClipboard: vi.fn() },
  writable: true,
})

// Mock crypto.randomUUID if not available
if (!globalThis.crypto?.randomUUID) {
  vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2) })
}

// Mock react-hot-toast
vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

// Mock zustand/react/shallow — pass selector through
vi.mock('zustand/react/shallow', () => ({ useShallow: (fn: Function) => fn }))

// Mock lucide-react — explicit icon stubs (Proxy approach causes vitest hang)
vi.mock('lucide-react', async () => (await import('../lucideMock')).lucideMock)

// Mock safeInvoke — return ok:false so data-setting branches are skipped,
// preserving initial state values (prevents undefined.map errors)
vi.mock('../../../src/renderer/utils/safeInvoke', () => ({
  safeInvoke: vi.fn().mockResolvedValue({ ok: false, error: 'test-mock' }),
}))

// Mock rendererLogger
vi.mock('../../../src/renderer/utils/rendererLogger', () => ({
  rlog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

// ── Store mocks ──────────────────────────────────────────────────────────────

vi.mock('../../../src/renderer/stores/settingsStore', () => {
  const storeData = {
    theme: 'light', setTheme: vi.fn(),
    uiScale: 100, setUiScale: vi.fn(),
    gridDensity: 'normal', setGridDensity: vi.fn(),
    sidebarWidth: 240, setSidebarWidth: vi.fn(),
    rowStriping: true, setRowStriping: vi.fn(),
    gridLines: true, setGridLines: vi.fn(),
    reducedMotion: false, setReducedMotion: vi.fn(),
    highContrast: false, setHighContrast: vi.fn(),
    clockFormat: '12h', setClockFormat: vi.fn(),
    weekStart: 'sunday', setWeekStart: vi.fn(),
    locked: false, setLocked: vi.fn(),
    setRecoverySession: vi.fn(),
    setPasswordSetup: vi.fn(),
    isLocked: false, isPasswordSetup: true,
    autoLockMinutes: 0, focusModeOpen: false,
    recoverySession: false,
  }
  return { useSettingsStore: (selector?: Function) => selector ? selector(storeData) : storeData }
})

vi.mock('../../../src/renderer/stores/alertStore', () => ({
  useAlertStore: (selector: Function) => selector({
    rules: [], isLoaded: true, loadRules: vi.fn(),
  }),
}))

vi.mock('../../../src/renderer/stores/taskStore', () => {
  const storeData = {
    tasks: [], loading: false, isLoaded: false,
    loadTasks: vi.fn(), createTask: vi.fn(), updateTask: vi.fn(),
    deleteTask: vi.fn(), completeTask: vi.fn(), snoozeTask: vi.fn(),
    setSortMode: vi.fn(), reorderTasks: vi.fn(),
    sortMode: 'due_date', filter: 'all', setFilter: vi.fn(),
  }
  const store = (selector: Function) => selector(storeData)
  store.subscribe = vi.fn().mockReturnValue(vi.fn())
  store.getState = () => storeData
  return { useTaskStore: store }
})

vi.mock('../../../src/renderer/stores/gridStore', () => ({
  useGridStore: (selector: Function) => selector({
    grids: [], rows: [], columns: [], activeGridId: null,
    isLoading: false, loadGridList: vi.fn(), loadGrid: vi.fn(),
    searchQuery: '', setSearchQuery: vi.fn(),
    sortConfig: [], showArchived: false,
    acuityLevels: [], acuityEnabled: false,
    hiddenColumns: [], sortedRowIds: [],
    updateRow: vi.fn(), updateCell: vi.fn(),
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

vi.mock('../../../src/renderer/stores/contactsStore', () => {
  const contactsStoreData = {
    providers: [], initialLoadDone: true, selectedProviderId: null,
    selectedProvider: null, viewMode: 'list', setViewMode: vi.fn(),
    loadProviders: vi.fn(), loadCategories: vi.fn(),
    selectProvider: vi.fn(), toggleStar: vi.fn(),
    filterParams: { search: '', categoryId: null, availability: null, availabilityStatus: null, starred: false },
    categories: [], customFields: [],
  }
  const store = (selector: Function) => selector(contactsStoreData)
  store.getState = () => contactsStoreData
  store.subscribe = vi.fn().mockReturnValue(vi.fn())
  return { useContactsStore: store }
})

vi.mock('../../../src/renderer/stores/profileStore', () => ({
  useProfileStore: (selector: Function) => selector({
    addRecentProfile: vi.fn(),
    recentProfiles: [],
  }),
}))

// ── Mock heavy child components to isolate view rendering ────────────────────

// Dashboard sub-components
vi.mock('../../../src/renderer/views/dashboard/SummaryCard', () => ({
  SummaryCard: ({ label }: { label: string }) => <div data-testid="summary-card">{label}</div>,
}))
vi.mock('../../../src/renderer/views/dashboard/DeadlineRow', () => ({
  DeadlineRow: () => <div data-testid="deadline-row" />,
}))
vi.mock('../../../src/renderer/views/dashboard/TaskRow', () => ({
  TaskRow: () => <div data-testid="task-row" />,
}))
vi.mock('../../../src/renderer/views/dashboard/FollowUpDashRow', () => ({
  FollowUpDashRow: () => <div data-testid="followup-row" />,
}))
vi.mock('../../../src/renderer/views/dashboard/WeekViewTab', () => ({
  WeekViewTab: () => <div data-testid="week-view" />,
}))
vi.mock('../../../src/renderer/views/dashboard/MonthViewTab', () => ({
  MonthViewTab: () => <div data-testid="month-view" />,
}))
vi.mock('../../../src/renderer/views/dashboard/RecentlyArchivedTab', () => ({
  RecentlyArchivedTab: () => <div data-testid="archived-tab" />,
}))

// Contacts sub-components
vi.mock('../../../src/renderer/components/contacts/CategoryManager', () => ({
  CategoryManager: () => null,
}))
vi.mock('../../../src/renderer/components/contacts/ContactForm', () => ({
  ContactForm: () => null,
}))
vi.mock('../../../src/renderer/components/contacts/ContactCard', () => ({
  ContactCard: () => null,
}))
vi.mock('../../../src/renderer/components/contacts/ContactRow', () => ({
  ContactRow: () => null,
}))
vi.mock('../../../src/renderer/components/contacts/ContactFilterBar', () => ({
  ContactFilterBar: () => <div data-testid="contact-filter-bar" />,
}))
vi.mock('../../../src/renderer/components/contacts/ContactDetail', () => ({
  ContactDetail: () => null,
}))
vi.mock('../../../src/renderer/components/contacts/ContactImportExport', () => ({
  ContactImportExport: () => null,
}))

// Tasks sub-components
vi.mock('../../../src/renderer/views/tasks/TaskFormDialog', () => ({
  TaskFormDialog: () => null,
}))
vi.mock('../../../src/renderer/views/tasks/SnoozeDialog', () => ({
  SnoozeDialog: () => null,
}))
vi.mock('../../../src/renderer/views/tasks/TaskGroup', () => ({
  TaskGroup: () => null,
}))
vi.mock('../../../src/renderer/views/tasks/UrgentChecklistSection', () => ({
  UrgentChecklistSection: () => null,
}))
vi.mock('../../../src/renderer/components/tasks/TaskItem', () => ({
  TaskItem: () => null,
  CompletedTaskItem: () => null,
}))
vi.mock('../../../src/renderer/components/profile/Checklist', () => ({
  TemplateManager: () => null,
  Checklist: () => null,
}))
vi.mock('../../../src/renderer/components/profile/ScratchPad', () => ({
  ScratchPad: () => null,
}))

// FocusModeView sub-components
vi.mock('../../../src/renderer/views/focus-mode/FocusSection', () => ({
  FocusSection: () => null,
}))
vi.mock('../../../src/renderer/views/focus-mode/ClientFocusItem', () => ({
  ClientFocusItem: () => null,
}))
vi.mock('../../../src/renderer/views/focus-mode/ChecklistFocusItem', () => ({
  ChecklistFocusItem: () => null,
}))
vi.mock('../../../src/renderer/views/focus-mode/FollowUpFocusItem', () => ({
  FollowUpFocusItem: () => null,
}))
vi.mock('../../../src/renderer/views/focus-mode/TaskFocusItem', () => ({
  TaskFocusItem: () => null,
}))

// Shared components
vi.mock('../../../src/renderer/components/shared/ConfirmDialog', () => ({
  ConfirmDialog: () => null,
}))
vi.mock('../../../src/renderer/components/shared/EmptyState', () => ({
  EmptyState: ({ title, description }: { title: string; description?: string }) => (
    <div data-testid="empty-state">
      <span>{title}</span>
      {description && <span>{description}</span>}
    </div>
  ),
}))
vi.mock('../../../src/renderer/components/shared/LoadingSpinner', () => ({
  LoadingSpinner: () => <div data-testid="loading-spinner" />,
}))

// PasswordSetupView sub-components
vi.mock('../../../src/renderer/components/shared/RecoveryKeyDisplayModal', () => ({
  RecoveryKeyDisplayModal: () => null,
}))

// HelpView sub-components
vi.mock('../../../src/renderer/components/shared/TourOverlay', () => ({
  STEPS: [],
}))
vi.mock('../../../src/renderer/views/help/faqData', () => ({
  FAQ_ITEMS: [],
}))
vi.mock('../../../src/renderer/views/help/types', () => ({
  CATEGORY_LABELS: {},
  ALL_CATEGORIES: [],
}))
vi.mock('../../../src/renderer/views/help/highlightText', () => ({
  highlightText: (text: string) => text,
}))

// FocusModeView hooks
vi.mock('../../../src/renderer/hooks/useFocusTrap', () => ({
  useFocusTrap: () => ({ current: null }),
}))

// Mock deadlineCalc
vi.mock('../../../src/renderer/utils/deadlineCalc', () => ({
  computeDaysUntil: () => 0,
  computeEffectiveDeadline: () => null,
  getMatchingThreshold: () => null,
}))

// Mock domHelpers
vi.mock('../../../src/renderer/utils/domHelpers', () => ({
  isEditableElement: () => false,
}))

// Mock snippetExpander
vi.mock('../../../src/renderer/utils/snippetExpander', () => ({
  expandVariables: (text: string) => text,
}))

// Mock tasks/taskHelpers
vi.mock('../../../src/renderer/views/tasks/taskHelpers', () => ({
  PRIORITY_ORDER: {},
  isOverdue: () => false,
  isDueToday: () => false,
  isSnoozed: () => false,
}))

// Mock @dnd-kit
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

// Mock shared/constants
vi.mock('../../../src/shared/constants', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('../../../src/shared/constants')),
  DEBOUNCE_SEARCH: 150,
  DEBOUNCE_TASK_RELOAD: 300,
  SPINNER_DELAY: 0,
  MS_PER_DAY: 86400000,
  DAYS_THIS_WEEK: 7,
  DAYS_THIS_MONTH: 30,
}))

// Mock useCopyFeedback hook (used by ProfileView)
vi.mock('../../../src/renderer/hooks/useCopyFeedback', () => ({
  useCopyFeedback: () => ({ copied: false, copyToClipboard: vi.fn() }),
}))

// Mock ProfileView sub-components
vi.mock('../../../src/renderer/components/profile/ProfileHeader', () => ({
  ProfileHeader: () => <div data-testid="profile-header">Profile Header</div>,
}))
vi.mock('../../../src/renderer/components/profile/DeadlinePanel', () => ({
  DeadlinePanel: () => <div data-testid="deadline-panel">Deadline Panel</div>,
}))
vi.mock('../../../src/renderer/components/profile/CaseLog', () => ({
  // The record page puts deadlines and details between the note box and past notes
  CaseLog: ({ between }: { between?: React.ReactNode }) => <><div data-testid="case-log">Case Log</div>{between}</>,
}))
vi.mock('../../../src/renderer/components/profile/GridDataSummary', () => ({
  GridDataSummary: () => <div data-testid="grid-data-summary" />,
}))
vi.mock('../../../src/renderer/components/profile/RelatedDocuments', () => ({
  RelatedDocuments: () => <div data-testid="related-documents" />,
}))
vi.mock('../../../src/renderer/components/profile/LinkedProviders', () => ({
  LinkedProviders: () => <div data-testid="linked-providers" />,
}))
vi.mock('../../../src/renderer/components/profile/ProfilePrintLayout', () => ({
  ProfilePrintLayout: () => null,
}))

// ── Top-level imports (after all vi.mock calls) ──────────────────────────────

import DashboardView from '../../../src/renderer/views/DashboardView'
import { safeInvoke } from '../../../src/renderer/utils/safeInvoke'
import ContactsView from '../../../src/renderer/views/ContactsView'
import TasksView from '../../../src/renderer/views/TasksView'
import TrashView from '../../../src/renderer/views/TrashView'
import HelpView from '../../../src/renderer/views/HelpView'
import FocusModeView from '../../../src/renderer/views/FocusModeView'
import { PasswordSetupView } from '../../../src/renderer/views/PasswordSetupView'
import ProfileView from '../../../src/renderer/views/ProfileView'
import { setWords } from '../vocabFixture'

// ── Default IPC mock ─────────────────────────────────────────────────────────

beforeEach(() => {
  setWords()
  vi.clearAllMocks()
  mockInvoke.mockImplementation(() => Promise.resolve({ ok: true, data: [] }))
})

// Helper: flush pending microtasks / effects
async function flushEffects() {
  await act(async () => {
    await new Promise(r => setTimeout(r, 0))
  })
}

// ── DashboardView ─────────────────────────────────────────────────────────────

describe('DashboardView', () => {
  // A failed dashboard load shows an error instead, so give it an empty one
  beforeEach(() => {
    vi.mocked(safeInvoke).mockImplementation(((channel: string) => Promise.resolve(channel === 'dashboard:get-all'
      ? { ok: true, data: { stats: { totalActive: 0, totalGrids: 0 }, deadlines: [], followUps: [], archived: [] } }
      : { ok: false, error: 'test-mock' })) as never)
  })
  afterEach(() => { vi.mocked(safeInvoke).mockResolvedValue({ ok: false, error: 'test-mock' } as never) })

  it('renders the Dashboard heading', async () => {
    render(<MemoryRouter><DashboardView /></MemoryRouter>)
    await flushEffects()
    expect(screen.getByText('Dashboard')).toBeDefined()
    expect(screen.getByText('Dashboard').tagName).toBe('H1')
  })

  it('renders summary cards with expected labels', async () => {
    render(<MemoryRouter><DashboardView /></MemoryRouter>)
    await flushEffects()
    const cards = screen.getAllByTestId('summary-card')
    expect(cards.length).toBe(5)
    const cardLabels = cards.map(c => c.textContent)
    expect(cardLabels).toContain('Active clients')
    expect(cardLabels).toContain('Overdue deadlines')
    expect(cardLabels).toContain('Due in the next 7 days')
    expect(cardLabels).toContain('Due in the next 30 days')
    expect(cardLabels).toContain('Tasks & follow-ups due or late')
  })

  it('renders top tab bar with Priority List selected by default', async () => {
    render(<MemoryRouter><DashboardView /></MemoryRouter>)
    await flushEffects()
    const priorityTab = screen.getByRole('tab', { name: /Priority List/i })
    expect(priorityTab).toBeDefined()
    expect(priorityTab.getAttribute('aria-selected')).toBe('true')
    // Recently archived is a link now, and Overdue is one tab, not two (D-21)
    expect(screen.getByRole('button', { name: /Recently archived/i })).toBeDefined()
    expect(screen.getAllByRole('tab', { name: /^Overdue$/i }).length).toBe(1)
    expect(screen.getAllByRole('tab').length).toBe(4)
  })

  it('renders search input on Priority List tab', async () => {
    render(<MemoryRouter><DashboardView /></MemoryRouter>)
    await flushEffects()
    const searchInput = screen.getByPlaceholderText('Search…')
    expect(searchInput).toBeDefined()
    expect(searchInput.getAttribute('type')).toBe('search')
  })

  it('has no duplicate All / Overdue sub-filter (D-21)', async () => {
    render(<MemoryRouter><DashboardView /></MemoryRouter>)
    await flushEffects()
    const tabNames = screen.getAllByRole('tab').map(t => t.textContent?.trim())
    expect(tabNames).not.toContain('All')
  })
})

// ── ContactsView ──────────────────────────────────────────────────────────────

describe('ContactsView', () => {
  it('renders the Provider Directory heading', async () => {
    render(<MemoryRouter><ContactsView /></MemoryRouter>)
    await flushEffects()
    const heading = screen.getByRole('heading', { name: 'Provider directory' })
    expect(heading).toBeDefined()
    expect(heading.tagName).toBe('H1')
  })

  it('renders action buttons (Add Provider, Import, Export, Categories)', async () => {
    render(<MemoryRouter><ContactsView /></MemoryRouter>)
    await flushEffects()
    expect(screen.getByText('Add Provider')).toBeDefined()
    expect(screen.getByText('Import')).toBeDefined()
    expect(screen.getByText('Export')).toBeDefined()
    expect(screen.getByText('Categories')).toBeDefined()
  })

  it('shows empty state when no providers exist', async () => {
    render(<MemoryRouter><ContactsView /></MemoryRouter>)
    await flushEffects()
    expect(screen.getByTestId('empty-state')).toBeDefined()
    expect(screen.getByText('No providers yet')).toBeDefined()
  })

  it('shows provider count in header', async () => {
    render(<MemoryRouter><ContactsView /></MemoryRouter>)
    await flushEffects()
    expect(screen.getByText('0 providers')).toBeDefined()
  })

  it('with no contacts, leaves out the empty "select one" panel (polish V1)', async () => {
    render(<MemoryRouter><ContactsView /></MemoryRouter>)
    await flushEffects()
    expect(screen.queryByText('Select a provider to view details')).toBeNull()
  })
})

// ── TasksView ──────────────────────────────────────────────────────────────────

describe('TasksView', () => {
  it('renders the Tasks heading', async () => {
    render(<MemoryRouter><TasksView /></MemoryRouter>)
    await flushEffects()
    const heading = screen.getByRole('heading', { name: 'Tasks' })
    expect(heading).toBeDefined()
    expect(heading.tagName).toBe('H1')
  })

  it('renders the Templates button', async () => {
    render(<MemoryRouter><TasksView /></MemoryRouter>)
    await flushEffects()
    expect(screen.getByText('Templates')).toBeDefined()
  })

  it('shows empty state when no tasks exist', async () => {
    // Loaded fine, just empty (a failed load says so instead)
    const { safeInvoke } = await import('../../../src/renderer/utils/safeInvoke')
    vi.mocked(safeInvoke).mockResolvedValue({ ok: true, data: [] })
    onTestFinished(() => { vi.mocked(safeInvoke).mockResolvedValue({ ok: false, error: 'test-mock' }) })
    render(<MemoryRouter><TasksView /></MemoryRouter>)
    await flushEffects()
    expect(screen.getByTestId('empty-state')).toBeDefined()
    expect(screen.getAllByText('No tasks yet').length).toBeGreaterThan(0)
  })

  it('shows active count in header', async () => {
    render(<MemoryRouter><TasksView /></MemoryRouter>)
    await flushEffects()
    expect(screen.getByText(/0 active/)).toBeDefined()
  })
})

// ── TrashView ──────────────────────────────────────────────────────────────────

describe('TrashView', () => {
  it('renders the Trash heading', async () => {
    render(<MemoryRouter><TrashView /></MemoryRouter>)
    await flushEffects()
    const heading = screen.getByText('Trash')
    expect(heading).toBeDefined()
    expect(heading.tagName).toBe('H1')
  })

  it('shows the 30-day retention notice', async () => {
    render(<MemoryRouter><TrashView /></MemoryRouter>)
    await flushEffects()
    expect(screen.getByText('Items are removed for good after 30 days')).toBeDefined()
  })

  it('shows empty state when trash is empty', async () => {
    render(<MemoryRouter><TrashView /></MemoryRouter>)
    await flushEffects()
    expect(screen.getByTestId('empty-state')).toBeDefined()
    expect(screen.getByText('Trash is empty')).toBeDefined()
  })

  it('does not show Empty Trash button when no items', async () => {
    render(<MemoryRouter><TrashView /></MemoryRouter>)
    await flushEffects()
    expect(screen.queryByText('Empty Trash')).toBeNull()
  })
})

// ── HelpView ──────────────────────────────────────────────────────────────────

describe('HelpView', () => {
  it('renders the Help Center heading', async () => {
    render(
      <MemoryRouter>
        <HelpView onStartTour={vi.fn()} onStartMiniTour={vi.fn()} />
      </MemoryRouter>,
    )
    await flushEffects()
    expect(screen.getByText('Help Center')).toBeDefined()
  })

  it('renders a search input', async () => {
    render(
      <MemoryRouter>
        <HelpView onStartTour={vi.fn()} onStartMiniTour={vi.fn()} />
      </MemoryRouter>,
    )
    await flushEffects()
    const searchInput = screen.getByPlaceholderText(/search/i)
    expect(searchInput).toBeDefined()
  })
})

// ── FocusModeView ────────────────────────────────────────────────────────────

describe('FocusModeView', () => {
  it('renders without crashing', async () => {
    const { container } = render(<MemoryRouter><FocusModeView onClose={vi.fn()} /></MemoryRouter>)
    await flushEffects()
    expect(container.innerHTML.length).toBeGreaterThan(0)
  })

  it('does not call onClose on initial render', async () => {
    const onClose = vi.fn()
    render(<MemoryRouter><FocusModeView onClose={onClose} /></MemoryRouter>)
    await flushEffects()
    expect(onClose).not.toHaveBeenCalled()
  })
})

// ── PasswordSetupView ─────────────────────────────────────────────────────────

describe('PasswordSetupView', () => {
  it('renders password and confirm password fields', async () => {
    render(<MemoryRouter><PasswordSetupView /></MemoryRouter>)
    await flushEffects()
    const passwordInputs = document.querySelectorAll('input[type="password"]')
    expect(passwordInputs.length).toBeGreaterThanOrEqual(2)
  })

  it('renders a submit/continue button', async () => {
    render(<MemoryRouter><PasswordSetupView /></MemoryRouter>)
    await flushEffects()
    const buttons = screen.getAllByRole('button')
    // At least one button should be the submit action
    expect(buttons.length).toBeGreaterThan(0)
  })

  it('renders the terms checkbox', async () => {
    render(<MemoryRouter><PasswordSetupView /></MemoryRouter>)
    await flushEffects()
    const checkbox = document.querySelector('input[type="checkbox"]')
    expect(checkbox).toBeTruthy()
  })
})

// ── ProfileView ──────────────────────────────────────────────────────────────

describe('ProfileView', () => {
  it('shows "Invalid profile link" when no rowId param', async () => {
    render(
      <MemoryRouter initialEntries={['/profile/']}>
        <Routes>
          <Route path="/profile/" element={<ProfileView />} />
        </Routes>
      </MemoryRouter>,
    )
    await flushEffects()
    expect(screen.getByText(/Invalid profile link/)).toBeDefined()
  })

  it('shows a not-found message when rowId does not match any row', async () => {
    render(
      <MemoryRouter initialEntries={['/profile/999']}>
        <Routes>
          <Route path="/profile/:rowId" element={<ProfileView />} />
        </Routes>
      </MemoryRouter>,
    )
    await flushEffects()
    expect(screen.getByText(/couldn't find this client/)).toBeDefined()
  })

  it('shows a way back when the client is not found', async () => {
    render(
      <MemoryRouter initialEntries={['/profile/999']}>
        <Routes>
          <Route path="/profile/:rowId" element={<ProfileView />} />
        </Routes>
      </MemoryRouter>,
    )
    await flushEffects()
    expect(screen.getByText('Back to the caseload')).toBeDefined()
  })
})
