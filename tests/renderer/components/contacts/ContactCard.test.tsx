// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'

// Mock window.api
const mockCopyToClipboard = vi.fn().mockResolvedValue(undefined)
;(globalThis as Record<string, unknown>).window = {
  api: {
    invoke: vi.fn().mockResolvedValue({ ok: true }),
    copyToClipboard: mockCopyToClipboard,
  },
}

import { ContactCard } from '../../../../src/renderer/components/contacts/ContactCard'
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
    email: 'jane.smith@clinic.org',
    website: null,
    address: null,
    hours: null,
    languages: null,
    availability_status: 'accepting',
    availability_notes: null,
    availability_checked_at: '2026-03-01T00:00:00Z',
    referral_process: null,
    notes: null,
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

describe('ContactCard', () => {
  const defaultProps = {
    isSelected: false,
    onClick: vi.fn(),
    onToggleStar: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders provider name, org, and title', () => {
    const provider = makeProvider()
    render(<ContactCard provider={provider} {...defaultProps} />)
    expect(screen.getByText('Dr. Jane Smith')).toBeTruthy()
    expect(screen.getByText('City Health Clinic')).toBeTruthy()
  })

  it('shows availability badge', () => {
    const provider = makeProvider({ availability_status: 'accepting' })
    render(<ContactCard provider={provider} {...defaultProps} />)
    expect(screen.getByText('Accepting')).toBeTruthy()
  })

  it('shows no pill when availability is unknown (E-22)', () => {
    render(<ContactCard provider={makeProvider({ availability_status: 'unknown' })} {...defaultProps} />)
    expect(screen.queryByText('Unknown')).toBeNull()
  })

  it('shows phone and email when present', () => {
    const provider = makeProvider()
    render(<ContactCard provider={provider} {...defaultProps} />)
    expect(screen.getByText('555-123-4567')).toBeTruthy()
    expect(screen.getByText('jane.smith@clinic.org')).toBeTruthy()
  })

  it('does not render phone/email when absent', () => {
    const provider = makeProvider({ phone_main: null, email: null })
    render(<ContactCard provider={provider} {...defaultProps} />)
    expect(screen.queryByLabelText('Copy phone')).toBeNull()
    expect(screen.queryByLabelText('Copy email')).toBeNull()
  })

  it('calls onClick when card is clicked', () => {
    const onClick = vi.fn()
    const provider = makeProvider()
    render(<ContactCard provider={provider} {...defaultProps} onClick={onClick} />)
    fireEvent.click(screen.getByText('Dr. Jane Smith'))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('calls onToggleStar when star button clicked and stops propagation', () => {
    const onToggleStar = vi.fn()
    const onClick = vi.fn()
    const provider = makeProvider({ is_starred: 0 })
    render(<ContactCard provider={provider} {...defaultProps} onClick={onClick} onToggleStar={onToggleStar} />)
    const starBtn = screen.getByLabelText('Star')
    fireEvent.click(starBtn)
    expect(onToggleStar).toHaveBeenCalledOnce()
    // onClick should NOT be called due to stopPropagation
    expect(onClick).not.toHaveBeenCalled()
  })

  it('shows Unstar label when starred', () => {
    const provider = makeProvider({ is_starred: 1 })
    render(<ContactCard provider={provider} {...defaultProps} />)
    expect(screen.getByLabelText('Unstar')).toBeTruthy()
  })

  it('shows category badge when category_name present', () => {
    const provider = makeProvider({ category_name: 'Medical' })
    render(<ContactCard provider={provider} {...defaultProps} />)
    expect(screen.getByText('Medical')).toBeTruthy()
  })

  it('does not show org_name when same as name', () => {
    const provider = makeProvider({ name: 'Acme Corp', org_name: 'Acme Corp' })
    render(<ContactCard provider={provider} {...defaultProps} />)
    // Should only appear once (in the name slot, not duplicated as org)
    const elements = screen.getAllByText('Acme Corp')
    expect(elements.length).toBe(1)
  })
})
