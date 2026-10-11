// @vitest-environment jsdom
/**
 * ProfileView data smoke tests — renders with 1 client row, verifies
 * profile header, case log, deadline panel, and other sections appear.
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

// ── Sample client data ──────────────────────────────────────────────────────

const clientRow = {
  row_id: 42, position: 0, is_active: 1 as const, is_starred: 1 as 0 | 1,
  acuity_level_id: null, display_name: 'Maria Santos',
  deleted_at: null, created_at: '2025-06-15', updated_at: '2026-03-08',
  col_1: 'Maria Santos', col_2: '2026-03-20', col_3: '85', col_4: '1', col_5: 'Open',
}

const sampleColumns = [
  { id: 1, grid_id: 1, name: 'Client Name', column_type: 'text', width: 200, position: 0, is_visible: 1, is_required: 1, is_identifier: 1, is_name_column: 1, config: '{}', created_at: '', updated_at: '' },
  { id: 2, grid_id: 1, name: 'Next Review', column_type: 'date', width: 150, position: 1, is_visible: 1, is_required: 0, is_identifier: 0, is_name_column: 0, config: '{"alert_rule_id":1}', created_at: '', updated_at: '' },
  { id: 3, grid_id: 1, name: 'Score', column_type: 'number', width: 120, position: 2, is_visible: 1, is_required: 0, is_identifier: 0, is_name_column: 0, config: '{}', created_at: '', updated_at: '' },
  { id: 4, grid_id: 1, name: 'Active', column_type: 'checkbox', width: 100, position: 3, is_visible: 1, is_required: 0, is_identifier: 0, is_name_column: 0, config: '{}', created_at: '', updated_at: '' },
  { id: 5, grid_id: 1, name: 'Status', column_type: 'dropdown', width: 130, position: 4, is_visible: 1, is_required: 0, is_identifier: 0, is_name_column: 0, config: '{"options":["Open","Closed","Pending"]}', created_at: '', updated_at: '' },
]

// ── Store mocks ──────────────────────────────────────────────────────────────

vi.mock('../../../src/renderer/stores/gridStore', () => ({
  useGridStore: (sel: Function) => sel({
    grids: [{ id: 1, name: 'Main Caseload', is_active: 1, position: 0, created_at: '', updated_at: '' }],
    rows: [clientRow],
    columns: sampleColumns,
    activeGridId: 1, isLoading: false,
    loadGridList: vi.fn(), loadGrid: vi.fn(),
    searchQuery: '', setSearchQuery: vi.fn(),
    sortConfig: [], showArchived: false,
    acuityLevels: [], acuityEnabled: false,
    hiddenColumns: [], sortedRowIds: [42],
    updateRow: vi.fn(), updateCell: vi.fn(),
  }),
}))

vi.mock('../../../src/renderer/stores/profileStore', () => ({
  useProfileStore: (sel: Function) => sel({
    addRecentProfile: vi.fn(),
    recentProfiles: [{ rowId: 42, name: 'Maria Santos', gridId: 1, timestamp: Date.now() }],
  }),
}))

vi.mock('../../../src/renderer/stores/alertStore', () => ({
  useAlertStore: (sel: Function) => sel({
    rules: [{ id: 1, name: 'Default', interval_days: 1, thresholds: [{ daysBefore: 7, bgClass: 'alert-red', label: 'Urgent' }] }],
    isLoaded: true, loadRules: vi.fn(),
  }),
}))

vi.mock('../../../src/renderer/stores/settingsStore', () => {
  const d = { theme: 'light', gridDensity: 'normal', reducedMotion: false }
  return { useSettingsStore: (sel?: Function) => sel ? sel(d) : d }
})

vi.mock('../../../src/renderer/stores/undoStore', () => {
  const d = { undoStack: [], redoStack: [], undo: vi.fn(), redo: vi.fn(), canUndo: false, canRedo: false, pushWithToast: vi.fn() }
  const store = (sel: Function) => sel(d)
  store.getState = () => d; store.subscribe = vi.fn().mockReturnValue(vi.fn())
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
  ProfileHeader: ({ clientName }: { clientName?: string }) => (
    <div data-testid="profile-header">{clientName ?? 'Unknown'}</div>
  ),
}))
vi.mock('../../../src/renderer/components/profile/DeadlinePanel', () => ({
  DeadlinePanel: () => <div data-testid="deadline-panel">Deadlines</div>,
}))
vi.mock('../../../src/renderer/components/profile/CaseLog', () => ({
  // The record page puts deadlines and details between the note box and past notes
  CaseLog: ({ rowId, between }: { rowId?: number; between?: React.ReactNode }) => (
    <><div data-testid="case-log" data-row-id={rowId}>Case Log</div>{between}</>
  ),
}))
vi.mock('../../../src/renderer/components/profile/GridDataSummary', () => ({
  GridDataSummary: () => <div data-testid="grid-data-summary">Grid Data</div>,
}))
vi.mock('../../../src/renderer/components/profile/RelatedDocuments', () => ({
  RelatedDocuments: () => <div data-testid="related-documents">Documents</div>,
}))
vi.mock('../../../src/renderer/components/profile/LinkedProviders', () => ({
  LinkedProviders: () => <div data-testid="linked-providers">Providers</div>,
}))
vi.mock('../../../src/renderer/components/profile/Checklist', () => ({
  Checklist: () => <div data-testid="checklist">Checklist</div>,
  TemplateManager: () => null,
}))
vi.mock('../../../src/renderer/components/profile/ScratchPad', () => ({
  ScratchPad: () => <div data-testid="scratch-pad">Notes</div>,
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
import { setWords, setFeatures, EXISTING_FEATURES } from '../vocabFixture'

async function flushEffects() {
  await act(async () => { await new Promise(r => setTimeout(r, 10)) })
}

function renderProfile(rowId: number = 42) {
  return render(
    <MemoryRouter initialEntries={[`/profile/${rowId}`]}>
      <Routes>
        <Route path="/profile/:rowId" element={<ProfileView />} />
      </Routes>
    </MemoryRouter>,
  )
}

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => { setWords() })

describe('ProfileView — data smoke tests (1 client)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInvoke.mockResolvedValue({ ok: true, data: [] })
  })

  it('renders profile header with client name', async () => {
    renderProfile()
    await flushEffects()
    const header = screen.getByTestId('profile-header')
    expect(header).toBeDefined()
  })

  it('renders deadline panel section', async () => {
    renderProfile()
    await flushEffects()
    expect(screen.getByTestId('deadline-panel')).toBeDefined()
  })

  it('renders case log section', async () => {
    renderProfile()
    await flushEffects()
    expect(screen.getByTestId('case-log')).toBeDefined()
  })

  it('renders grid data summary section', async () => {
    renderProfile()
    await flushEffects()
    expect(screen.getByTestId('grid-data-summary')).toBeDefined()
  })

  it('renders linked providers section', async () => {
    renderProfile()
    await flushEffects()
    expect(screen.getByTestId('linked-providers')).toBeDefined()
  })

  it('hides linked contacts while the contacts directory is switched off', async () => {
    setFeatures({ ...EXISTING_FEATURES, contactsDirectory: false })
    renderProfile()
    await flushEffects()
    expect(screen.queryByTestId('linked-providers')).toBeNull()
  })

  it('shows a not-found message for a non-existent row', async () => {
    renderProfile(999)
    await flushEffects()
    expect(screen.getByText(/couldn't find this client/)).toBeDefined()
  })

  it('shows a way back for missing client', async () => {
    renderProfile(999)
    await flushEffects()
    expect(screen.getByText('Back to the caseload')).toBeDefined()
  })
})
