// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'

// Mock window.api
Object.defineProperty(window, 'api', {
  value: {
    invoke: vi.fn().mockResolvedValue({ ok: true }),
    copyToClipboard: vi.fn().mockResolvedValue(undefined),
  },
  writable: true,
})

// Mock contactsStore
const mockAddInteraction = vi.fn().mockResolvedValue(undefined)
const mockUpdateInteraction = vi.fn().mockResolvedValue(undefined)
const mockDeleteInteraction = vi.fn().mockResolvedValue(undefined)
let mockInteractions: Array<{
  id: number
  provider_id: number
  created_at: string
  contact_type: string
  content: string
}> = []

vi.mock('../../../../src/renderer/stores/contactsStore', () => ({
  useContactsStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      interactions: mockInteractions,
      addInteraction: mockAddInteraction,
      updateInteraction: mockUpdateInteraction,
      deleteInteraction: mockDeleteInteraction,
    }),
}))

import { ContactInteractionLog } from '../../../../src/renderer/components/contacts/ContactInteractionLog'
import { setWords } from '../../vocabFixture'

beforeEach(() => { setWords() })

describe('ContactInteractionLog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInteractions = []
  })

  it('shows empty state message when no interactions', () => {
    render(<ContactInteractionLog providerId={1} />)
    expect(screen.getByText('No interactions logged yet.')).toBeTruthy()
  })

  it('renders the add interaction form with type buttons and textarea', () => {
    render(<ContactInteractionLog providerId={1} />)
    expect(screen.getByPlaceholderText('What happened?')).toBeTruthy()
    expect(screen.getByText('Call')).toBeTruthy()
    expect(screen.getByText('Email')).toBeTruthy()
    expect(screen.getByText('Visit')).toBeTruthy()
    expect(screen.getByText('Note')).toBeTruthy()
    expect(screen.getByText('Meeting')).toBeTruthy()
    expect(screen.getByText('Referral')).toBeTruthy()
    expect(screen.getByText('Other')).toBeTruthy()
  })

  it('Add button is disabled when textarea is empty', () => {
    render(<ContactInteractionLog providerId={1} />)
    const addBtn = screen.getByText('Add').closest('button')!
    expect(addBtn.hasAttribute('disabled')).toBe(true)
  })

  it('Add button is enabled when textarea has content', () => {
    render(<ContactInteractionLog providerId={1} />)
    const textarea = screen.getByPlaceholderText('What happened?')
    fireEvent.change(textarea, { target: { value: 'Called about referral' } })
    const addBtn = screen.getByText('Add').closest('button')!
    expect(addBtn.hasAttribute('disabled')).toBe(false)
  })

  it('renders interaction entries when interactions exist', () => {
    mockInteractions = [
      { id: 1, provider_id: 1, created_at: new Date().toISOString(), contact_type: 'call', content: 'Called about referral status' },
      { id: 2, provider_id: 1, created_at: new Date().toISOString(), contact_type: 'email', content: 'Sent intake forms' },
    ]
    render(<ContactInteractionLog providerId={1} />)
    expect(screen.getByText('Called about referral status')).toBeTruthy()
    expect(screen.getByText('Sent intake forms')).toBeTruthy()
  })

  it('shows search input when interactions exist', () => {
    mockInteractions = [
      { id: 1, provider_id: 1, created_at: new Date().toISOString(), contact_type: 'note', content: 'Test note' },
    ]
    render(<ContactInteractionLog providerId={1} />)
    expect(screen.getByPlaceholderText('Search interactions...')).toBeTruthy()
  })

  it('does not show search input when no interactions', () => {
    mockInteractions = []
    render(<ContactInteractionLog providerId={1} />)
    expect(screen.queryByPlaceholderText('Search interactions...')).toBeNull()
  })

  it('filters interactions only for the given providerId', () => {
    mockInteractions = [
      { id: 1, provider_id: 1, created_at: new Date().toISOString(), contact_type: 'call', content: 'Provider 1 call' },
      { id: 2, provider_id: 99, created_at: new Date().toISOString(), contact_type: 'note', content: 'Other provider note' },
    ]
    render(<ContactInteractionLog providerId={1} />)
    expect(screen.getByText('Provider 1 call')).toBeTruthy()
    expect(screen.queryByText('Other provider note')).toBeNull()
  })
})
