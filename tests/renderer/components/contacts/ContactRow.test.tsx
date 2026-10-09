// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'

// Mock window.api
Object.defineProperty(window, 'api', {
  value: { invoke: vi.fn().mockResolvedValue({ ok: true }) },
  writable: true,
})

import { ContactRow } from '../../../../src/renderer/components/contacts/ContactRow'
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

describe('ContactRow', () => {
  const defaultProps = {
    isSelected: false,
    onClick: vi.fn(),
    onToggleStar: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders provider name', () => {
    render(<ContactRow provider={makeProvider()} {...defaultProps} />)
    expect(screen.getByText('Dr. Jane Smith')).toBeTruthy()
  })

  it('renders org name when different from name', () => {
    render(<ContactRow provider={makeProvider()} {...defaultProps} />)
    expect(screen.getByText('City Health Clinic')).toBeTruthy()
  })

  it('does not render org name when same as name', () => {
    render(<ContactRow provider={makeProvider({ name: 'Acme Corp', org_name: 'Acme Corp' })} {...defaultProps} />)
    const elements = screen.getAllByText('Acme Corp')
    expect(elements.length).toBe(1)
  })

  it('renders category badge when category_name present', () => {
    render(<ContactRow provider={makeProvider()} {...defaultProps} />)
    expect(screen.getByText('Medical')).toBeTruthy()
  })

  it('renders availability badge', () => {
    render(<ContactRow provider={makeProvider({ availability_status: 'accepting' })} {...defaultProps} />)
    expect(screen.getByText('Accepting')).toBeTruthy()
  })

  it('calls onClick when row is clicked', () => {
    const onClick = vi.fn()
    render(<ContactRow provider={makeProvider()} {...defaultProps} onClick={onClick} />)
    fireEvent.click(screen.getByText('Dr. Jane Smith'))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('calls onToggleStar when star button clicked and stops propagation', () => {
    const onToggleStar = vi.fn()
    const onClick = vi.fn()
    render(<ContactRow provider={makeProvider({ is_starred: 0 })} {...defaultProps} onClick={onClick} onToggleStar={onToggleStar} />)
    const starBtn = screen.getByLabelText('Star')
    fireEvent.click(starBtn)
    expect(onToggleStar).toHaveBeenCalledOnce()
    expect(onClick).not.toHaveBeenCalled()
  })

  it('shows Unstar label when starred', () => {
    render(<ContactRow provider={makeProvider({ is_starred: 1 })} {...defaultProps} />)
    expect(screen.getByLabelText('Unstar')).toBeTruthy()
  })

  it('applies selected styling when isSelected is true', () => {
    const { container } = render(<ContactRow provider={makeProvider()} {...defaultProps} isSelected={true} />)
    const row = container.firstElementChild as HTMLElement
    expect(row.className).toContain('bg-blue-50')
    expect(row.className).toContain('border-blue-500')
  })
})
