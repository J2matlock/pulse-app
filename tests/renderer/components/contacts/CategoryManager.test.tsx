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

// Mock motion/react to render plain divs
vi.mock('motion/react', () => ({
  motion: {
    div: React.forwardRef(({ variants, initial, animate, ...props }: Record<string, unknown>, ref: React.Ref<HTMLDivElement>) =>
      React.createElement('div', { ...props, ref })
    ),
  },
}))

// Mock useFocusTrap
vi.mock('../../../../src/renderer/hooks/useFocusTrap', () => ({
  useFocusTrap: vi.fn(),
}))

// Mock animations
vi.mock('../../../../src/renderer/utils/animations', () => ({
  backdropVariants: {},
  modalPanelVariants: {},
}))

// Mock contactsStore
const mockCreateCategory = vi.fn().mockResolvedValue(undefined)
const mockUpdateCategory = vi.fn().mockResolvedValue(undefined)
const mockDeleteCategory = vi.fn().mockResolvedValue(undefined)
const mockLoadCustomFields = vi.fn()
const mockCreateCustomField = vi.fn().mockResolvedValue(undefined)
const mockDeleteCustomField = vi.fn().mockResolvedValue(undefined)
let mockCategories: Array<{ id: number; name: string; color: string; position: number; created_at: string; field_count?: number }> = []
let mockCustomFields: Array<{ id: number; category_id: number; field_name: string; field_type: string; position: number }> = []

vi.mock('../../../../src/renderer/stores/contactsStore', () => ({
  useContactsStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      categories: mockCategories,
      createCategory: mockCreateCategory,
      updateCategory: mockUpdateCategory,
      deleteCategory: mockDeleteCategory,
      customFields: mockCustomFields,
      loadCustomFields: mockLoadCustomFields,
      createCustomField: mockCreateCustomField,
      deleteCustomField: mockDeleteCustomField,
    }),
}))

import { CategoryManager } from '../../../../src/renderer/components/contacts/CategoryManager'
import { setWords } from '../../vocabFixture'

beforeEach(() => { setWords() })

describe('CategoryManager', () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockCategories = [
      { id: 1, name: 'Medical', color: '#22c55e', position: 0, created_at: '2026-01-01' },
      { id: 2, name: 'Legal', color: '#3b82f6', position: 1, created_at: '2026-01-01' },
    ]
    mockCustomFields = []
  })

  it('renders list of categories with names', () => {
    render(<CategoryManager {...defaultProps} />)
    expect(screen.getByText('Medical')).toBeTruthy()
    expect(screen.getByText('Legal')).toBeTruthy()
  })

  it('renders dialog title "Manage categories"', () => {
    render(<CategoryManager {...defaultProps} />)
    expect(screen.getByText('Manage categories')).toBeTruthy()
  })

  it('does not render when open is false', () => {
    render(<CategoryManager open={false} onClose={vi.fn()} />)
    expect(screen.queryByText('Manage categories')).toBeNull()
  })

  it('shows empty state when no categories', () => {
    mockCategories = []
    render(<CategoryManager {...defaultProps} />)
    expect(screen.getByText(/No categories yet/)).toBeTruthy()
  })

  it('renders new category input and Add button', () => {
    render(<CategoryManager {...defaultProps} />)
    expect(screen.getByPlaceholderText('New category name')).toBeTruthy()
    expect(screen.getByText('Add')).toBeTruthy()
  })

  it('Add button is disabled when name is empty', () => {
    render(<CategoryManager {...defaultProps} />)
    const addBtn = screen.getByText('Add').closest('button')!
    expect(addBtn.hasAttribute('disabled')).toBe(true)
  })

  it('calls createCategory when Add is clicked with a name', async () => {
    render(<CategoryManager {...defaultProps} />)
    const input = screen.getByPlaceholderText('New category name')
    fireEvent.change(input, { target: { value: 'Housing' } })
    fireEvent.click(screen.getByText('Add'))
    expect(mockCreateCategory).toHaveBeenCalledWith('Housing', expect.any(String))
  })

  it('shows delete confirmation when delete button clicked', () => {
    render(<CategoryManager {...defaultProps} />)
    // Each category row has a Delete text button, named after the category
    const deleteButtons = screen.getAllByRole('button', { name: /^Delete / })
    fireEvent.click(deleteButtons[0]!)
    expect(screen.getByText(/Contacts will become Uncategorized/)).toBeTruthy()
  })

  it('calls deleteCategory when confirming delete', async () => {
    render(<CategoryManager {...defaultProps} />)
    const deleteButtons = screen.getAllByRole('button', { name: /^Delete / })
    fireEvent.click(deleteButtons[0]!)
    // The confirmation row has a Delete button with red bg styling
    const confirmBtns = screen.getAllByRole('button', { name: 'Delete' })
    // The confirm delete button is the one with bg-red-600 class
    const confirmDeleteBtn = confirmBtns.find(btn => btn.className.includes('bg-red-600'))!
    fireEvent.click(confirmDeleteBtn)
    expect(mockDeleteCategory).toHaveBeenCalledWith(1)
  })

  it('enters edit mode when Edit button is clicked', () => {
    render(<CategoryManager {...defaultProps} />)
    const editButtons = screen.getAllByRole('button', { name: /^Edit / })
    fireEvent.click(editButtons[0]!)
    // Should show an editable input pre-filled with the category name
    const input = screen.getByDisplayValue('Medical') as HTMLInputElement
    expect(input).toBeTruthy()
  })

  // E-12: no hover-only controls, and custom fields have a visible handle
  it('shows Edit and Delete as text on every row, with each category\'s field count', () => {
    mockCategories = mockCategories.map((c, i) => ({ ...c, field_count: i === 0 ? 2 : 0 }))
    render(<CategoryManager {...defaultProps} />)
    const edit = screen.getByRole('button', { name: `Edit ${mockCategories[0]!.name}` })
    expect(edit.textContent).toBe('Edit')
    expect(edit.className).not.toMatch(/opacity-0/)
    expect(screen.getByRole('button', { name: `Delete ${mockCategories[0]!.name}` }).textContent).toBe('Delete')
    expect(screen.getByText('Fields: 2')).toBeTruthy()
    expect(screen.getAllByText('Fields: 0').length).toBe(mockCategories.length - 1)
  })
})
