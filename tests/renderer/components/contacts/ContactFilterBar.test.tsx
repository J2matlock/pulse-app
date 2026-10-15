// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
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
const mockSetFilterParams = vi.fn()
let mockFilterParams: Record<string, unknown> = {}
const mockCategories = [
  { id: 1, name: 'Medical', color: '#22c55e', position: 0, created_at: '2026-01-01' },
  { id: 2, name: 'Legal', color: '#3b82f6', position: 1, created_at: '2026-01-01' },
]

vi.mock('../../../../src/renderer/stores/contactsStore', () => ({
  useContactsStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      categories: mockCategories,
      filterParams: mockFilterParams,
      setFilterParams: mockSetFilterParams,
    }),
}))

import { ContactFilterBar } from '../../../../src/renderer/components/contacts/ContactFilterBar'
import { setWords } from '../../vocabFixture'

beforeEach(() => { setWords() })

describe('ContactFilterBar', () => {
  const defaultProps = {
    viewMode: 'cards' as const,
    onViewModeChange: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockFilterParams = {}
  })

  it('renders search input with placeholder', () => {
    render(<ContactFilterBar {...defaultProps} />)
    expect(screen.getByPlaceholderText(/Search providers/)).toBeTruthy()
  })

  it('renders category filter chips', () => {
    render(<ContactFilterBar {...defaultProps} />)
    // "All" appears in both the category chips and the availability dropdown
    const allElements = screen.getAllByText('All')
    expect(allElements.length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Medical')).toBeTruthy()
    expect(screen.getByText('Legal')).toBeTruthy()
  })

  it('renders availability filter dropdown', () => {
    render(<ContactFilterBar {...defaultProps} />)
    const select = screen.getByLabelText('Filter by availability') as HTMLSelectElement
    const options = Array.from(select.options).map(o => o.textContent)
    expect(options).toContain('All')
    expect(options).toContain('Accepting')
    expect(options).toContain('Waitlist')
    expect(options).toContain('Not accepting')
    expect(options).toContain('Unknown')
  })

  it('renders sort dropdown', () => {
    render(<ContactFilterBar {...defaultProps} />)
    const select = screen.getByLabelText('Sort providers by') as HTMLSelectElement
    const options = Array.from(select.options).map(o => o.textContent)
    expect(options).toContain('Name A\u2013Z')
    expect(options).toContain('Category')
    expect(options).toContain('Recently added')
  })

  it('renders view toggle buttons (card and list)', () => {
    render(<ContactFilterBar {...defaultProps} />)
    expect(screen.getByLabelText('Card view')).toBeTruthy()
    expect(screen.getByLabelText('List view')).toBeTruthy()
  })

  it('calls onViewModeChange when list view button is clicked', () => {
    render(<ContactFilterBar {...defaultProps} />)
    fireEvent.click(screen.getByLabelText('List view'))
    expect(defaultProps.onViewModeChange).toHaveBeenCalledWith('list')
  })

  it('calls setFilterParams when category chip is clicked', () => {
    render(<ContactFilterBar {...defaultProps} />)
    fireEvent.click(screen.getByText('Medical'))
    expect(mockSetFilterParams).toHaveBeenCalledWith(expect.objectContaining({ categoryId: 1 }))
  })

  it('debounces search input before updating filter params', async () => {
    vi.useFakeTimers()
    render(<ContactFilterBar {...defaultProps} />)
    const input = screen.getByPlaceholderText(/Search providers/) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'test query' } })

    // Should not have been called yet (debounce delay is 200ms)
    expect(mockSetFilterParams).not.toHaveBeenCalled()

    // Advance past debounce timer
    act(() => { vi.advanceTimersByTime(250) })

    expect(mockSetFilterParams).toHaveBeenCalledWith(expect.objectContaining({ search: 'test query' }))
    vi.useRealTimers()
  })

  it('renders starred toggle button', () => {
    render(<ContactFilterBar {...defaultProps} />)
    expect(screen.getByLabelText('Show starred only')).toBeTruthy()
  })
})
