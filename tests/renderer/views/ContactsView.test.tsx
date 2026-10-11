// @vitest-environment jsdom
/**
 * ContactsView interaction tests — two-panel layout, provider selection, search,
 * add provider, category filter, view toggle.
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

vi.mock('../../../src/renderer/utils/domHelpers', () => ({
  isEditableElement: () => false,
}))

// Mock @tanstack/react-virtual so all items render in JSDOM (no real element dimensions)
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts: { count: number }) => ({
    getTotalSize: () => opts.count * 48,
    getVirtualItems: () =>
      Array.from({ length: opts.count }, (_, i) => ({
        index: i,
        start: i * 48,
        size: 48,
        key: i,
      })),
    measureElement: () => {},
  }),
}))

// ── Contacts store mock with sample data ─────────────────────────────────────

const sampleProviders = [
  {
    id: 1, name: 'Dr. Sarah Chen', organization: 'City Hospital', title: 'Psychiatrist',
    phone_main: '555-0101', phone_direct: '', email: 'sarah@city.med', website: '',
    address: '123 Main St', hours: 'M-F 9-5', languages: 'English, Mandarin',
    referral_process: 'Call intake', availability_status: 'accepting',
    availability_updated_at: '2026-03-01', category_id: 1, is_starred: 0,
    notes: '', created_at: '2026-02-01', updated_at: '2026-03-01',
  },
  {
    id: 2, name: 'Housing First Program', organization: 'Community Services', title: 'Case Manager',
    phone_main: '555-0202', phone_direct: '', email: 'housing@cs.org', website: '',
    address: '456 Oak Ave', hours: 'M-F 8-4', languages: 'English, Spanish',
    referral_process: 'Online form', availability_status: 'waitlist',
    availability_updated_at: '2026-02-15', category_id: 3, is_starred: 1,
    notes: '', created_at: '2026-01-15', updated_at: '2026-02-15',
  },
  {
    id: 3, name: 'Legal Aid Society', organization: 'Legal Aid', title: 'Attorney',
    phone_main: '555-0303', phone_direct: '', email: 'intake@legal.org', website: '',
    address: '789 Elm St', hours: 'M-Th 10-4', languages: 'English',
    referral_process: 'Walk-in', availability_status: 'accepting',
    availability_updated_at: '2026-03-05', category_id: 5, is_starred: 0,
    notes: '', created_at: '2026-02-10', updated_at: '2026-03-05',
  },
]

const mockLoadProviders = vi.fn()
const mockLoadCategories = vi.fn()
const mockSelectProvider = vi.fn()
const mockSetViewMode = vi.fn()
const mockToggleStar = vi.fn()

let contactsStoreOverride: Record<string, unknown> = {}

function getContactsStoreData() {
  return {
    providers: sampleProviders,
    initialLoadDone: true,
    selectedProviderId: null,
    selectedProvider: null,
    viewMode: 'list' as const,
    setViewMode: mockSetViewMode,
    loadProviders: mockLoadProviders,
    loadCategories: mockLoadCategories,
    selectProvider: mockSelectProvider,
    toggleStar: mockToggleStar,
    filterParams: { search: '', categoryId: null, availability: null, availabilityStatus: null, starred: false },
    categories: [
      { id: 1, name: 'Medical', color: '#3b82f6' },
      { id: 3, name: 'Housing & Shelter', color: '#22c55e' },
      { id: 5, name: 'Legal Services', color: '#a855f7' },
    ],
    customFields: [],
    ...contactsStoreOverride,
  }
}

vi.mock('../../../src/renderer/stores/contactsStore', () => {
  const store = (selector: Function) => selector(getContactsStoreData())
  store.getState = () => getContactsStoreData()
  store.subscribe = vi.fn().mockReturnValue(vi.fn())
  return { useContactsStore: store }
})

// ── Mock sub-components ──────────────────────────────────────────────────────

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
vi.mock('../../../src/renderer/components/contacts/CategoryManager', () => ({
  CategoryManager: () => <div data-testid="category-manager" />,
}))
vi.mock('../../../src/renderer/components/contacts/ContactForm', () => ({
  ContactForm: () => <div data-testid="contact-form">Contact Form</div>,
}))
vi.mock('../../../src/renderer/components/contacts/ContactCard', () => ({
  ContactCard: ({ provider, onClick }: { provider: { name: string }; onClick: () => void }) => (
    <div data-testid="contact-card" onClick={onClick}>{provider.name}</div>
  ),
}))
vi.mock('../../../src/renderer/components/contacts/ContactRow', () => ({
  ContactRow: ({ provider, onClick }: { provider: { name: string }; onClick: () => void }) => (
    <div data-testid="contact-row" onClick={onClick}>{provider.name}</div>
  ),
}))
vi.mock('../../../src/renderer/components/contacts/ContactFilterBar', () => ({
  ContactFilterBar: ({ viewMode, onViewModeChange }: { viewMode: string; onViewModeChange: (mode: string) => void }) => (
    <div data-testid="contact-filter-bar">
      <button data-testid="toggle-card" onClick={() => onViewModeChange('cards')}>Cards</button>
      <button data-testid="toggle-list" onClick={() => onViewModeChange('list')}>List</button>
      <span data-testid="current-view">{viewMode}</span>
    </div>
  ),
}))
vi.mock('../../../src/renderer/components/contacts/ContactDetail', () => ({
  ContactDetail: ({ provider }: { provider: { name: string } }) => (
    <div data-testid="contact-detail">{provider.name}</div>
  ),
}))
vi.mock('../../../src/renderer/components/contacts/ContactImportExport', () => ({
  ContactImportExport: () => null,
}))

// ── Import view ─────────────────────────────────────────────────────────────

import ContactsView from '../../../src/renderer/views/ContactsView'
import { setWords } from '../vocabFixture'

async function flushEffects() {
  await act(async () => { await new Promise(r => setTimeout(r, 10)) })
}

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => { setWords() })

describe('ContactsView — interactions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    contactsStoreOverride = {}
    mockInvoke.mockResolvedValue({ ok: true, data: [] })
  })

  it('renders two-panel layout with header and provider list', async () => {
    render(<MemoryRouter><ContactsView /></MemoryRouter>)
    await flushEffects()

    expect(screen.getByRole('heading', { name: 'Provider directory' })).toBeDefined()
    expect(screen.getByText('3 providers')).toBeDefined()
    expect(screen.getByText('Select a provider to view details')).toBeDefined()
  })

  it('uses generic words in a new workspace', async () => {
    setWords({})
    render(<MemoryRouter><ContactsView /></MemoryRouter>)
    await flushEffects()
    expect(screen.getByRole('heading', { name: 'Contact directory' })).toBeDefined()
    expect(screen.getByText('3 contacts')).toBeDefined()
  })

  it('renders provider rows in list view mode', async () => {
    render(<MemoryRouter><ContactsView /></MemoryRouter>)
    await flushEffects()

    const rows = screen.getAllByTestId('contact-row')
    expect(rows.length).toBe(3)
    expect(rows[0].textContent).toContain('Dr. Sarah Chen')
    expect(rows[1].textContent).toContain('Housing First Program')
    expect(rows[2].textContent).toContain('Legal Aid Society')
  })

  it('calls selectProvider when a provider row is clicked', async () => {
    render(<MemoryRouter><ContactsView /></MemoryRouter>)
    await flushEffects()

    const rows = screen.getAllByTestId('contact-row')
    fireEvent.click(rows[0])
    expect(mockSelectProvider).toHaveBeenCalledWith(1)
  })

  it('shows detail panel when a provider is selected', async () => {
    contactsStoreOverride = {
      selectedProviderId: 1,
      selectedProvider: sampleProviders[0],
    }
    render(<MemoryRouter><ContactsView /></MemoryRouter>)
    await flushEffects()

    expect(screen.getByTestId('contact-detail')).toBeDefined()
    expect(screen.getByTestId('contact-detail').textContent).toContain('Dr. Sarah Chen')
  })

  it('opens form when Add Provider button is clicked', async () => {
    render(<MemoryRouter><ContactsView /></MemoryRouter>)
    await flushEffects()

    fireEvent.click(screen.getByText('Add Provider'))

    expect(mockSelectProvider).toHaveBeenCalledWith(null)
    expect(screen.getByTestId('contact-form')).toBeDefined()
  })

  it('calls setViewMode via filter bar toggle', async () => {
    render(<MemoryRouter><ContactsView /></MemoryRouter>)
    await flushEffects()

    fireEvent.click(screen.getByTestId('toggle-card'))
    expect(mockSetViewMode).toHaveBeenCalledWith('cards')
  })

  it('shows empty state when no providers exist', async () => {
    contactsStoreOverride = { providers: [] }
    render(<MemoryRouter><ContactsView /></MemoryRouter>)
    await flushEffects()

    expect(screen.getByTestId('empty-state')).toBeDefined()
    expect(screen.getByText('No providers yet')).toBeDefined()
    // Nothing to pick, so no second empty panel beside it (polish V1)
    expect(screen.queryByText(/to view details/)).toBeNull()
  })

  it('shows provider count as singular when one provider', async () => {
    contactsStoreOverride = { providers: [sampleProviders[0]] }
    render(<MemoryRouter><ContactsView /></MemoryRouter>)
    await flushEffects()

    expect(screen.getByText('1 provider')).toBeDefined()
  })
})
