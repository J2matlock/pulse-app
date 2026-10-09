// @vitest-environment jsdom
/**
 * ContactsView data smoke tests — renders with 5 providers across 2 categories.
 * Verifies provider list, category display, header count, detail panel.
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

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts: { count: number }) => ({
    getTotalSize: () => opts.count * 48,
    getVirtualItems: () =>
      Array.from({ length: opts.count }, (_, i) => ({
        index: i, start: i * 48, size: 48, key: i,
      })),
    measureElement: () => {},
  }),
}))

// ── Sample data: 5 providers, 2 categories ──────────────────────────────────

const sampleProviders = [
  {
    id: 1, name: 'Dr. Sarah Chen', organization: 'City Hospital', title: 'Psychiatrist',
    phone_main: '555-0101', phone_direct: '555-0102', email: 'sarah@city.med', website: 'https://city.med',
    address: '123 Main St, Springfield', hours: 'M-F 9-5', languages: 'English, Mandarin',
    referral_process: 'Call intake line', availability_status: 'accepting',
    availability_updated_at: '2026-03-01', category_id: 1, is_starred: 0,
    notes: 'Excellent rapport with clients', created_at: '2026-01-15', updated_at: '2026-03-01',
  },
  {
    id: 2, name: 'Housing First Program', organization: 'Community Services', title: 'Case Manager',
    phone_main: '555-0201', phone_direct: '', email: 'housing@cs.org', website: '',
    address: '456 Oak Ave', hours: 'M-F 8-4', languages: 'English, Spanish',
    referral_process: 'Online form at cs.org/referral', availability_status: 'waitlist',
    availability_updated_at: '2026-02-15', category_id: 2, is_starred: 1,
    notes: 'Average wait 2-3 weeks', created_at: '2026-01-10', updated_at: '2026-02-15',
  },
  {
    id: 3, name: 'Dr. James Rivera', organization: 'Wellness Clinic', title: 'Primary Care',
    phone_main: '555-0301', phone_direct: '', email: 'jrivera@wellness.com', website: '',
    address: '789 Elm St', hours: 'M-W-F 10-6', languages: 'English, Spanish',
    referral_process: 'Direct referral', availability_status: 'accepting',
    availability_updated_at: '2026-03-05', category_id: 1, is_starred: 0,
    notes: '', created_at: '2026-02-01', updated_at: '2026-03-05',
  },
  {
    id: 4, name: 'Safe Haven Shelter', organization: 'Safe Haven Inc', title: 'Intake Coordinator',
    phone_main: '555-0401', phone_direct: '555-0402', email: 'intake@safehaven.org', website: 'https://safehaven.org',
    address: '321 Birch Blvd', hours: '24/7', languages: 'English',
    referral_process: 'Walk-in or call', availability_status: 'limited',
    availability_updated_at: '2026-03-08', category_id: 2, is_starred: 1,
    notes: 'Women and children only', created_at: '2026-01-20', updated_at: '2026-03-08',
  },
  {
    id: 5, name: 'Mental Health Helpline', organization: 'County Health Dept', title: 'Crisis Counselor',
    phone_main: '555-0500', phone_direct: '', email: 'crisis@county.gov', website: '',
    address: '100 Government Dr', hours: '24/7', languages: 'English, Spanish, Vietnamese',
    referral_process: 'Call directly', availability_status: 'accepting',
    availability_updated_at: '2026-03-09', category_id: 1, is_starred: 0,
    notes: '', created_at: '2026-02-10', updated_at: '2026-03-09',
  },
]

const sampleCategories = [
  { id: 1, name: 'Medical', color: '#3b82f6' },
  { id: 2, name: 'Housing & Shelter', color: '#22c55e' },
]

const mockSelectProvider = vi.fn()
const mockSetViewMode = vi.fn()

let contactsOverride: Record<string, unknown> = {}

function getContactsData() {
  return {
    providers: sampleProviders, initialLoadDone: true,
    selectedProviderId: null, selectedProvider: null,
    viewMode: 'list' as const, setViewMode: mockSetViewMode,
    loadProviders: vi.fn(), loadCategories: vi.fn(),
    selectProvider: mockSelectProvider, toggleStar: vi.fn(),
    filterParams: { search: '', categoryId: null, availability: null, availabilityStatus: null, starred: false },
    categories: sampleCategories, customFields: [],
    ...contactsOverride,
  }
}

vi.mock('../../../src/renderer/stores/contactsStore', () => {
  const store = (sel: Function) => sel(getContactsData())
  store.getState = () => getContactsData()
  store.subscribe = vi.fn().mockReturnValue(vi.fn())
  return { useContactsStore: store }
})

// ── Mock sub-components ──────────────────────────────────────────────────────

vi.mock('../../../src/renderer/components/shared/EmptyState', () => ({
  EmptyState: ({ title }: { title: string }) => <div data-testid="empty-state"><span>{title}</span></div>,
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
  ContactRow: ({ provider, onClick }: { provider: { name: string; organization: string }; onClick: () => void }) => (
    <div data-testid="contact-row" onClick={onClick}>
      <span data-testid="provider-name">{provider.name}</span>
      <span data-testid="provider-org">{provider.organization}</span>
    </div>
  ),
}))
vi.mock('../../../src/renderer/components/contacts/ContactFilterBar', () => ({
  ContactFilterBar: ({ viewMode }: { viewMode: string }) => (
    <div data-testid="contact-filter-bar"><span data-testid="current-view">{viewMode}</span></div>
  ),
}))
vi.mock('../../../src/renderer/components/contacts/ContactDetail', () => ({
  ContactDetail: ({ provider }: { provider: { name: string; organization: string } }) => (
    <div data-testid="contact-detail">
      <span>{provider.name}</span>
      <span>{provider.organization}</span>
    </div>
  ),
}))
vi.mock('../../../src/renderer/components/contacts/ContactImportExport', () => ({
  ContactImportExport: () => null,
}))

// ── Import (after mocks) ─────────────────────────────────────────────────────

import ContactsView from '../../../src/renderer/views/ContactsView'
import { setWords } from '../vocabFixture'

async function flushEffects() {
  await act(async () => { await new Promise(r => setTimeout(r, 10)) })
}

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => { setWords() })

describe('ContactsView — data smoke tests (5 providers, 2 categories)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    contactsOverride = {}
    mockInvoke.mockResolvedValue({ ok: true, data: [] })
  })

  it('renders Provider Directory heading', async () => {
    render(<MemoryRouter><ContactsView /></MemoryRouter>)
    await flushEffects()
    expect(screen.getByRole('heading', { name: 'Provider directory' })).toBeDefined()
  })

  it('shows correct provider count (5 providers)', async () => {
    render(<MemoryRouter><ContactsView /></MemoryRouter>)
    await flushEffects()
    expect(screen.getByText('5 providers')).toBeDefined()
  })

  it('renders all 5 provider rows', async () => {
    render(<MemoryRouter><ContactsView /></MemoryRouter>)
    await flushEffects()
    const rows = screen.getAllByTestId('contact-row')
    expect(rows.length).toBe(5)
  })

  it('provider rows contain expected names', async () => {
    render(<MemoryRouter><ContactsView /></MemoryRouter>)
    await flushEffects()
    const names = screen.getAllByTestId('provider-name').map(el => el.textContent)
    expect(names).toContain('Dr. Sarah Chen')
    expect(names).toContain('Housing First Program')
    expect(names).toContain('Safe Haven Shelter')
    expect(names).toContain('Mental Health Helpline')
  })

  it('clicking a provider calls selectProvider with correct id', async () => {
    render(<MemoryRouter><ContactsView /></MemoryRouter>)
    await flushEffects()
    const rows = screen.getAllByTestId('contact-row')
    fireEvent.click(rows[2]!)
    expect(mockSelectProvider).toHaveBeenCalledWith(3) // Dr. James Rivera
  })

  it('shows detail panel when a provider is selected', async () => {
    contactsOverride = { selectedProviderId: 1, selectedProvider: sampleProviders[0] }
    render(<MemoryRouter><ContactsView /></MemoryRouter>)
    await flushEffects()
    const detail = screen.getByTestId('contact-detail')
    expect(detail.textContent).toContain('Dr. Sarah Chen')
    expect(detail.textContent).toContain('City Hospital')
  })

  it('shows "Select a provider" when none selected', async () => {
    render(<MemoryRouter><ContactsView /></MemoryRouter>)
    await flushEffects()
    expect(screen.getByText('Select a provider to view details')).toBeDefined()
  })

  it('renders Add Provider button', async () => {
    render(<MemoryRouter><ContactsView /></MemoryRouter>)
    await flushEffects()
    expect(screen.getByText('Add Provider')).toBeDefined()
  })
})
