// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'

import { CaseLogEntry } from '../../../../src/renderer/components/profile/CaseLogEntry'
import type { CaseLogEntry as CaseLogEntryType } from '../../../../src/shared/types'
import { localDateString } from '../../../../src/shared/dates'
import { setWords } from '../../vocabFixture'

function makeEntry(overrides: Partial<CaseLogEntryType> = {}): CaseLogEntryType {
  return {
    id: 1,
    row_id: 10,
    content: 'Called client about appointment.',
    log_type: 'phone',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    is_pinned: 0,
    follow_up_date: null,
    follow_up_completed: 0,
    original_content: null,
    edited_at: null,
    voided_at: null,
    voided_reason: null,
    source_action_id: null,
    ...overrides,
  }
}

beforeEach(() => { setWords() })

describe('CaseLogEntry', () => {
  const handlers = {
    onPin: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onCompleteFollowUp: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders entry content', () => {
    render(<CaseLogEntry entry={makeEntry()} {...handlers} />)
    expect(screen.getByText('Called client about appointment.')).toBeTruthy()
  })

  it('renders entry type label and icon', () => {
    render(<CaseLogEntry entry={makeEntry({ log_type: 'meeting' })} {...handlers} />)
    expect(screen.getByText('Meeting')).toBeTruthy()
  })

  it('renders relative time', () => {
    render(<CaseLogEntry entry={makeEntry()} {...handlers} />)
    // Created just now
    expect(screen.getByText('just now')).toBeTruthy()
  })

  it('shows pin button that calls onPin', () => {
    render(<CaseLogEntry entry={makeEntry({ is_pinned: 0 })} {...handlers} />)
    const pinBtn = screen.getByLabelText('Pin')
    expect(pinBtn).toBeTruthy()
    fireEvent.click(pinBtn)
    expect(handlers.onPin).toHaveBeenCalledWith(1, true)
  })

  it('shows unpin label when pinned', () => {
    render(<CaseLogEntry entry={makeEntry({ is_pinned: 1 })} {...handlers} />)
    expect(screen.getByLabelText('Unpin')).toBeTruthy()
  })

  it('edit button opens edit mode with textarea', () => {
    render(<CaseLogEntry entry={makeEntry()} {...handlers} />)
    const editBtn = screen.getByLabelText('Edit')
    fireEvent.click(editBtn)
    // Should now show textarea with the content
    const textarea = screen.getByRole('textbox')
    expect(textarea).toBeTruthy()
    expect((textarea as HTMLTextAreaElement).value).toBe('Called client about appointment.')
  })

  it('shows "edited" tag when updated_at differs from created_at', () => {
    const entry = makeEntry({
      created_at: '2026-01-01T10:00:00Z',
      updated_at: '2026-01-02T10:00:00Z',
    })
    render(<CaseLogEntry entry={entry} {...handlers} />)
    expect(screen.getByText('edited')).toBeTruthy()
  })

  it('does not show action buttons for system entries', () => {
    render(<CaseLogEntry entry={makeEntry({ log_type: 'system' })} {...handlers} />)
    expect(screen.queryByLabelText('Pin')).toBeNull()
    expect(screen.queryByLabelText('Edit')).toBeNull()
    expect(screen.queryByLabelText('Delete')).toBeNull()
  })

  it('delete button requires confirmation', () => {
    render(<CaseLogEntry entry={makeEntry()} {...handlers} />)
    const deleteBtn = screen.getByLabelText('Delete')
    fireEvent.click(deleteBtn)
    // Now should show confirm/cancel
    expect(screen.getByText('Delete')).toBeTruthy()
    expect(screen.getByLabelText('Cancel delete')).toBeTruthy()
    // Confirm delete
    fireEvent.click(screen.getByText('Delete'))
    expect(handlers.onDelete).toHaveBeenCalledWith(1)
  })

  it('shows follow-up badge with complete button', () => {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const entry = makeEntry({
      follow_up_date: localDateString(tomorrow),
      follow_up_completed: 0,
    })
    render(<CaseLogEntry entry={entry} {...handlers} />)
    expect(screen.getByText(/Follow-up/)).toBeTruthy()
    const completeBtn = screen.getByLabelText('Mark follow-up done')
    fireEvent.click(completeBtn)
    expect(handlers.onCompleteFollowUp).toHaveBeenCalledWith(1)
  })

  it('shows overdue text for past follow-up dates', () => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 2)
    const entry = makeEntry({
      follow_up_date: localDateString(yesterday),
      follow_up_completed: 0,
    })
    render(<CaseLogEntry entry={entry} {...handlers} />)
    expect(screen.getByText(/overdue/)).toBeTruthy()
  })
})
