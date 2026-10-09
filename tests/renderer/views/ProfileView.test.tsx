// @vitest-environment jsdom
/**
 * ProfileView smoke tests — error states, layout with mocked sub-components.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

// ── Global mocks ─────────────────────────────────────────────────────────────

const mockInvoke = vi.fn()
const mockOn = vi.fn().mockReturnValue(vi.fn())
Object.defineProperty(window, 'api', {
  value: { invoke: mockInvoke, on: mockOn, copyToClipboard: vi.fn() },
  writable: true,
})

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))

vi.mock('zustand/react/shallow', () => ({ useShallow: (fn: Function) => fn }))

vi.mock('lucide-react', async () => (await import('../lucideMock')).lucideMock)

vi.mock('../../../src/renderer/utils/safeInvoke', () => ({
  safeInvoke: vi.fn().mockResolvedValue({ ok: false, error: 'test-mock' }),
}))

vi.mock('../../../src/renderer/utils/rendererLogger', () => ({
  rlog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../../src/shared/constants', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('../../../src/shared/constants')),
  DEBOUNCE_SEARCH: 0, SPINNER_DELAY: 0, MS_PER_DAY: 86400000,
  DAYS_THIS_WEEK: 7, DAYS_THIS_MONTH: 30,
}))

// ── Store mocks ──────────────────────────────────────────────────────────────

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

vi.mock('../../../src/renderer/stores/profileStore', () => ({
  useProfileStore: (selector: Function) => selector({
    addRecentProfile: vi.fn(),
    recentProfiles: [],
  }),
}))

vi.mock('../../../src/renderer/stores/alertStore', () => ({
  useAlertStore: (selector: Function) => selector({
    rules: [], isLoaded: true, loadRules: vi.fn(),
  }),
}))

vi.mock('../../../src/renderer/stores/settingsStore', () => {
  const storeData = {
    theme: 'light', gridDensity: 'normal', reducedMotion: false,
  }
  return { useSettingsStore: (selector?: Function) => selector ? selector(storeData) : storeData }
})

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

// ── Mock child components ─────────────────────────────────────────────────────

vi.mock('../../../src/renderer/components/shared/CollapsibleSection', () => ({
  CollapsibleSection: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div data-testid={`section-${title}`}>{children}</div>
  ),
}))
vi.mock('../../../src/renderer/components/shared/Tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('../../../src/renderer/components/profile/ProfileHeader', () => ({
  ProfileHeader: () => <div data-testid="profile-header">Profile Header</div>,
}))
vi.mock('../../../src/renderer/components/profile/DeadlinePanel', () => ({
  DeadlinePanel: () => <div data-testid="deadline-panel">Deadline Panel</div>,
}))
vi.mock('../../../src/renderer/components/profile/CaseLog', () => ({
  CaseLog: () => <div data-testid="case-log">Case Log</div>,
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
vi.mock('../../../src/renderer/components/profile/ActivityTimeline', () => ({
  ActivityTimeline: () => <div data-testid="activity-timeline" />,
}))
vi.mock('../../../src/renderer/components/profile/Checklist', () => ({
  Checklist: () => null, TemplateManager: () => null,
}))
vi.mock('../../../src/renderer/components/profile/ScratchPad', () => ({
  ScratchPad: () => null,
}))
vi.mock('../../../src/renderer/components/profile/ProfilePrintLayout', () => ({
  ProfilePrintLayout: () => null,
}))
vi.mock('../../../src/renderer/hooks/useFocusTrap', () => ({
  useFocusTrap: () => ({ current: null }),
}))
vi.mock('../../../src/renderer/hooks/useCopyFeedback', () => ({
  useCopyFeedback: () => ({ copied: false, copyToClipboard: vi.fn() }),
}))

// ── Import (after mocks) ─────────────────────────────────────────────────────

import ProfileView from '../../../src/renderer/views/ProfileView'
import { setWords } from '../vocabFixture'

async function flushEffects() {
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => { setWords() })

describe('ProfileView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInvoke.mockResolvedValue({ ok: true, data: [] })
  })

  it('renders without crashing', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/profile/1']}>
        <Routes>
          <Route path="/profile/:rowId" element={<ProfileView />} />
        </Routes>
      </MemoryRouter>,
    )
    await flushEffects()
    expect(container.innerHTML.length).toBeGreaterThan(0)
  })

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

  it('shows "Client not found" when rowId does not match any row', async () => {
    render(
      <MemoryRouter initialEntries={['/profile/999']}>
        <Routes>
          <Route path="/profile/:rowId" element={<ProfileView />} />
        </Routes>
      </MemoryRouter>,
    )
    await flushEffects()
    expect(screen.getByText(/Client not found/)).toBeDefined()
  })

  it('shows "Return to grid" link when client not found', async () => {
    render(
      <MemoryRouter initialEntries={['/profile/999']}>
        <Routes>
          <Route path="/profile/:rowId" element={<ProfileView />} />
        </Routes>
      </MemoryRouter>,
    )
    await flushEffects()
    expect(screen.getByText('Return to grid')).toBeDefined()
  })
})
