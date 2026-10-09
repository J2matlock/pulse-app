// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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
const mockCreateProvider = vi.fn().mockResolvedValue({ id: 99 })
const mockUpdateProvider = vi.fn().mockResolvedValue(undefined)
const mockCategories = [
  { id: 1, name: 'Medical', color: '#22c55e', position: 0, created_at: '2026-01-01' },
  { id: 2, name: 'Legal', color: '#3b82f6', position: 1, created_at: '2026-01-01' },
]

vi.mock('../../../../src/renderer/stores/contactsStore', () => ({
  useContactsStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      categories: mockCategories,
      createProvider: mockCreateProvider,
      updateProvider: mockUpdateProvider,
    }),
}))

vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }))

import { ContactForm } from '../../../../src/renderer/components/contacts/ContactForm'
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
    referral_process: null,
    notes: 'Good provider',
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

describe('ContactForm', () => {
  const defaultProps = {
    onClose: vi.fn(),
    onSaved: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    ;(window.api.invoke as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, data: [] })
  })

  it('renders form fields (name, org, phone, email, etc.)', () => {
    render(<ContactForm {...defaultProps} />)
    expect(screen.getByLabelText(/Name/)).toBeTruthy()
    expect(screen.getByLabelText(/Organization/)).toBeTruthy()
    expect(screen.getByLabelText(/Title/)).toBeTruthy()
    expect(screen.getByLabelText(/Category/)).toBeTruthy()
    expect(screen.getByLabelText(/Phone \(Main\)/)).toBeTruthy()
    expect(screen.getByLabelText(/Email/)).toBeTruthy()
    expect(screen.getByLabelText(/Website/)).toBeTruthy()
  })

  it('shows "Add Provider" title when creating new provider', () => {
    render(<ContactForm {...defaultProps} />)
    expect(screen.getByText('Add Provider')).toBeTruthy()
  })

  it('shows "Edit Provider" title in edit mode', () => {
    const provider = makeProvider()
    render(<ContactForm provider={provider} {...defaultProps} />)
    expect(screen.getByText('Edit Provider')).toBeTruthy()
  })

  it('pre-fills form with existing provider data in edit mode', () => {
    const provider = makeProvider()
    render(<ContactForm provider={provider} {...defaultProps} />)
    expect((screen.getByLabelText(/Name/) as HTMLInputElement).value).toBe('Dr. Jane Smith')
    expect((screen.getByLabelText(/Organization/) as HTMLInputElement).value).toBe('City Health Clinic')
    expect((screen.getByLabelText(/Title/) as HTMLInputElement).value).toBe('Primary Care Physician')
    expect((screen.getByLabelText(/Phone \(Main\)/) as HTMLInputElement).value).toBe('555-123-4567')
    expect((screen.getByLabelText(/^Email$/) as HTMLInputElement).value).toBe('jane@clinic.org')
  })

  it('Save button is disabled when name is empty', () => {
    render(<ContactForm {...defaultProps} />)
    const saveBtn = screen.getByText('Save')
    expect(saveBtn.closest('button')!.hasAttribute('disabled')).toBe(true)
  })

  it('Save button is enabled when name is entered', () => {
    render(<ContactForm {...defaultProps} />)
    const nameInput = screen.getByLabelText(/Name/) as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: 'Test Provider' } })
    const saveBtn = screen.getByText('Save')
    expect(saveBtn.closest('button')!.hasAttribute('disabled')).toBe(false)
  })

  it('calls onClose when Cancel is clicked on clean form', () => {
    render(<ContactForm {...defaultProps} />)
    fireEvent.click(screen.getByText('Cancel'))
    expect(defaultProps.onClose).toHaveBeenCalledOnce()
  })

  it('shows discard confirmation when Cancel is clicked on dirty form', () => {
    render(<ContactForm {...defaultProps} />)
    const nameInput = screen.getByLabelText(/Name/) as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: 'Dirty data' } })
    fireEvent.click(screen.getByText('Cancel'))
    // Should show ConfirmDialog with discard message
    expect(screen.getByText(/Unsaved changes/)).toBeTruthy()
  })

  it('renders category dropdown with categories from store', () => {
    render(<ContactForm {...defaultProps} />)
    const select = screen.getByLabelText(/Category/) as HTMLSelectElement
    const options = Array.from(select.options).map(o => o.textContent)
    expect(options).toContain('Medical')
    expect(options).toContain('Legal')
  })

  it('submits form data via createProvider on save for new provider', async () => {
    render(<ContactForm {...defaultProps} />)
    const nameInput = screen.getByLabelText(/Name/) as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: 'New Provider' } })
    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => {
      expect(mockCreateProvider).toHaveBeenCalledOnce()
    })
    const callArgs = mockCreateProvider.mock.calls[0]![0]
    expect(callArgs.name).toBe('New Provider')
  })

  it('submits form data via updateProvider on save for existing provider', async () => {
    const provider = makeProvider()
    render(<ContactForm provider={provider} {...defaultProps} />)

    const nameInput = screen.getByLabelText(/Name/) as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: 'Updated Name' } })
    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => {
      expect(mockUpdateProvider).toHaveBeenCalledOnce()
    })
    expect(mockUpdateProvider.mock.calls[0]![0]).toBe(1)
    expect(mockUpdateProvider.mock.calls[0]![1].name).toBe('Updated Name')
  })
})
