// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'

// Mock window.api
Object.defineProperty(window, 'api', {
  value: {
    invoke: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    copyToClipboard: vi.fn().mockResolvedValue(undefined),
  },
  writable: true,
})

// Mock contactsStore
const mockDeleteProvider = vi.fn().mockResolvedValue(undefined)
const mockToggleStar = vi.fn().mockResolvedValue(undefined)
const mockMarkAvailabilityChecked = vi.fn().mockResolvedValue(undefined)
const mockAddTag = vi.fn().mockResolvedValue(undefined)
const mockRemoveTag = vi.fn().mockResolvedValue(undefined)
const mockLoadInteractions = vi.fn()
const mockLoadClientLinks = vi.fn()

vi.mock('../../../../src/renderer/stores/contactsStore', () => ({
  useContactsStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      deleteProvider: mockDeleteProvider,
      toggleStar: mockToggleStar,
      markAvailabilityChecked: mockMarkAvailabilityChecked,
      addTag: mockAddTag,
      removeTag: mockRemoveTag,
      loadInteractions: mockLoadInteractions,
      loadClientLinks: mockLoadClientLinks,
      interactions: [],
      clientLinks: [],
    }),
}))

// Mock useCopyFeedback
vi.mock('../../../../src/renderer/hooks/useCopyFeedback', () => ({
  useCopyFeedback: () => ({
    copied: false,
    copyToClipboard: vi.fn(),
  }),
}))

// Mock child components to isolate ContactDetail tests
vi.mock('../../../../src/renderer/components/contacts/ContactInteractionLog', () => ({
  ContactInteractionLog: () => <div data-testid="interaction-log">InteractionLog</div>,
}))
vi.mock('../../../../src/renderer/components/contacts/ContactLinkedClients', () => ({
  ContactLinkedClients: () => <div data-testid="linked-clients">LinkedClients</div>,
}))

import { ContactDetail } from '../../../../src/renderer/components/contacts/ContactDetail'
import type { Provider } from '../../../../src/shared/types'
import { setWords } from '../../vocabFixture'

function makeProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 1,
    category_id: 1,
    name: 'Dr. Jane Smith',
    org_name: 'City Health Clinic',
    title: 'Primary Care Physician',
    phone_main: '555-123-4567',
    phone_direct: null,
    phone_fax: null,
    phone_cell: null,
    phone_after_hours: null,
    email: 'jane@clinic.org',
    website: 'https://clinic.org',
    address: '123 Main St',
    hours: 'Mon-Fri 9-5',
    languages: 'English, Spanish',
    availability_status: 'accepting',
    availability_notes: null,
    availability_checked_at: '2026-03-01T00:00:00Z',
    referral_process: 'Call the front desk',
    notes: 'Great provider',
    is_starred: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    category_name: 'Medical',
    category_color: '#22c55e',
    last_interaction_at: null,
    tags: [],
    ...overrides,
  }
}

beforeEach(() => { setWords() })

describe('ContactDetail', () => {
  const defaultProps = {
    onEdit: vi.fn(),
    onDeleted: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders provider name and organization', () => {
    const provider = makeProvider()
    render(<ContactDetail provider={provider} {...defaultProps} />)
    expect(screen.getByText('Dr. Jane Smith')).toBeTruthy()
    expect(screen.getByText('City Health Clinic')).toBeTruthy()
  })

  it('renders provider title', () => {
    const provider = makeProvider()
    render(<ContactDetail provider={provider} {...defaultProps} />)
    expect(screen.getByText('Primary Care Physician')).toBeTruthy()
  })

  it('shows availability badge', () => {
    const provider = makeProvider({ availability_status: 'accepting' })
    render(<ContactDetail provider={provider} {...defaultProps} />)
    expect(screen.getByText('Accepting')).toBeTruthy()
  })

  it('shows contact info (phone, email, website) on info tab', () => {
    const provider = makeProvider()
    render(<ContactDetail provider={provider} {...defaultProps} />)
    expect(screen.getByText('555-123-4567')).toBeTruthy()
    expect(screen.getByText('jane@clinic.org')).toBeTruthy()
    expect(screen.getByText('https://clinic.org')).toBeTruthy()
  })

  it('shows category badge', () => {
    const provider = makeProvider({ category_name: 'Medical' })
    render(<ContactDetail provider={provider} {...defaultProps} />)
    expect(screen.getByText('Medical')).toBeTruthy()
  })

  it('has three tabs: Info, Log, Clients', () => {
    const provider = makeProvider()
    render(<ContactDetail provider={provider} {...defaultProps} />)
    expect(screen.getByRole('tab', { name: /Info/ })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /Log/ })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /Clients/ })).toBeTruthy()
  })

  it('switches to Log tab and shows interaction log', () => {
    const provider = makeProvider()
    render(<ContactDetail provider={provider} {...defaultProps} />)
    fireEvent.click(screen.getByRole('tab', { name: /Log/ }))
    expect(screen.getByTestId('interaction-log')).toBeTruthy()
  })

  it('switches to Clients tab and shows linked clients', () => {
    const provider = makeProvider()
    render(<ContactDetail provider={provider} {...defaultProps} />)
    fireEvent.click(screen.getByRole('tab', { name: /Clients/ }))
    expect(screen.getByTestId('linked-clients')).toBeTruthy()
  })

  it('calls onEdit when Edit button is clicked', () => {
    const provider = makeProvider()
    render(<ContactDetail provider={provider} {...defaultProps} />)
    fireEvent.click(screen.getByLabelText('Edit provider'))
    expect(defaultProps.onEdit).toHaveBeenCalledOnce()
  })

  it('shows delete confirmation when Delete button clicked', () => {
    const provider = makeProvider()
    render(<ContactDetail provider={provider} {...defaultProps} />)
    fireEvent.click(screen.getByLabelText('Delete provider'))
    // Contacts don't go to the Trash, so the dialog says so and the button names the action (AUDIT-060)
    expect(screen.getByText(/This deletes the provider for good/)).toBeTruthy()
    expect(screen.getByText(/doesn't go to the Trash/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Delete provider forever' })).toBeTruthy()
  })

  it('shows referral process when present', () => {
    const provider = makeProvider({ referral_process: 'Call the front desk' })
    render(<ContactDetail provider={provider} {...defaultProps} />)
    expect(screen.getByText('Call the front desk')).toBeTruthy()
    expect(screen.getByText('Referral Process')).toBeTruthy()
  })

  it('shows languages when present', () => {
    const provider = makeProvider({ languages: 'English, Spanish' })
    render(<ContactDetail provider={provider} {...defaultProps} />)
    expect(screen.getByText('English')).toBeTruthy()
    expect(screen.getByText('Spanish')).toBeTruthy()
  })
})
