// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, fireEvent, act } from '@testing-library/react'
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
import { renderSettled } from '../../renderSettled'

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

  it('renders provider name and organization', async () => {
    const provider = makeProvider()
    await renderSettled(<ContactDetail provider={provider} {...defaultProps} />)
    expect(screen.getByText('Dr. Jane Smith')).toBeTruthy()
    expect(screen.getByText('City Health Clinic')).toBeTruthy()
  })

  it('renders provider title', async () => {
    const provider = makeProvider()
    await renderSettled(<ContactDetail provider={provider} {...defaultProps} />)
    expect(screen.getByText('Primary Care Physician')).toBeTruthy()
  })

  it('shows availability badge', async () => {
    const provider = makeProvider({ availability_status: 'accepting' })
    await renderSettled(<ContactDetail provider={provider} {...defaultProps} />)
    // In the header and in the Info tab's Availability block
    expect(screen.getAllByText('Accepting').length).toBe(2)
  })

  it('shows contact info (phone, email, website) on info tab', async () => {
    const provider = makeProvider()
    await renderSettled(<ContactDetail provider={provider} {...defaultProps} />)
    expect(screen.getByText('555-123-4567')).toBeTruthy()
    expect(screen.getByText('jane@clinic.org')).toBeTruthy()
    expect(screen.getByText('https://clinic.org')).toBeTruthy()
  })

  it('shows category badge', async () => {
    const provider = makeProvider({ category_name: 'Medical' })
    await renderSettled(<ContactDetail provider={provider} {...defaultProps} />)
    expect(screen.getByText('Medical')).toBeTruthy()
  })

  it('has three tabs: Info, Log, Clients', async () => {
    const provider = makeProvider()
    await renderSettled(<ContactDetail provider={provider} {...defaultProps} />)
    expect(screen.getByRole('tab', { name: /Info/ })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /History/ })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /Clients/ })).toBeTruthy()
  })

  it('switches to Log tab and shows interaction log', async () => {
    const provider = makeProvider()
    await renderSettled(<ContactDetail provider={provider} {...defaultProps} />)
    fireEvent.click(screen.getByRole('tab', { name: /History/ }))
    expect(screen.getByTestId('interaction-log')).toBeTruthy()
  })

  it('switches to Clients tab and shows linked clients', async () => {
    const provider = makeProvider()
    await renderSettled(<ContactDetail provider={provider} {...defaultProps} />)
    fireEvent.click(screen.getByRole('tab', { name: /Clients/ }))
    expect(screen.getByTestId('linked-clients')).toBeTruthy()
  })

  it('calls onEdit when Edit button is clicked', async () => {
    const provider = makeProvider()
    await renderSettled(<ContactDetail provider={provider} {...defaultProps} />)
    fireEvent.click(screen.getByLabelText('Edit provider'))
    expect(defaultProps.onEdit).toHaveBeenCalledOnce()
  })

  it('Delete acts at once, no dialog; the Undo toast is the way back (Q4, E-14)', async () => {
    const provider = makeProvider()
    await renderSettled(<ContactDetail provider={provider} {...defaultProps} />)
    await act(async () => { fireEvent.click(screen.getByLabelText('Delete provider')) })
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mockDeleteProvider).toHaveBeenCalledWith(provider.id)
    expect(defaultProps.onDeleted).toHaveBeenCalled()
  })

  // E-24: Edit and Delete are words; star, PDF and vCard sit under More
  it('shows Edit and Delete as text, and the other actions under More', async () => {
    await renderSettled(<ContactDetail provider={makeProvider()} {...defaultProps} />)
    expect(screen.getByLabelText('Edit provider').textContent).toContain('Edit')
    expect(screen.getByLabelText('Delete provider').textContent).toContain('Delete')
    expect(screen.queryByLabelText('Export PDF')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    const items = screen.getAllByRole('menuitem').map(i => i.textContent)
    expect(items).toEqual(['Star this provider', 'Save as PDF…', 'Export vCard…'])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Star this provider' }))
    expect(mockToggleStar).toHaveBeenCalledWith(1)
  })

  // E-22, E-23: no bare "Unknown" pill; the Availability block says what "I checked today" confirms
  it('hides an unknown availability pill and explains it in an Availability block', async () => {
    await renderSettled(<ContactDetail provider={makeProvider({ availability_status: 'unknown', availability_checked_at: null })} {...defaultProps} />)
    expect(screen.queryByText('Unknown')).toBeNull()
    const block = screen.getByRole('group', { name: 'Availability' })
    expect(block.textContent).toContain('Not checked')
    expect(block.textContent).toContain('last checked never')
    fireEvent.click(screen.getByRole('button', { name: 'I checked today' }))
    expect(mockMarkAvailabilityChecked).toHaveBeenCalledWith(1)
    fireEvent.click(screen.getByRole('button', { name: 'Change status…' }))
    expect(defaultProps.onEdit).toHaveBeenCalled()
  })

  it('shows referral process when present', async () => {
    const provider = makeProvider({ referral_process: 'Call the front desk' })
    await renderSettled(<ContactDetail provider={provider} {...defaultProps} />)
    expect(screen.getByText('Call the front desk')).toBeTruthy()
    expect(screen.getByText('Referral process')).toBeTruthy()
  })

  it('shows languages when present', async () => {
    const provider = makeProvider({ languages: 'English, Spanish' })
    await renderSettled(<ContactDetail provider={provider} {...defaultProps} />)
    expect(screen.getByText('English')).toBeTruthy()
    expect(screen.getByText('Spanish')).toBeTruthy()
  })
})
